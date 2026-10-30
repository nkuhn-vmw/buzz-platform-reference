#!/usr/bin/env node
import { createECDH } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDeployment, root } from './lib/config.mjs';
import { cf, runCF, verifyLocalTarget } from './lib/cf.mjs';
import { manifests } from './render.mjs';

const agentPattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ACTIVE_TASK_STATES = new Set(['PENDING', 'RUNNING', 'CANCELING']);

export function parseArgs(args) {
  if (args.length === 0) return { agent: 'helper' };
  if (args.length === 2 && args[0] === '--agent' && agentPattern.test(args[1])) return { agent: args[1] };
  throw new Error('Usage: node scripts/activate-agent.mjs [--agent NAME]');
}
export function appNameFor(agent) { return agent === 'helper' ? 'buzz-agent' : `buzz-agent-${agent}`; }
export function identityServiceFor(agent) { return agent === 'helper' ? 'buzz-agent-identity' : `buzz-agent-identity-${agent}`; }
function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function keyPubkey(secretHex) {
  if (typeof secretHex !== 'string' || !/^[a-f0-9]{64}$/.test(secretHex)) throw new Error('Invalid local identity key');
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(secretHex, 'hex'));
  return ecdh.getPublicKey(undefined, 'compressed').subarray(1).toString('hex');
}
function readPrivateJson(path, label) {
  let stat;
  try { stat = lstatSync(path); }
  catch { throw new Error(`Missing ${label}; complete operator enrollment first`); }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error(`${label} must be a private regular file (mode 600)`);
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error(`${label} is invalid JSON`); }
}
function assertPrivateDirectory(path, label) {
  let stat;
  try { stat = lstatSync(path); }
  catch { throw new Error(`Missing ${label}; complete operator enrollment first`); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error(`${label} must be a private directory (mode 700)`);
}
export function loadEnrollmentFiles(credentialsDir, agent, now = Date.now()) {
  if (!agentPattern.test(agent)) throw new Error('Agent name must use 1-32 lowercase letters, digits, underscores, or hyphens');
  const dir = join(credentialsDir, 'agents', agent);
  assertPrivateDirectory(credentialsDir, 'credentials directory');
  assertPrivateDirectory(join(credentialsDir, 'agents'), 'agents directory');
  assertPrivateDirectory(dir, 'agent credentials directory');
  const owner = readPrivateJson(join(credentialsDir, 'pilot-owner.json'), 'pilot owner key');
  const binding = readPrivateJson(join(dir, 'agent-identity.json'), 'agent identity binding');
  const enrollment = readPrivateJson(join(dir, 'agent-enrollment.json'), 'agent enrollment record');
  const ownerPubkey = keyPubkey(owner.secret_hex);
  const agentPubkey = keyPubkey(binding.BUZZ_PRIVATE_KEY);
  if (owner.pubkey !== ownerPubkey || enrollment.owner_pubkey !== ownerPubkey || binding.BUZZ_ACP_AGENT_OWNER !== ownerPubkey) throw new Error('Owner key does not match the enrolled identity binding');
  if (enrollment.agent_pubkey !== agentPubkey) throw new Error('Agent key does not match its enrollment record');
  const expectedKeys = ['BUZZ_PRIVATE_KEY', 'BUZZ_ACP_AGENT_OWNER', 'BUZZ_FI_GRANT_TOKEN', 'BUZZ_GRANT_EXPIRES_AT', 'BUZZ_AUTH_TAG'];
  if (Object.keys(binding).length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(binding, key)) ||
      typeof binding.BUZZ_FI_GRANT_TOKEN !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(binding.BUZZ_FI_GRANT_TOKEN)) throw new Error('Agent identity binding is incomplete');
  let authTag;
  try { authTag = JSON.parse(binding.BUZZ_AUTH_TAG); } catch { throw new Error('Agent owner authorization tag is invalid'); }
  if (!Array.isArray(authTag) || authTag.length !== 4 || authTag[0] !== 'auth' || authTag[1] !== ownerPubkey ||
      typeof authTag[2] !== 'string' || !/^created_at<\d+$/.test(authTag[2]) || typeof authTag[3] !== 'string' || !/^[a-f0-9]{128}$/.test(authTag[3])) {
    throw new Error('Agent owner authorization tag is invalid');
  }
  const bindingExpiry = Date.parse(binding.BUZZ_GRANT_EXPIRES_AT);
  const enrollmentExpiry = Date.parse(enrollment.expires_at);
  if (!Number.isFinite(bindingExpiry) || !Number.isFinite(enrollmentExpiry) || bindingExpiry !== enrollmentExpiry || bindingExpiry - now < 30_000) {
    throw new Error('Agent identity grant is expired or has less than 30 seconds remaining; enroll again');
  }
  if (typeof enrollment.grant_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(enrollment.grant_id)) throw new Error('Agent enrollment record has an invalid grant ID');
  return { ownerPubkey, agentPubkey, binding, enrollment, expiresAt: new Date(bindingExpiry).toISOString() };
}
export function configureAgentManifest(template, { deployment, agent, identityService, ownerPubkey }) {
  const entry = deployment.agents?.[agent] ?? {};
  if (!plainObject(entry)) throw new Error(`agents.${agent} must be an object`);
  const runtime = entry.runtime ?? 'tanzu';
  if (!['tanzu', 'builtin'].includes(runtime)) throw new Error(`agents.${agent}.runtime must be tanzu or builtin`);
  if (runtime === 'tanzu' && entry.model !== undefined) throw new Error(`agents.${agent}.model applies only to builtin runtime; Tanzu agents use the shared platform model`);
  const displayName = entry.displayName || entry.Name || agent;
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 128 || /[\r\n\0]/.test(displayName)) throw new Error(`agents.${agent}.displayName is invalid`);
  const respondTo = entry.respondTo ?? 'owner-only';
  if (!['owner-only', 'allowlist'].includes(respondTo)) throw new Error(`agents.${agent}.respondTo must be owner-only or allowlist`);
  const allowlist = entry.respondToAllowlist ?? [];
  if (!Array.isArray(allowlist) || allowlist.some((key) => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) || new Set(allowlist).size !== allowlist.length) {
    throw new Error(`agents.${agent}.respondToAllowlist must contain unique 64-character lowercase public keys`);
  }
  if (respondTo === 'allowlist' && allowlist.length === 0) throw new Error(`agents.${agent}.respondToAllowlist is required when respondTo is allowlist`);
  const app = structuredClone(template);
  const appName = appNameFor(agent);
  app.name = appName;
  if (!Array.isArray(app.services) || !app.services.includes('buzz-agent-identity')) throw new Error('Agent manifest template is missing buzz-agent-identity');
  app.services = app.services.map((name) => name === 'buzz-agent-identity' ? identityService : name);
  app.env.BUZZ_IDENTITY_SERVICE = identityService;
  app.env.BUZZ_RUNTIME = runtime;
  app.env.BUZZ_ACP_DISPLAY_NAME = displayName;
  app.env.BUZZ_ACP_SESSION_POLICY = 'thread';
  app.env.BUZZ_ACP_RESPOND_TO = respondTo;
  delete app.env.BUZZ_ACP_RESPOND_TO_ALLOWLIST;
  if (respondTo === 'allowlist') app.env.BUZZ_ACP_RESPOND_TO_ALLOWLIST = allowlist.join(',');
  if (runtime === 'builtin') {
    if (entry.model !== undefined && (typeof entry.model !== 'string' || !entry.model.trim() || /[\r\n\0]/.test(entry.model))) throw new Error(`agents.${agent}.model is invalid`);
    app.env.BUZZ_TANZU_AI_MODEL = entry.model ?? deployment.model;
    delete app.env.BUZZ_TANZU_AGENT_URL;
  } else {
    app.env.BUZZ_TANZU_AI_MODEL = deployment.model;
  }
  return { app, appName, identityService, runtime, ownerPubkey };
}
function apiJson(deployment, path, method, body) {
  const args = ['curl', path];
  if (method) args.push('-X', method);
  if (body) args.push('-d', JSON.stringify(body));
  const text = cf(deployment, args, { capture: true });
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`CF API returned invalid JSON for ${path.split('?')[0]}`); }
  if (data.errors) throw new Error(`CF API request failed: ${data.errors.map(error => error.code).join(', ')}`);
  return data;
}
function verifySpace(deployment) {
  const target = verifyLocalTarget(deployment);
  const org = apiJson(deployment, `/v3/organizations/${encodeURIComponent(target.organizationGuid)}`);
  const space = apiJson(deployment, `/v3/spaces/${encodeURIComponent(target.spaceGuid)}`);
  if (org.guid !== target.organizationGuid || org.name !== deployment.org || space.guid !== target.spaceGuid ||
      space.name !== deployment.space || space.relationships?.organization?.data?.guid !== target.organizationGuid) {
    throw new Error('CF API org or space identity does not match the verified isolated target');
  }
  return { organizationGuid: target.organizationGuid, spaceGuid: target.spaceGuid };
}
function listInSpace(deployment, resource, names, spaceGuid) {
  const query = new URLSearchParams({ names: names.join(','), space_guids: spaceGuid, per_page: '100' });
  const response = apiJson(deployment, `/v3/${resource}?${query}`);
  if (!Array.isArray(response.resources)) throw new Error(`Could not read ${resource} in the verified CF space`);
  const selected = [];
  for (const item of response.resources) {
    if (!names.includes(item.name)) continue;
    const itemSpace = item.relationships?.space?.data?.guid;
    if (itemSpace !== spaceGuid) throw new Error(`CF returned ${resource} outside the verified space`);
    selected.push(item);
  }
  return selected;
}
function oneNamedInSpace(deployment, resource, name, spaceGuid) {
  const found = listInSpace(deployment, resource, [name], spaceGuid);
  if (found.length > 1) throw new Error(`Multiple ${resource} named ${name} exist in the verified space`);
  return found[0] ?? null;
}
function servicePlan(deployment, instance) {
  const planGuid = instance.relationships?.service_plan?.data?.guid;
  if (!planGuid) return null;
  const plan = apiJson(deployment, `/v3/service_plans/${encodeURIComponent(planGuid)}`);
  const offeringGuid = plan.relationships?.service_offering?.data?.guid;
  if (!offeringGuid) return null;
  const offering = apiJson(deployment, `/v3/service_offerings/${encodeURIComponent(offeringGuid)}`);
  return { plan: plan.name, offering: offering.name };
}
function ensureIdentityService(deployment, serviceName, bindingPath, spaceGuid) {
  const expected = deployment.services.secrets;
  const existing = oneNamedInSpace(deployment, 'service_instances', serviceName, spaceGuid);
  if (existing) {
    const actual = servicePlan(deployment, existing);
    if (actual?.offering !== expected.offering || actual?.plan !== expected.plan) throw new Error(`Identity service ${serviceName} has the wrong offering or plan`);
    const state = String(existing.last_operation?.state ?? existing.state ?? '').toLowerCase();
    if (state !== 'succeeded') throw new Error(`Identity service ${serviceName} is not ready (${state || 'unknown'}); inspect the broker operation before retrying`);
    cf(deployment, ['update-service', serviceName, '-c', bindingPath, '--wait']);
  } else {
    cf(deployment, ['create-service', expected.offering, expected.plan, serviceName, '-c', bindingPath, '--wait']);
  }
  const updated = oneNamedInSpace(deployment, 'service_instances', serviceName, spaceGuid);
  if (!updated) throw new Error(`Identity service ${serviceName} was not found after broker update`);
  const actual = servicePlan(deployment, updated);
  if (actual?.offering !== expected.offering || actual?.plan !== expected.plan || String(updated.last_operation?.state ?? '').toLowerCase() !== 'succeeded') {
    throw new Error(`Identity service ${serviceName} did not finish in the expected ready state`);
  }
}
function appByName(deployment, name, spaceGuid) { return oneNamedInSpace(deployment, 'apps', name, spaceGuid); }
function appTasks(deployment, appGuid) {
  const query = new URLSearchParams({ app_guids: appGuid, per_page: '5000' });
  const response = apiJson(deployment, `/v3/tasks?${query}`);
  if (!Array.isArray(response.resources)) throw new Error('Could not read CF tasks for the target app');
  return response.resources;
}
function activeTasks(deployment, appGuid) {
  return appTasks(deployment, appGuid).filter((task) => ACTIVE_TASK_STATES.has(String(task.state).toUpperCase()));
}
function assertNoActiveTask(deployment, appGuid, appName) {
  const active = activeTasks(deployment, appGuid);
  if (active.length) throw new Error(`App ${appName} already has an active CF Task (${active.map((task) => task.name ?? task.sequence_id).join(', ')}); stop it before activation`);
}
export function hasNativeC2CPolicy(output, source, space, org) {
  return output.split(/\r?\n/).some((line) => {
    const columns = line.trim().split(/\s+/);
    return columns[0] === source && columns[1] === 'buzz-platform-agent' && columns[2] === 'tcp' &&
      ['8080', '8080-8080'].includes(columns[3]) && columns.slice(4).join(' ') === `${space} ${org}`;
  });
}
function loadAppGuids(deployment) {
  try { return JSON.parse(readFileSync(join(deployment.stateDir, 'app-guids.json'), 'utf8')); }
  catch { throw new Error('Missing app GUID record; run node scripts/deploy.mjs prepare-apps first'); }
}
function writeAgentManifest(deployment, configured) {
  const directory = join(deployment.stateDir, 'agent-activations');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${configured.appName}.yml`);
  writeFileSync(path, JSON.stringify({ applications: [configured.app] }, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}
function ensureNativePolicy(deployment, appName, spaceGuid) {
  const platform = appByName(deployment, 'buzz-platform-agent', spaceGuid);
  if (!platform) throw new Error('buzz-platform-agent is missing from the configured CF space; deploy the native-agent app first');
  const result = runCF(['network-policies', '--source', appName], { deployment, capture: true });
  if (result.status !== 0) throw new Error('Could not inspect C2C network policies for the agent app');
  const hasPolicy = hasNativeC2CPolicy(result.stdout, appName, deployment.space, deployment.org);
  if (!hasPolicy) cf(deployment, ['add-network-policy', appName, 'buzz-platform-agent', '--protocol', 'tcp', '--port', '8080']);
}
function waitForStartedTask(deployment, taskGuid, taskName) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const task = apiJson(deployment, `/v3/tasks/${encodeURIComponent(taskGuid)}`);
    if (task.guid !== taskGuid || task.name !== taskName) throw new Error('CF returned a different task than the one just created');
    if (task && ['PENDING', 'RUNNING'].includes(String(task.state).toUpperCase())) return task;
    if (task && ['FAILED', 'SUCCEEDED', 'CANCELING'].includes(String(task.state).toUpperCase())) throw new Error(`CF Task ${taskName} exited or stopped during activation; inspect sanitized task logs`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(`CF Task ${taskName} was not visible after it was requested; inspect app tasks before retrying`);
}

export function activate(args = process.argv.slice(2)) {
  const { agent } = parseArgs(args);
  const deployment = loadDeployment();
  const target = verifySpace(deployment);
  const local = loadEnrollmentFiles(deployment.credentialsDir, agent);
  const serviceName = identityServiceFor(agent);
  const appName = appNameFor(agent);
  const bindingPath = join(deployment.credentialsDir, 'agents', agent, 'agent-identity.json');
  const existingApp = appByName(deployment, appName, target.spaceGuid);
  if (agent === 'helper' && !existingApp) throw new Error('The shared buzz-agent app is missing; run node scripts/deploy.mjs prepare-apps first');
  if (existingApp) assertNoActiveTask(deployment, existingApp.guid, appName);

  ensureIdentityService(deployment, serviceName, bindingPath, target.spaceGuid);
  const guids = loadAppGuids(deployment);
  const template = manifests(deployment, guids).agent.applications[0];
  const configured = configureAgentManifest(template, {
    deployment, agent, identityService: serviceName, ownerPubkey: local.ownerPubkey,
  });
  const manifestPath = writeAgentManifest(deployment, configured);
  const artifactPath = join(root, 'artifacts', 'agent');
  if (!lstatSync(artifactPath).isDirectory()) throw new Error('Missing artifacts/agent; package the agent before activation');
  cf(deployment, ['push', appName, '-f', manifestPath, '-p', artifactPath, '--task']);

  const pushedApp = appByName(deployment, appName, target.spaceGuid);
  if (!pushedApp) throw new Error(`App ${appName} was not found in the configured CF space after push`);
  assertNoActiveTask(deployment, pushedApp.guid, appName);
  if (configured.runtime === 'tanzu') ensureNativePolicy(deployment, appName, target.spaceGuid);

  const taskName = `agent-${agent}`;
  const task = apiJson(deployment, `/v3/apps/${encodeURIComponent(pushedApp.guid)}/tasks`, 'POST', {
    name: taskName, command: 'node launch.mjs', memory_in_mb: 1024, disk_in_mb: 2048,
  });
  if (typeof task.guid !== 'string' || !/^[a-f0-9-]{36}$/i.test(task.guid)) throw new Error('CF did not return the created task identity; inspect existing tasks before retrying');
  waitForStartedTask(deployment, task.guid, taskName);
  console.log(`Activated ${configured.appName} (${configured.runtime}) as CF Task ${taskName}; identity grant expires ${local.expiresAt}.`);
  return { appName, taskName, identityService: serviceName, expiresAt: local.expiresAt };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { activate(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
