import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDeployment, root } from './lib/config.mjs';
import { cf, verifyTarget } from './lib/cf.mjs';
import { render, manifests } from './render.mjs';

const step=process.argv[2];
const participantSteps = new Set(['admit-participant', 'remove-participant']);
if (participantSteps.has(step) && (process.argv.length !== 4 || !/^[a-f0-9]{64}$/.test(process.argv[3]))) {
  console.error(`Usage: node scripts/deploy.mjs ${step} VERIFIED_BUZZ_PUBLIC_KEY_HEX`);
  process.exit(1);
}

const c = loadDeployment();
verifyTarget(c);
const json = (path, method, body) => {
  const args = ['curl',path];
  if (method) args.push('-X',method);
  if (body) args.push('-d',JSON.stringify(body));
  const data = JSON.parse(cf(c,args,{capture:true}));
  if (data.errors) throw new Error(`CF API request failed: ${data.errors.map(e=>e.code).join(', ')}`);
  return data;
};
const spaceGuid = cf(c,['space',c.space,'--guid'],{capture:true}).trim();
if (!/^[a-f0-9-]{36}$/.test(spaceGuid)) throw new Error('Could not verify space GUID');
const appNames = ['buzz-relay','buzz-identity','buzz-agent','buzz-platform-agent','buzz-pilot-docs'];
const apps = () => json(`/v3/apps?space_guids=${spaceGuid}&names=${appNames.join(',')}`).resources;
const appGuid = name => {
  const matches = apps().filter(a=>a.name===name);
  if (matches.length !== 1) throw new Error(`Expected one ${name} app in configured space`);
  return matches[0].guid;
};
async function task(name, command, label) {
  const t = json(`/v3/apps/${appGuid(name)}/tasks`,'POST',{name:label,command,memory_in_mb:1024,disk_in_mb:2048});
  console.log(`Started ${label} as task ${t.sequence_id} of ${name}.`);
  const until = Date.now()+15*60*1000;
  while (Date.now()<until) {
    const current=json(`/v3/tasks/${t.guid}`);
    if (current.state==='SUCCEEDED') {console.log(`${label} succeeded.`);return current;}
    if (current.state==='FAILED') throw new Error(`${label} task failed; inspect sanitized app logs`);
    await new Promise(r=>setTimeout(r,5000));
  }
  throw new Error(`${label} did not finish within 15 minutes; inspect the existing task before retrying`);
}
function guids() {return JSON.parse(readFileSync(join(c.stateDir,'app-guids.json'),'utf8'));}
function push(name, file, path, extra=[]) {
  const directory=render(c);
  cf(c,['push',name,'-f',join(directory,`${file}.yml`),'-p',join(root,path),...extra]);
}
console.log(`Deployment target: ${c.api} / ${c.org} / ${c.space}`);
try {
  if (step==='prepare-apps') {
    const existing=apps();
    for (const name of appNames) if (!existing.some(a=>a.name===name)) json('/v3/apps','POST',{name,relationships:{space:{data:{guid:spaceGuid}}}});
    const ids=Object.fromEntries(apps().map(a=>[a.name,a.guid]));
    mkdirSync(c.stateDir,{recursive:true,mode:0o700});
    writeFileSync(join(c.stateDir,'app-guids.json'),JSON.stringify(ids,null,2)+'\n',{mode:0o600});
    render(c);
    console.log('Prepared apps and rendered manifests with their actual CF identities.');
  } else if (step==='identity') {
    const env=manifests(c,guids()).identity.applications[0].env;
    // App SSO consumes these at the first bind, before staging.
    for (const [key,value] of Object.entries(env).filter(([k])=>k.startsWith('SSO_'))) cf(c,['set-env','buzz-identity',key,String(value)]);
    push('buzz-identity','identity','artifacts/identity');
    cf(c,['add-network-policy','buzz-relay','buzz-identity','--protocol','tcp','--port','8443']);
  } else if (step==='relay') {
    push('buzz-relay','relay','artifacts/relay',['--no-start']);
    cf(c,['stage-package','buzz-relay']);
    const staged=json(`/v3/droplets?app_guids=${appGuid('buzz-relay')}&states=STAGED&order_by=-created_at&per_page=1`).resources[0];
    if (!staged) throw new Error('Relay staging did not produce a droplet');
    cf(c,['set-droplet','buzz-relay',staged.guid]);
    await task('buzz-relay','node launch.mjs migrate','relay-migrate');
    cf(c,['start','buzz-relay']);
  } else if (step==='tools') {
    push('buzz-pilot-docs','pilot-mcp','apps/pilot-mcp');
    cf(c,['bind-service','buzz-pilot-docs',c.gatewayService,'-c',JSON.stringify({auth:{mode:'forward_token'}})]);
    cf(c,['restage','buzz-pilot-docs']);
    console.log('Gateway backend registered. Run register-mcp to create the scoped agent binding.');
  } else if (step==='native-agent') {
    push('buzz-platform-agent','platform-agent','apps/platform-agent');
    cf(c,['add-network-policy','buzz-agent','buzz-platform-agent','--protocol','tcp','--port','8080']);
  } else if (step==='register-mcp') {
    const found=json(`/v3/service_instances?space_guids=${spaceGuid}&names=${encodeURIComponent(c.gatewayService)}`).resources;
    if (found.length!==1 || !found[0].dashboard_url) throw new Error('Gateway must be ready with a dashboard URL');
    const gateway=new URL(found[0].dashboard_url);
    if (gateway.protocol!=='https:' || gateway.username || gateway.password || gateway.search || gateway.hash || gateway.pathname!=='/') throw new Error('Gateway dashboard must be a plain HTTPS origin');
    const source=JSON.parse(readFileSync(join(c.credentialsDir,'service-parameters/buzz-mcp-secret.json'),'utf8'));
    if (typeof source.MCP_BEARER_TOKEN!=='string' || source.MCP_BEARER_TOKEN.length<32) throw new Error('Missing local MCP backend credential');
    const binding=join(c.credentialsDir,'service-parameters/buzz-docs-service-access.json');
    writeFileSync(binding,JSON.stringify({url:`${gateway.origin}/buzz-pilot-docs/mcp`,api_key:source.MCP_BEARER_TOKEN}),{mode:0o600});
    cf(c,['update-service','buzz-docs-service-access','-c',binding,'--wait']);
    console.log('Scoped read-only Gateway access stored in the CredHub service.');
  } else if (step==='worker') {
    push('buzz-agent','agent','artifacts/agent',['--task']);
  } else if (step==='status') {
    cf(c,['apps']);cf(c,['services']);cf(c,['tasks','buzz-agent']);
  } else if (step==='probe') {
    await task('buzz-agent','node verify-native.mjs','native-gateway-probe');
  } else if (step==='admit-owner') {
    const owner=JSON.parse(readFileSync(join(c.credentialsDir,'pilot-owner.json'),'utf8'));
    if (!/^[a-f0-9]{64}$/.test(owner.pubkey ?? '')) throw new Error('Enroll the dedicated pilot owner first');
    await task('buzz-relay',`node launch.mjs add-member --pubkey ${owner.pubkey} --role admin`,'admit-pilot-owner');
  } else if (participantSteps.has(step)) {
    const command = step==='admit-participant' ? 'add-member' : 'remove-member';
    // Removal is role-filtered so an attendee cleanup cannot remove an admin.
    await task('buzz-relay',`node launch.mjs ${command} --pubkey ${process.argv[3]} --role member`,step);
    console.log('Participant membership task completed; confirm the roster and channel access separately.');
  } else throw new Error('Usage: node scripts/deploy.mjs prepare-apps|identity|relay|tools|register-mcp|native-agent|worker|admit-owner|admit-participant KEY|remove-participant KEY|probe|status');
} catch (error) {console.error(error.message);process.exitCode=1;}
