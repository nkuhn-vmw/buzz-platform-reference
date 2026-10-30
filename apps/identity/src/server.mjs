import Fastify from 'fastify';
import { Pool } from 'pg';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { buildAuthorizationUrl, authorizationCodeGrant, randomPKCECodeVerifier, calculatePKCECodeChallenge, randomNonce } from 'openid-client';
import { SignJWT, importJWK } from 'jose';
import { allowedEmail, canonicalRelayAudience, equalSecret, parseNostrAuthorization, sha256, validateReturnTo, verifyNip98 } from './security.mjs';
import { initializeStore, cleanupExpiredRows, SCHEMA, withTransaction, getOrCreatePrincipal } from './store.mjs';
import { loadConfig } from './config.mjs';
import { verifiedLoginEmail } from './oidc.mjs';
import { discoverBoundOidc } from './oidc-discovery.mjs';
import { createWindowLimiter } from './rate-limit.mjs';

const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
const secretHash = (token) => sha256(token);
const challengeFor = (secret) => createHash('sha256').update(secret).digest('base64url');
const errorBody = (reply, status, code) => {
  // Log only fixed response metadata. Never include request, credential, proof,
  // identity, or response-body values in operational denial records.
  try { console.warn(JSON.stringify({ event: 'identity_request_denied', status, error: code })); } catch { /* logging must not change the response */ }
  return reply.code(status).header('cache-control', 'no-store').send({ error: code });
};
const jsonShape = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === keys.length && keys.every((key) => Object.hasOwn(body, key));

function headerValues(request, name) {
  const found = [];
  for (let i = 0; i < request.raw.rawHeaders.length; i += 2) {
    if (request.raw.rawHeaders[i].toLowerCase() === name.toLowerCase()) found.push(request.raw.rawHeaders[i + 1]);
  }
  return found;
}

function parseBearer(request) {
  const values = headerValues(request, 'authorization');
  if (values.length !== 1) return { error: values.length ? 'invalid_request' : 'session_required' };
  const match = /^Bearer ([A-Za-z0-9_-]*)$/.exec(values[0]);
  return match ? { token: match[1] } : { error: 'invalid_request' };
}

function parseNipProof(request) {
  const values = headerValues(request, 'nostr-authorization');
  if (values.length !== 1) return { error: 'invalid_request' };
  const proof = parseNostrAuthorization(values[0]);
  return proof ? { proof } : { error: 'invalid_proof' };
}

function appUrl(config, request) {
  return new URL(request.raw.url, config.publicBase).href;
}

async function findSession(pool, token, allowedEmails) {
  const result = await pool.query(
    `SELECT s.*, p.issuer, p.upstream_sub, p.nostr_pubkey, p.email AS current_email, p.grant_epoch FROM ${SCHEMA}.sessions s JOIN ${SCHEMA}.principals p ON p.id = s.principal_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
    [secretHash(token)],
  );
  const session = result.rows[0];
  if (!session || !allowedEmail(session.current_email, allowedEmails)) return { error: 'session_required' };
  if (new Date(session.expires_at).getTime() <= Date.now()) return { error: 'session_expired' };
  session.email = session.current_email;
  return { session };
}

async function verifyProof(request, proof, expectedKey, config) {
  if (!expectedKey || !/^[0-9a-f]{64}$/.test(expectedKey)) return false;
  const contentEncoding = headerValues(request, 'content-encoding');
  if (contentEncoding.some((value) => value.toLowerCase() !== 'identity')) return false;
  return verifyNip98({
    proof,
    method: request.method,
    url: appUrl(config, request),
    body: request.rawBody ?? Buffer.alloc(0),
    expectedPubkey: expectedKey,
  });
}

async function bindHumanKey(pool, session, pubkey) {
  try {
    return await withTransaction(pool, async (client) => {
    const result = await client.query(`SELECT nostr_pubkey FROM ${SCHEMA}.principals WHERE id = $1 FOR UPDATE`, [session.principal_id]);
    if (!result.rowCount) return false;
    const bound = result.rows[0].nostr_pubkey?.trim();
    if (bound && bound !== pubkey) return false;
    const role = await client.query(`SELECT role, owner_id FROM ${SCHEMA}.key_roles WHERE pubkey = $1 FOR UPDATE`, [pubkey]);
    if (role.rowCount && (role.rows[0].role !== 'human' || role.rows[0].owner_id !== session.principal_id)) return false;
    if (!role.rowCount) {
      await client.query(`INSERT INTO ${SCHEMA}.key_roles (pubkey, role, owner_id) VALUES ($1, 'human', $2)`, [pubkey, session.principal_id]);
    }
    if (!bound) await client.query(`UPDATE ${SCHEMA}.principals SET nostr_pubkey = $2 WHERE id = $1`, [session.principal_id, pubkey]);
      return true;
    });
  } catch (error) {
    if (error.code === '23505') return false;
    throw error;
  }
}

async function signAssertion(config, { session, nostrPubkey, audience, ownerPubkey = null, lifetime = 300 }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.min(now + Math.min(300, lifetime), session.expires_at ? Math.floor(new Date(session.expires_at).getTime() / 1000) : Number.MAX_SAFE_INTEGER);
  if (exp <= now) throw new Error('assertion lifetime ended');
  const claims = {
    iss: config.issuer,
    sub: session.principal_id,
    aud: audience,
    nostr_pubkey: nostrPubkey,
    jti: randomUUID(),
  };
  if (ownerPubkey) claims.nostr_owner_pubkey = ownerPubkey;
  const assertion = await new SignJWT(claims).setProtectedHeader({ alg: config.alg, typ: ownerPubkey ? 'nip-fi-agent+jwt' : 'nip-fi+jwt', kid: config.kid }).setIssuedAt(now).setExpirationTime(exp).sign(config.signingKey);
  return { assertion, nostr_pubkey: nostrPubkey, expires_at: exp };
}

export function createIdentityApp({ config, pool, oidc, clock = () => Date.now() }) {
  const app = Fastify({ logger: false, bodyLimit: 4096, trustProxy: 1 });
  const loginLimiter = createWindowLimiter({ maxHits: 20, windowMs: 60_000, maxKeys: 10_000, now: clock });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    request.rawBody = body;
    try { done(null, JSON.parse(body.toString('utf8'))); }
    catch { done(new Error('invalid_json')); }
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (headerValues(request, 'content-encoding').some((v) => v.toLowerCase() !== 'identity')) return errorBody(reply, 400, 'invalid_request');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error.statusCode === 413) return errorBody(reply, 413, 'request_too_large');
    if (error.statusCode === 429) return errorBody(reply, 429, 'rate_limited');
    if (error.statusCode >= 400 && error.statusCode < 500) {
      if (request.raw.url?.split('?')[0] === '/v1/identity/assertions') {
        const auth = parseBearer(request);
        if (auth.error === 'session_required') return errorBody(reply, 401, 'session_required');
      }
      return errorBody(reply, 400, 'invalid_request');
    }
    return errorBody(reply, 503, 'issuance_unavailable');
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/v1/login/start', async (request, reply) => {
    const rate = loginLimiter(request.ip);
    if (!rate.allowed) return reply.header('retry-after', String(rate.retryAfter)).code(429).header('cache-control', 'no-store').send({ error: 'rate_limited' });
    const q = request.query ?? {};
    if (Object.keys(q).some((key) => !['return_to', 'handoff_challenge', 'handoff_challenge_method'].includes(key)) ||
        !validateReturnTo(q.return_to) || !/^[A-Za-z0-9_-]{43}$/.test(q.handoff_challenge ?? '') || q.handoff_challenge_method !== 'S256') {
      return errorBody(reply, 400, 'invalid_request');
    }
    await cleanupExpiredRows(pool);
    const state = randomToken(32);
    const nonce = randomNonce();
    const verifier = randomPKCECodeVerifier();
    const expiresAt = new Date(clock() + 10 * 60 * 1000);
    await pool.query(`INSERT INTO ${SCHEMA}.browser_flows (state_hash, nonce, verifier, return_to, handoff_challenge, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [secretHash(state), nonce, verifier, q.return_to, q.handoff_challenge, expiresAt]);
    reply.header('set-cookie', `buzz_oidc_state=${state}; Path=/oauth2/callback; Max-Age=600; Secure; HttpOnly; SameSite=Lax`);
    const url = buildAuthorizationUrl(oidc, {
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'openid roles',
      state,
      nonce,
      code_challenge: await calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
    });
    return reply.code(302).header('location', url.href).send();
  });

  app.get('/oauth2/callback', async (request, reply) => {
    const cookieHeaders = headerValues(request, 'cookie');
    const cookies = (cookieHeaders[0] ?? '').split(';').map((v) => v.trim());
    const stateCookies = cookies.filter((v) => v.startsWith('buzz_oidc_state='));
    const stateCookie = stateCookies.length === 1 && cookieHeaders.length === 1 ? stateCookies[0].slice('buzz_oidc_state='.length) : null;
    const { state, code, error } = request.query ?? {};
    if (error || typeof state !== 'string' || typeof code !== 'string' || !stateCookie || !equalSecret(state, stateCookie)) return errorBody(reply, 401, 'authorization_denied');
    const result = await pool.query(`DELETE FROM ${SCHEMA}.browser_flows WHERE state_hash = $1 AND expires_at > now() RETURNING *`, [secretHash(state)]);
    const flow = result.rows[0];
    if (!flow) return errorBody(reply, 401, 'authorization_denied');
    reply.header('set-cookie', 'buzz_oidc_state=; Path=/oauth2/callback; Max-Age=0; Secure; HttpOnly; SameSite=Lax');
    const tokenSet = await authorizationCodeGrant(oidc, new URL(request.raw.url, config.publicBase), {
      pkceCodeVerifier: flow.verifier,
      expectedState: state,
      expectedNonce: flow.nonce,
    });
    const claims = tokenSet.claims();
    if (!claims || claims.iss !== config.oidcIssuer || claims.aud !== config.clientId && !(Array.isArray(claims.aud) && claims.aud.includes(config.clientId)) ||
        typeof claims.sub !== 'string' || !claims.sub) return errorBody(reply, 403, 'authorization_denied');
    const email = await verifiedLoginEmail(oidc, tokenSet);
    if (!allowedEmail(email, config.allowedEmails)) return errorBody(reply, 403, 'authorization_denied');
    const principal = await withTransaction(pool, (client) => getOrCreatePrincipal(client, claims.iss, claims.sub, email.trim().toLowerCase()));
    const codeValue = randomToken(32);
    await pool.query(`INSERT INTO ${SCHEMA}.login_codes (code_hash, principal_id, handoff_challenge, email, expires_at) VALUES ($1,$2,$3,$4,$5)`,
      [secretHash(codeValue), principal.id, flow.handoff_challenge, principal.email, new Date(clock() + config.handoffTtlSeconds * 1000)]);
    const callback = new URL(flow.return_to);
    callback.searchParams.set('code', codeValue);
    return reply.code(302).header('location', callback.href).send();
  });

  app.post('/v1/login/exchange', async (request, reply) => {
    if (!jsonShape(request.body, ['code', 'handoff_secret']) || typeof request.body.code !== 'string' || typeof request.body.handoff_secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(request.body.handoff_secret)) return errorBody(reply, 400, 'invalid_request');
    const handoffChallenge = challengeFor(request.body.handoff_secret);
    const token = randomToken(32);
    const expires = new Date(clock() + config.sessionTtlSeconds * 1000);
    const code = await withTransaction(pool, async (client) => {
      const result = await client.query(`UPDATE ${SCHEMA}.login_codes SET consumed_at = now() WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND handoff_challenge = $2 RETURNING *`, [secretHash(request.body.code), handoffChallenge]);
      const consumed = result.rows[0];
      if (!consumed) return null;
      await client.query(`INSERT INTO ${SCHEMA}.sessions (token_hash, principal_id, email, expires_at) VALUES ($1,$2,$3,$4)`, [secretHash(token), consumed.principal_id, consumed.email, expires]);
      return consumed;
    });
    if (!code) return errorBody(reply, 401, 'authorization_denied');
    return reply.send({ session_token: token, expires_at: expires.toISOString(), email: code.email, profile_projection: null });
  });

  app.get('/v1/session', async (request, reply) => {
    const auth = parseBearer(request);
    if (auth.error) return errorBody(reply, auth.error === 'session_required' ? 401 : 400, auth.error);
    const found = await findSession(pool, auth.token, config.allowedEmails);
    if (found.error) return errorBody(reply, 401, found.error);
    return reply.send({ expires_at: new Date(found.session.expires_at).toISOString(), email: found.session.email, profile_projection: null });
  });

  app.post('/v1/logout', async (request, reply) => {
    const auth = parseBearer(request);
    if (auth.error) return errorBody(reply, auth.error === 'session_required' ? 401 : 400, auth.error);
    const found = await findSession(pool, auth.token, config.allowedEmails);
    if (found.error) return errorBody(reply, 401, found.error);
    await withTransaction(pool, async (client) => {
      await client.query(`UPDATE ${SCHEMA}.sessions SET revoked_at = now() WHERE token_hash = $1`, [secretHash(auth.token)]);
      await client.query(`UPDATE ${SCHEMA}.principals SET grant_epoch = grant_epoch + 1 WHERE id = $1`, [found.session.principal_id]);
      await client.query(`UPDATE ${SCHEMA}.agent_grants SET revoked_at = now() WHERE owner_id = $1 AND revoked_at IS NULL`, [found.session.principal_id]);
    });
    return reply.code(204).send();
  });

  app.post('/v1/identity/assertions', async (request, reply) => {
    const auth = parseBearer(request);
    if (auth.error) return errorBody(reply, auth.error === 'session_required' ? 401 : 400, auth.error);
    const found = await findSession(pool, auth.token, config.allowedEmails);
    if (found.error) return errorBody(reply, 401, found.error);
    if (request.raw.url !== '/v1/identity/assertions') return errorBody(reply, 400, 'invalid_request');
    if (!jsonShape(request.body, ['relay_url', 'nostr_pubkey']) || typeof request.body.nostr_pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(request.body.nostr_pubkey)) return errorBody(reply, 400, 'invalid_request');
    const proofHeader = parseNipProof(request);
    if (proofHeader.error) return errorBody(reply, proofHeader.error === 'invalid_proof' ? 403 : 400, proofHeader.error);
    const audience = canonicalRelayAudience(request.body.relay_url, config.relays);
    if (!audience) return errorBody(reply, 403, 'authorization_denied');
    if (!await verifyProof(request, proofHeader.proof, request.body.nostr_pubkey, config)) return errorBody(reply, 403, 'invalid_proof');
    if (!await bindHumanKey(pool, found.session, request.body.nostr_pubkey)) return errorBody(reply, 403, 'binding_mismatch');
    const response = await signAssertion(config, { session: found.session, nostrPubkey: request.body.nostr_pubkey, audience, lifetime: 300 });
    return reply.send(response);
  });

  app.post('/v1/agents/grants', async (request, reply) => {
    const auth = parseBearer(request);
    if (auth.error) return errorBody(reply, auth.error === 'session_required' ? 401 : 400, auth.error);
    const found = await findSession(pool, auth.token, config.allowedEmails);
    if (found.error) return errorBody(reply, 401, found.error);
    if (request.raw.url !== '/v1/agents/grants') return errorBody(reply, 400, 'invalid_request');
    if (!jsonShape(request.body, ['agent_pubkey', 'relay_url']) || typeof request.body.agent_pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(request.body.agent_pubkey)) return errorBody(reply, 400, 'invalid_request');
    const proofHeader = parseNipProof(request);
    if (proofHeader.error) return errorBody(reply, proofHeader.error === 'invalid_proof' ? 403 : 400, proofHeader.error);
    const audience = canonicalRelayAudience(request.body.relay_url, config.relays);
    if (!audience) return errorBody(reply, 403, 'authorization_denied');
    const ownerKey = proofHeader.proof.pubkey;
    if (!await verifyProof(request, proofHeader.proof, ownerKey, config)) return errorBody(reply, 403, 'invalid_proof');
    if (ownerKey === request.body.agent_pubkey || !await bindHumanKey(pool, found.session, ownerKey)) return errorBody(reply, 403, 'binding_mismatch');
    const grantId = randomUUID();
    const grantToken = randomToken(32);
    try {
      const created = await withTransaction(pool, async (client) => {
        const liveSession = await client.query(`SELECT token_hash FROM ${SCHEMA}.sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`, [secretHash(auth.token)]);
        if (!liveSession.rowCount) return false;
        const principal = await client.query(`SELECT grant_epoch FROM ${SCHEMA}.principals WHERE id = $1 FOR UPDATE`, [found.session.principal_id]);
        if (!principal.rowCount) return false;
        await client.query(`INSERT INTO ${SCHEMA}.key_roles (pubkey, role, owner_id) VALUES ($1, 'agent', $2) ON CONFLICT (pubkey) DO NOTHING`, [request.body.agent_pubkey, found.session.principal_id]);
        const role = await client.query(`SELECT role, owner_id FROM ${SCHEMA}.key_roles WHERE pubkey = $1 FOR UPDATE`, [request.body.agent_pubkey]);
        if (!role.rowCount || role.rows[0].role !== 'agent' || role.rows[0].owner_id !== found.session.principal_id) return false;
        // An expired grant still occupies the active-key uniqueness slot. Replace
        // the previous same-owner grant atomically; a different owner was refused above.
        await client.query(`UPDATE ${SCHEMA}.agent_grants SET revoked_at = now() WHERE agent_pubkey = $1 AND owner_id = $2 AND revoked_at IS NULL`, [request.body.agent_pubkey, found.session.principal_id]);
        await client.query(`INSERT INTO ${SCHEMA}.agent_grants (id, owner_id, owner_pubkey, agent_pubkey, relay_url, token_hash, owner_epoch, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [grantId, found.session.principal_id, ownerKey, request.body.agent_pubkey, request.body.relay_url, secretHash(grantToken), principal.rows[0].grant_epoch, found.session.expires_at]);
        return true;
      });
      if (!created) return errorBody(reply, 403, 'authorization_denied');
    } catch (error) {
      if (error.code === '23505') return errorBody(reply, 403, 'authorization_denied');
      throw error;
    }
    return reply.code(201).send({ grant_id: grantId, grant_token: grantToken, expires_at: new Date(found.session.expires_at).toISOString() });
  });

  app.post('/v1/agents/assertions', async (request, reply) => {
    const auth = parseBearer(request);
    if (auth.error) return errorBody(reply, auth.error === 'session_required' ? 401 : 400, auth.error);
    if (request.raw.url !== '/v1/agents/assertions') return errorBody(reply, 400, 'invalid_request');
    if (!jsonShape(request.body, ['agent_pubkey', 'relay_url']) || typeof request.body.agent_pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(request.body.agent_pubkey)) return errorBody(reply, 400, 'invalid_request');
    const proofHeader = parseNipProof(request);
    if (proofHeader.error) return errorBody(reply, proofHeader.error === 'invalid_proof' ? 403 : 400, proofHeader.error);
    const audience = canonicalRelayAudience(request.body.relay_url, config.relays);
    if (!audience) return errorBody(reply, 403, 'authorization_denied');
    const result = await pool.query(`SELECT g.*, p.issuer, p.upstream_sub, p.email AS owner_email, p.grant_epoch FROM ${SCHEMA}.agent_grants g JOIN ${SCHEMA}.principals p ON p.id = g.owner_id WHERE g.token_hash = $1 AND g.revoked_at IS NULL AND g.expires_at > now()`, [secretHash(auth.token)]);
    const grant = result.rows[0];
    if (!grant || !allowedEmail(grant.owner_email, config.allowedEmails) || String(grant.owner_epoch) !== String(grant.grant_epoch) || grant.agent_pubkey.trim() !== request.body.agent_pubkey || grant.relay_url !== request.body.relay_url) return errorBody(reply, 403, 'authorization_denied');
    if (!await verifyProof(request, proofHeader.proof, grant.agent_pubkey.trim(), config)) return errorBody(reply, 403, 'invalid_proof');
    return reply.send(await signAssertion(config, { session: { principal_id: grant.owner_id, expires_at: grant.expires_at }, nostrPubkey: grant.agent_pubkey.trim(), ownerPubkey: grant.owner_pubkey.trim(), audience, lifetime: 300 }));
  });

  app.delete('/v1/agents/grants/:grant_id', async (request, reply) => {
    if (request.raw.url.includes('?')) return errorBody(reply, 400, 'invalid_request');
    const auth = parseBearer(request);
    if (auth.error) return errorBody(reply, auth.error === 'session_required' ? 401 : 400, auth.error);
    const found = await findSession(pool, auth.token, config.allowedEmails);
    if (found.error) return errorBody(reply, 401, found.error);
    const proofHeader = parseNipProof(request);
    if (proofHeader.error) return errorBody(reply, proofHeader.error === 'invalid_proof' ? 403 : 400, proofHeader.error);
    if (!await verifyProof(request, proofHeader.proof, found.session.nostr_pubkey?.trim(), config)) return errorBody(reply, 403, 'invalid_proof');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.grant_id)) return errorBody(reply, 400, 'invalid_request');
    const updated = await pool.query(`UPDATE ${SCHEMA}.agent_grants SET revoked_at = now() WHERE id = $1 AND owner_id = $2 AND owner_pubkey = $3 AND revoked_at IS NULL RETURNING id`, [request.params.grant_id, found.session.principal_id, found.session.nostr_pubkey?.trim()]);
    if (!updated.rowCount) return errorBody(reply, 403, 'authorization_denied');
    return reply.code(204).send();
  });

  app.get('/.well-known/jwks.json', async (request, reply) => reply.send({ keys: [config.publicJwk] }));
  return app;
}

const SAFE_STARTUP_MESSAGES = new Set([
  'VCAP_SERVICES is required', 'Invalid service binding shape', 'Invalid service binding credentials',
  'buzz-identity-db PostgreSQL service binding is required', 'Invalid PostgreSQL credentials',
  'buzz-sso p-identity service binding is required', 'Invalid buzz-sso p-identity binding', 'Invalid p-identity binding',
  'ALLOWED_EMAILS_JSON is required and must be a non-empty JSON array', 'ALLOWED_EMAILS_JSON must be a JSON array',
  'ALLOWED_EMAILS_JSON must be a non-empty array of exact email addresses', 'ALLOWED_EMAILS_JSON must not contain duplicates',
  'PUBLIC_BASE_URL must be an HTTPS origin', 'NIP_FI_SIGNING_KEY is required from env or the buzz-identity-secrets binding',
  'Signing key must be RSA or P-256 EC', 'RELAY_URLS is required', 'NIP_FI_ISSUER must be HTTPS',
  'OIDC and session configuration is incomplete', 'OIDC discovery contract mismatch', 'Invalid URL',
]);

function startupFailureRecord(phase, error) {
  const record = { event: 'identity_startup_failed', phase };
  const name = typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : 'Error';
  record.error_name = name;
  const code = typeof error?.code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(error.code) ? error.code : null;
  if (code) record.error_code = code;
  if (SAFE_STARTUP_MESSAGES.has(error?.message)) record.message = error.message;
  return record;
}

export async function startIdentityService({
  env = process.env,
  logger = (line) => console.error(line),
  configLoader = loadConfig,
  poolFactory = (config) => new Pool(config),
  storeInitializer = initializeStore,
  oidcDiscovery = discoverBoundOidc,
  appFactory = createIdentityApp,
} = {}) {
  let phase = 'config';
  let pool;
  let app;
  let mtlsServer;
  let cleanupTimer;
  try {
    const config = await configLoader(env);
    if (!config.authDomain || !config.clientId || !config.clientSecret || !Number.isSafeInteger(config.sessionTtlSeconds) || config.sessionTtlSeconds < 60 || config.sessionTtlSeconds > 86400) throw new Error('OIDC and session configuration is incomplete');
    config.signingKey = await importJWK(config.signingJwk, config.alg);

    phase = 'database';
    pool = poolFactory(config.pg);
    await storeInitializer(pool);
    await cleanupExpiredRows(pool);

    phase = 'oidc-discovery';
    const oidc = await oidcDiscovery(config);
    const metadata = oidc.serverMetadata();
    if (!metadata.issuer || (config.oidcIssuer && config.oidcIssuer !== metadata.issuer) || !metadata.authorization_endpoint?.startsWith('https://') || !metadata.token_endpoint?.startsWith('https://') || !metadata.jwks_uri?.startsWith('https://') || (metadata.userinfo_endpoint && !metadata.userinfo_endpoint.startsWith('https://'))) throw new Error('OIDC discovery contract mismatch');
    config.oidcIssuer = metadata.issuer;

    cleanupTimer = setInterval(() => {
      cleanupExpiredRows(pool).catch((error) => {
        try { logger(JSON.stringify({ ...startupFailureRecord('database-cleanup', error), event: 'identity_cleanup_failed' })); } catch { /* ignore logging failures */ }
      });
    }, 15 * 60 * 1000);
    cleanupTimer.unref();

    phase = 'listen';
    app = appFactory({ config, pool, oidc });
    const port = Number(env.PORT ?? 8080);
    await app.listen({ host: '0.0.0.0', port });
    if (env.JWKS_MTLS_ALLOWED_APP_GUID) {
      phase = 'jwks-mtls';
      const { startJwksServer } = await import('../cf-mtls/server.mjs');
      mtlsServer = await startJwksServer({
        jwks: { keys: [config.publicJwk] },
        allowedAppGuid: env.JWKS_MTLS_ALLOWED_APP_GUID,
        port: Number(env.JWKS_MTLS_PORT ?? 8443),
      });
    }
    const shutdown = async () => {
      clearInterval(cleanupTimer);
      if (mtlsServer) { mtlsServer.closeAllConnections(); mtlsServer.close(); }
      try { await app.close(); } catch { /* close the pool even if the listener already stopped */ }
      try { await pool.end(); } catch { /* shutdown should not expose connection details */ }
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    return { app, pool };
  } catch (error) {
    if (cleanupTimer) clearInterval(cleanupTimer);
    if (mtlsServer) { mtlsServer.closeAllConnections(); mtlsServer.close(); }
    if (app) { try { await app.close(); } catch { /* best effort cleanup */ } }
    if (pool) { try { await pool.end(); } catch { /* best effort cleanup */ } }
    try { logger(JSON.stringify(startupFailureRecord(phase, error))); } catch { /* logging must not mask startup failure */ }
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startIdentityService().catch(() => { process.exitCode = 1; });
}
