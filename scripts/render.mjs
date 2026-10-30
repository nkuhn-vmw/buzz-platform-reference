import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDeployment } from './lib/config.mjs';

export function manifests(c, guids) {
  for (const name of ['buzz-relay','buzz-identity']) {
    if (!/^[a-f0-9-]{36}$/.test(guids[name] ?? '')) throw new Error(`Missing app GUID: ${name}; run prepare-apps first`);
  }
  const common = {buildpacks:['nodejs_buildpack'],stack:c.stack,instances:1};
  const issuers = [{issuer:c.identityOrigin,command_audiences:[c.relayOrigin],token_class:'nip-fi+jwt',algorithms:['ES256'],skew_seconds:5,maximum_assertion_age_seconds:300,jwks_uri:'http://localhost:8082/.well-known/jwks.json',jwks_transport:'mesh',jwks_refresh_interval_seconds:60,jwks_hard_deadline_seconds:600,maximum_command_age_seconds:30,authorized_principals:['buzz-identity-operator']}];
  return {
    identity: {applications:[{...common,name:'buzz-identity',memory:'512M',disk_quota:'1G','health-check-type':'http','health-check-http-endpoint':'/healthz',command:'npm start',routes:[{route:new URL(c.identityOrigin).host},{route:c.internalIdentity}],services:['buzz-identity-db','buzz-identity-secrets','buzz-sso'],env:{NODE_ENV:'production',JWKS_MTLS_ALLOWED_APP_GUID:guids['buzz-relay'],PUBLIC_BASE_URL:c.identityOrigin,NIP_FI_ISSUER:c.identityOrigin,OIDC_ISSUER:c.oidcIssuer,RELAY_URLS:c.relayUrl,ALLOWED_EMAILS_JSON:JSON.stringify(c.allowedEmails),SSO_SCOPES:'openid,roles',SSO_AUTO_APPROVED_SCOPES:'openid,roles',SSO_IDENTITY_PROVIDERS:c.identityProvider,SSO_REDIRECT_URIS:`${c.identityOrigin}/oauth2/callback`}}]},
    relay: {applications:[{...common,name:'buzz-relay',memory:'1G',disk_quota:'2G','health-check-type':'http','health-check-http-endpoint':'/_readiness',timeout:180,routes:[{route:new URL(c.relayOrigin).host}],services:['buzz-db','buzz-cache','buzz-objects','buzz-secrets'],sidecars:[{name:'jwks-mtls',process_types:['web'],command:'node jwks-proxy.mjs',memory:'64M'}],env:{NODE_ENV:'production',JWKS_MTLS_IDENTITY_APP_GUID:guids['buzz-identity'],JWKS_MTLS_TARGET_URL:`https://${c.internalIdentity}:8443/.well-known/jwks.json`,RELAY_URL:c.relayUrl,BUZZ_REQUIRE_AUTH_TOKEN:true,BUZZ_HUDDLE_AUDIO_AVAILABLE:false,BUZZ_NIP_FI_MODE:'enforce',BUZZ_NIP_FI_MAX_CONNECTION_LIFETIME_SECS:300,BUZZ_NIP_FI_ISSUERS:JSON.stringify(issuers),BUZZ_NIP_FI_COMMUNITIES:JSON.stringify([{canonical_uri:c.relayOrigin,authorized_issuers:[c.identityOrigin]}])}}]},
    'pilot-mcp': {applications:[{...common,name:'buzz-pilot-docs',memory:'256M',disk_quota:'512M','health-check-type':'http','health-check-http-endpoint':'/healthz',routes:[{route:c.internalMcp}],services:['buzz-mcp-secret'],env:{NODE_ENV:'production'}}]},
    'platform-agent': {applications:[{name:'buzz-platform-agent',buildpacks:[c.agentBuildpack || 'agent_buildpack'],stack:c.agentStack || c.stack,memory:'1G',disk_quota:'2G',instances:1,routes:[{route:c.internalAgent}],services:['buzz-ai',c.credentialStoreService,'buzz-docs-service-access'],env:{TANZU_AGENT_ENABLE_DEBUG_UI:false,TANZU_AGENT_GENAI_MODEL_NAME:c.model,TANZU_AGENT_SHELL_ACCESS_ENABLED:false,TANZU_AGENT_FILESYSTEM_ACCESS:'off'}}]},
    agent: {applications:[{...common,name:'buzz-agent',memory:'1G',disk_quota:'2G',instances:0,'no-route':true,'health-check-type':'process',command:'node launch.mjs',services:['buzz-ai','buzz-agent-identity','buzz-docs-service-access','buzz-agent-db'],env:{NODE_ENV:'production',BUZZ_RUNTIME:'tanzu',BUZZ_ACP_DISPLAY_NAME:'Reference Agent',BUZZ_TANZU_AI_SERVICE:'buzz-ai',BUZZ_TANZU_AI_MODEL:c.model,BUZZ_RELAY_URL:c.relayUrl,BUZZ_FI_ASSERTION_URL:`${c.identityOrigin}/v1/agents/assertions`,BUZZ_TANZU_AGENT_URL:`http://${c.internalAgent}:8080/api/chat`,BUZZ_ACP_SESSION_POLICY:'thread',BUZZ_ACP_RESPOND_TO:'owner-only',BUZZ_ACP_EXIT_AFTER_INACTIVITY:7200,BUZZ_ACP_MAX_TURN_DURATION:600,BUZZ_ACP_IDLE_TIMEOUT:120,BUZZ_ACP_AGENTS:1,BUZZ_AGENT_MAX_CONTEXT_TOKENS:32768,BUZZ_AGENT_MAX_OUTPUT_TOKENS:4096,BUZZ_AGENT_MAX_PARALLEL_TOOLS:2}}]},
  };
}

export function render(c = loadDeployment()) {
  const guids = JSON.parse(readFileSync(join(c.stateDir,'app-guids.json'),'utf8'));
  const directory = join(c.stateDir,'manifests');
  mkdirSync(directory,{recursive:true,mode:0o700});
  for (const [name,manifest] of Object.entries(manifests(c,guids))) {
    // JSON is valid YAML; no templating or shell interpolation of operator input.
    writeFileSync(join(directory,`${name}.yml`),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  }
  return directory;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(`Rendered deployment manifests: ${render()}`);
