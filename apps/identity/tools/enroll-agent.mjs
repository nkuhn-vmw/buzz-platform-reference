// Operator enrollment uses one shared pilot owner and one dedicated key/grant per agent.
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { schnorr } from '@noble/curves/secp256k1.js';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { loadDeployment } from '../../../scripts/lib/config.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const deployment = loadDeployment();
const credentials = deployment.credentialsDir;
const base = deployment.identityOrigin;
const relay = deployment.relayUrl;
const audience = deployment.relayOrigin;
if (!base || new URL(base).protocol !== 'https:' || !relay || !audience) throw new Error('Deployment identity and relay settings are incomplete');

function parseArgs(argv) {
  let agent = 'helper';
  let revoke = false;
  let agentSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--agent' && index + 1 < argv.length && !agentSeen) { agentSeen = true; agent = argv[++index]; }
    else if (argv[index] === '--revoke' && !revoke) revoke = true;
    else throw new Error('Usage: node apps/identity/tools/enroll-agent.mjs [--agent NAME] [--revoke]');
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(agent)) throw new Error('Agent name must use 1-32 lowercase letters, digits, underscores, or hyphens');
  return { agent, revoke };
}
const { agent: agentName, revoke } = parseArgs(process.argv.slice(2));
const agentDir = join(credentials, 'agents', agentName);
const sha256 = value => createHash('sha256').update(value).digest();
mkdirSync(agentDir, { recursive: true, mode: 0o700 });

function key(path) {
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(saved.secret_hex ?? '')) throw new Error('Invalid stored pilot key');
    const secret = Buffer.from(saved.secret_hex, 'hex');
    const pubkey = getPublicKey(secret);
    if (saved.pubkey !== pubkey) throw new Error('Stored pilot key does not match its public key');
    return { secret, pubkey };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const secret = randomBytes(32);
    const pubkey = getPublicKey(secret);
    writeFileSync(path, JSON.stringify({ secret_hex: secret.toString('hex'), pubkey }), { flag: 'wx', mode: 0o600 });
    return { secret, pubkey };
  }
}
async function request(path, token, payload, signer, requestMethod) {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const method = requestMethod ?? (body ? 'POST' : 'GET');
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  if (signer) {
    const proof = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '', tags: [
      ['u', base + path], ['method', method], ['payload', sha256(body ?? '').toString('hex')],
    ] }, signer.secret);
    headers['nostr-authorization'] = `Nostr ${Buffer.from(JSON.stringify(proof)).toString('base64')}`;
  }
  const response = await fetch(base + path, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Identity request ${path} refused with HTTP ${response.status}`);
  if (response.status === 204) return null;
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > 32768) throw new Error('Identity response too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

try {
  mkdirSync(credentials, { recursive: true, mode: 0o700 });
  const session = JSON.parse(readFileSync(join(credentials, 'operator-session.json'), 'utf8'));
  if (session.base !== base || typeof session.session_token !== 'string') throw new Error('Run scripts/login.mjs first');
  const checked = await request('/v1/session', session.session_token);
  if (Date.parse(checked.expires_at) <= Date.now()) throw new Error('SSO session expired');
  const enrollmentPath = join(agentDir, 'agent-enrollment.json');
  if (revoke) {
    const owner = key(join(credentials, 'pilot-owner.json'));
    const enrollment = JSON.parse(readFileSync(enrollmentPath, 'utf8'));
    if (!/^[a-f0-9-]{36}$/.test(enrollment.grant_id)) throw new Error('Invalid grant ID');
    await request(`/v1/agents/grants/${enrollment.grant_id}`, session.session_token, {}, owner, 'DELETE');
    console.log(`Agent grant '${agentName}' revoked. Terminate its CF Task for immediate process stop.`);
    process.exit(0);
  }
  const owner = key(join(credentials, 'pilot-owner.json'));
  const agent = key(join(agentDir, 'agent-key.json'));
  const jwks = createLocalJWKSet(await request('/.well-known/jwks.json'));
  const human = await request('/v1/identity/assertions', session.session_token, { relay_url: relay, nostr_pubkey: owner.pubkey }, owner);
  const verified = await jwtVerify(human.assertion, jwks, { issuer: base, audience, algorithms: ['ES256'], typ: 'nip-fi+jwt' });
  if (verified.payload.nostr_pubkey !== owner.pubkey) throw new Error('Owner assertion key mismatch');
  const grant = await request('/v1/agents/grants', session.session_token, { agent_pubkey: agent.pubkey, relay_url: relay }, owner);
  if (!Number.isFinite(Date.parse(grant.expires_at)) || Date.parse(grant.expires_at) > Date.parse(checked.expires_at)) throw new Error('Invalid grant expiry');
  const assertion = await request('/v1/agents/assertions', grant.grant_token, { agent_pubkey: agent.pubkey, relay_url: relay }, agent);
  const checkedAgent = await jwtVerify(assertion.assertion, jwks, { issuer: base, audience, algorithms: ['ES256'], typ: 'nip-fi-agent+jwt' });
  if (checkedAgent.payload.nostr_pubkey !== agent.pubkey || checkedAgent.payload.nostr_owner_pubkey !== owner.pubkey) throw new Error('Agent assertion ownership mismatch');
  const conditions = `created_at<${Math.floor(Date.parse(grant.expires_at) / 1000)}`;
  const signature = schnorr.sign(sha256(`nostr:agent-auth:${agent.pubkey}:${conditions}`), owner.secret);
  const binding = {
    BUZZ_PRIVATE_KEY: agent.secret.toString('hex'), BUZZ_ACP_AGENT_OWNER: owner.pubkey,
    BUZZ_FI_GRANT_TOKEN: grant.grant_token, BUZZ_GRANT_EXPIRES_AT: grant.expires_at,
    BUZZ_AUTH_TAG: JSON.stringify(['auth', owner.pubkey, conditions, Buffer.from(signature).toString('hex')]),
  };
  const destination = join(agentDir, 'agent-identity.json');
  writeFileSync(destination, JSON.stringify(binding), { mode: 0o600 }); chmodSync(destination, 0o600);
  writeFileSync(enrollmentPath, JSON.stringify({ grant_id: grant.grant_id, owner_pubkey: owner.pubkey, agent_pubkey: agent.pubkey, expires_at: grant.expires_at }), { mode: 0o600 });
  chmodSync(enrollmentPath, 0o600);
  console.log(JSON.stringify({ agent: agentName, expires_at: grant.expires_at, credential_file: `.credentials/agents/${agentName}/agent-identity.json` }));
} catch (error) {
  console.error(error?.message?.startsWith('Identity request ') ? error.message : 'Enrollment failed; verify the SSO session and existing pilot identity. No binding should be deployed.');
  process.exitCode = 1;
}
