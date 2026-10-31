import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const identityRequire = createRequire(fileURLToPath(new URL('../../apps/identity/package.json', import.meta.url)));
const { finalizeEvent, getPublicKey } = identityRequire('nostr-tools');
const { schnorr } = identityRequire('@noble/curves/secp256k1.js');

const sha256 = (value) => createHash('sha256').update(value).digest();

function profileEndpoint(relayUrl) {
  if (typeof relayUrl !== 'string') throw new Error('Configured relay URL is invalid');
  let parsed;
  try { parsed = new URL(relayUrl); } catch { throw new Error('Configured relay URL is invalid'); }
  if (parsed.protocol !== 'wss:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash ||
      relayUrl !== `wss://${parsed.host}` || parsed.hostname.endsWith('.')) {
    throw new Error('Configured relay URL must be a canonical wss origin');
  }
  return `https://${parsed.host}/events`;
}

function identityAssertionEndpoint(identityOrigin) {
  if (typeof identityOrigin !== 'string') throw new Error('Configured identity origin is invalid');
  let parsed;
  try { parsed = new URL(identityOrigin); } catch { throw new Error('Configured identity origin is invalid'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash ||
      identityOrigin !== `https://${parsed.host}` || parsed.hostname.endsWith('.')) {
    throw new Error('Configured identity origin must be a canonical https origin');
  }
  return `${identityOrigin}/v1/agents/assertions`;
}

function humanAssertionEndpoint(identityOrigin) {
  if (typeof identityOrigin !== 'string') throw new Error('Configured identity origin is invalid');
  let parsed;
  try { parsed = new URL(identityOrigin); } catch { throw new Error('Configured identity origin is invalid'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash ||
      identityOrigin !== `https://${parsed.host}` || parsed.hostname.endsWith('.')) {
    throw new Error('Configured identity origin must be a canonical https origin');
  }
  return `${identityOrigin}/v1/identity/assertions`;
}

function nip98Authorization(identity, endpoint, body, now) {
  const proof = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(now / 1000),
    content: '',
    tags: [
      ['u', endpoint],
      ['method', 'POST'],
      ['nonce', randomUUID()],
      ['payload', sha256(body).toString('hex')],
    ],
  }, identity.secret);
  return `Nostr ${Buffer.from(JSON.stringify(proof)).toString('base64')}`;
}

function parseAssertionResponse(result, identityOrigin, relayUrl, identity, now) {
  const nowSeconds = Math.floor(now / 1000);
  if (!result || typeof result !== 'object' || typeof result.assertion !== 'string' ||
      result.nostr_pubkey !== identity.agentPubkey || !Number.isSafeInteger(result.expires_at) ||
      result.expires_at <= nowSeconds || result.expires_at - nowSeconds > 305) {
    throw new Error('Identity issuer returned an invalid agent assertion');
  }
  const parts = result.assertion.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new Error('Identity issuer returned an invalid agent assertion');
  }
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Identity issuer returned an invalid agent assertion');
  }
  let relay;
  try { relay = new URL(relayUrl); } catch { throw new Error('Configured relay URL is invalid'); }
  const audience = `https://${relay.host}`;
  if (!['ES256', 'RS256'].includes(header.alg) || header.typ !== 'nip-fi-agent+jwt' ||
      claims.iss !== identityOrigin || claims.aud !== audience || claims.nostr_pubkey !== identity.agentPubkey ||
      claims.nostr_owner_pubkey !== identity.ownerPubkey || claims.exp !== result.expires_at ||
      !Number.isSafeInteger(claims.iat) || claims.iat > nowSeconds + 5 || claims.exp <= claims.iat || claims.exp - claims.iat > 300) {
    throw new Error('Identity issuer returned an invalid agent assertion');
  }
  return result.assertion;
}

function parseHumanAssertionResponse(result, identityOrigin, relayUrl, ownerPubkey, now) {
  const nowSeconds = Math.floor(now / 1000);
  if (!result || typeof result !== 'object' || typeof result.assertion !== 'string' ||
      result.nostr_pubkey !== ownerPubkey || !Number.isSafeInteger(result.expires_at) ||
      result.expires_at <= nowSeconds || result.expires_at - nowSeconds > 305) {
    throw new Error('Identity issuer returned an invalid owner assertion');
  }
  const parts = result.assertion.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new Error('Identity issuer returned an invalid owner assertion');
  }
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Identity issuer returned an invalid owner assertion');
  }
  let relay;
  try { relay = new URL(relayUrl); } catch { throw new Error('Configured relay URL is invalid'); }
  if (!['ES256', 'RS256'].includes(header.alg) || header.typ !== 'nip-fi+jwt' ||
      claims.iss !== identityOrigin || claims.aud !== `https://${relay.host}` || claims.nostr_pubkey !== ownerPubkey ||
      claims.exp !== result.expires_at || !Number.isSafeInteger(claims.iat) || claims.iat > nowSeconds + 5 ||
      claims.exp <= claims.iat || claims.exp - claims.iat > 300) {
    throw new Error('Identity issuer returned an invalid owner assertion');
  }
  return result.assertion;
}

async function requestIdentityAssertion({ endpoint, identityOrigin, relayUrl, identity, binding, fetchImpl, now }) {
  const body = JSON.stringify({ agent_pubkey: identity.agentPubkey, relay_url: relayUrl });
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${binding.BUZZ_FI_GRANT_TOKEN}`,
        'content-type': 'application/json',
        'nostr-authorization': nip98Authorization(identity, endpoint, body, now),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Could not reach the configured identity issuer for an agent assertion');
  }
  if (!response.ok) throw new Error(`Identity issuer refused the agent assertion (HTTP ${response.status})`);
  let result;
  try { result = await readJsonBounded(response); }
  catch { throw new Error('Identity issuer returned an invalid agent assertion response'); }
  return parseAssertionResponse(result, identityOrigin, relayUrl, identity, now);
}

async function requestHumanAssertion({ endpoint, identityOrigin, relayUrl, owner, session, fetchImpl, now }) {
  const body = JSON.stringify({ relay_url: relayUrl, nostr_pubkey: owner.pubkey });
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${session.session_token}`,
        'content-type': 'application/json',
        'nostr-authorization': nip98Authorization(owner, endpoint, body, now),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Could not reach the configured identity issuer for an owner assertion');
  }
  if (!response.ok) throw new Error(`Identity issuer refused the owner assertion (HTTP ${response.status})`);
  let result;
  try { result = await readJsonBounded(response); }
  catch { throw new Error('Identity issuer returned an invalid owner assertion response'); }
  return parseHumanAssertionResponse(result, identityOrigin, relayUrl, owner.pubkey, now);
}

function parseOwnerAuthTag(binding, agentPubkey, ownerPubkey, now) {
  let tag;
  try { tag = JSON.parse(binding.BUZZ_AUTH_TAG); } catch { throw new Error('Enrolled agent owner proof is invalid'); }
  if (!Array.isArray(tag) || tag.length !== 4 || tag[0] !== 'auth' || tag[1] !== ownerPubkey ||
      typeof tag[2] !== 'string' || typeof tag[3] !== 'string' || !/^[a-f0-9]{128}$/.test(tag[3])) {
    throw new Error('Enrolled agent owner proof is invalid');
  }
  const grantExpiry = Date.parse(binding.BUZZ_GRANT_EXPIRES_AT ?? '');
  const match = /^created_at<(\d+)$/.exec(tag[2]);
  if (!Number.isFinite(grantExpiry) || !match || Number(match[1]) !== Math.floor(grantExpiry / 1000) || grantExpiry <= now) {
    throw new Error('Enrolled agent owner proof is expired or mismatched');
  }
  const digest = sha256(`nostr:agent-auth:${agentPubkey}:${tag[2]}`);
  if (!schnorr.verify(Buffer.from(tag[3], 'hex'), digest, Buffer.from(ownerPubkey, 'hex'))) throw new Error('Enrolled agent owner proof is invalid');
  return tag;
}

function agentIdentity(binding, expectedAgentPubkey, ownerPubkey, now) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding) ||
      Object.keys(binding).length !== 5 ||
      !['BUZZ_PRIVATE_KEY', 'BUZZ_ACP_AGENT_OWNER', 'BUZZ_FI_GRANT_TOKEN', 'BUZZ_GRANT_EXPIRES_AT', 'BUZZ_AUTH_TAG'].every((key) => Object.hasOwn(binding, key))) {
    throw new Error('Enrolled agent identity is incomplete');
  }
  if (typeof binding.BUZZ_PRIVATE_KEY !== 'string' || !/^[a-f0-9]{64}$/.test(binding.BUZZ_PRIVATE_KEY) ||
      typeof binding.BUZZ_ACP_AGENT_OWNER !== 'string' || !/^[a-f0-9]{64}$/.test(binding.BUZZ_ACP_AGENT_OWNER) ||
      binding.BUZZ_ACP_AGENT_OWNER !== ownerPubkey || typeof expectedAgentPubkey !== 'string' || !/^[a-f0-9]{64}$/.test(expectedAgentPubkey)) {
    throw new Error('Enrolled agent identity does not match its owner');
  }
  const secret = Buffer.from(binding.BUZZ_PRIVATE_KEY, 'hex');
  const agentPubkey = getPublicKey(secret);
  if (agentPubkey !== expectedAgentPubkey) throw new Error('Enrolled agent key does not match its public identity');
  if (agentPubkey === ownerPubkey) throw new Error('Enrolled owner and agent identities must be different');
  const grantExpiry = Date.parse(binding.BUZZ_GRANT_EXPIRES_AT ?? '');
  if (typeof binding.BUZZ_FI_GRANT_TOKEN !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(binding.BUZZ_FI_GRANT_TOKEN) ||
      !Number.isFinite(grantExpiry) || grantExpiry <= now) throw new Error('Enrolled agent grant is expired or invalid');
  return { secret, agentPubkey, ownerPubkey, authTag: parseOwnerAuthTag(binding, agentPubkey, ownerPubkey, now) };
}

async function readJsonBounded(response, limit = 16 * 1024) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new Error('Relay profile response is too large');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw new Error('Relay profile response is too large');
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Relay profile response is too large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Publish the owner's least-privilege directory policy for an enrolled agent.
 * The owner signs both the identity NIP-98 proof and kind:30177 event. The
 * owner-only policy is the default; allowlist is accepted only with explicit
 * nonempty pubkeys. This event is required for Desktop to discover an
 * externally enrolled agent from its NIP-OA profile.
 */
export async function publishAgentPolicy({
  identityOrigin,
  relayUrl,
  owner,
  session,
  agentPubkey,
  displayName,
  respondTo = 'owner-only',
  allowlist = [],
  fetchImpl = globalThis.fetch,
  now = Date.now(),
}) {
  const assertionEndpoint = humanAssertionEndpoint(identityOrigin);
  const endpoint = profileEndpoint(relayUrl);
  if (!owner || typeof owner.secret_hex !== 'string' || !/^[a-f0-9]{64}$/.test(owner.secret_hex) ||
      typeof owner.pubkey !== 'string' || !/^[a-f0-9]{64}$/.test(owner.pubkey)) {
    throw new Error('Stored owner identity is invalid');
  }
  const ownerIdentity = { secret: Buffer.from(owner.secret_hex, 'hex'), pubkey: getPublicKey(Buffer.from(owner.secret_hex, 'hex')) };
  if (ownerIdentity.pubkey !== owner.pubkey) throw new Error('Stored owner identity does not match its public key');
  if (!session || session.base !== identityOrigin || typeof session.session_token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(session.session_token)) throw new Error('Operator identity session is invalid or mismatched');
  if (typeof agentPubkey !== 'string' || !/^[a-f0-9]{64}$/.test(agentPubkey) || agentPubkey === owner.pubkey) {
    throw new Error('Agent public identity is invalid');
  }
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 128 || /[\r\n\0]/.test(displayName)) {
    throw new Error('Agent display name is invalid');
  }
  if (!['owner-only', 'allowlist'].includes(respondTo)) throw new Error('Agent policy must be owner-only or allowlist');
  if (!Array.isArray(allowlist) || allowlist.some((pubkey) => typeof pubkey !== 'string' || !/^[a-f0-9]{64}$/.test(pubkey)) ||
      (respondTo === 'allowlist' && allowlist.length === 0) || (respondTo === 'owner-only' && allowlist.length > 0)) {
    throw new Error('Agent policy allowlist is invalid');
  }
  if (new Set(allowlist).size !== allowlist.length) throw new Error('Agent policy allowlist contains duplicates');
  if (typeof fetchImpl !== 'function') throw new Error('HTTP fetch is unavailable');
  const assertion = await requestHumanAssertion({
    endpoint: assertionEndpoint,
    identityOrigin,
    relayUrl,
    owner: ownerIdentity,
    session,
    fetchImpl,
    now,
  });
  const content = {
    name: displayName.trim(),
    parallelism: 1,
    respond_to: respondTo,
    ...(respondTo === 'allowlist' ? { respond_to_allowlist: allowlist } : {}),
  };
  const policyEvent = finalizeEvent({
    kind: 30177,
    created_at: Math.floor(now / 1000),
    content: JSON.stringify(content),
    tags: [['d', agentPubkey]],
  }, ownerIdentity.secret);
  const body = JSON.stringify(policyEvent);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: nip98Authorization(ownerIdentity, endpoint, body, now),
        'content-type': 'application/json',
        'nostr-federated-identity': `Bearer ${assertion}`,
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Could not reach the configured relay to publish the agent policy');
  }
  if (!response.ok) throw new Error(`Relay refused the agent policy (HTTP ${response.status})`);
  let result;
  try { result = await readJsonBounded(response); }
  catch { throw new Error('Relay returned an invalid agent-policy response'); }
  if (!result || result.accepted !== true) throw new Error('Relay did not accept the agent policy');
  return { agentPubkey, displayName: displayName.trim(), eventId: policyEvent.id };
}

/**
 * Publish the enrolled agent's NIP-01 profile on the deployment's exact relay.
 * The profile event and NIP-98 HTTP proof use the agent key; the enrolled
 * owner proof is attached to both the event and request, matching desktop sync.
 * Kind 0 is replaceable: this operator-owned snapshot intentionally contains
 * only display_name, matching the upstream helper's profile builder. Activation
 * may later replace it with the desktop-managed profile snapshot.
 */
export async function publishAgentProfile({
  identityOrigin,
  relayUrl,
  binding,
  agentPubkey,
  ownerPubkey,
  displayName,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
}) {
  const assertionEndpoint = identityAssertionEndpoint(identityOrigin);
  const endpoint = profileEndpoint(relayUrl);
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 128 || /[\r\n\0]/.test(displayName)) {
    throw new Error('Agent display name is invalid');
  }
  if (typeof fetchImpl !== 'function') throw new Error('HTTP fetch is unavailable');
  const identity = agentIdentity(binding, agentPubkey, ownerPubkey, now);
  const assertion = await requestIdentityAssertion({
    endpoint: assertionEndpoint,
    identityOrigin,
    relayUrl,
    identity,
    binding,
    fetchImpl,
    now,
  });
  const profileEvent = finalizeEvent({
    kind: 0,
    created_at: Math.floor(now / 1000),
    content: JSON.stringify({ display_name: displayName }),
    tags: [identity.authTag],
  }, identity.secret);
  const body = JSON.stringify(profileEvent);

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: nip98Authorization(identity, endpoint, body, now),
        'content-type': 'application/json',
        'nostr-federated-identity': `Bearer ${assertion}`,
        'x-auth-tag': binding.BUZZ_AUTH_TAG,
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Could not reach the configured relay to publish the agent profile');
  }
  if (!response.ok) throw new Error(`Relay refused the agent profile (HTTP ${response.status})`);
  let result;
  try { result = await readJsonBounded(response); }
  catch { throw new Error('Relay returned an invalid agent-profile response'); }
  if (!result || result.accepted !== true) throw new Error('Relay did not accept the agent profile');
  return { agentPubkey: identity.agentPubkey, displayName, eventId: profileEvent.id };
}
