import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createIdentityApp } from '../src/server.mjs';
import { sha256 } from '../src/security.mjs';

const prefix = 'buzz_identity.';
const hash = (value) => sha256(value);
const secretChallenge = (value) => createHash('sha256').update(value).digest('base64url');

function exchangePool({ codeHash, challenge, principalId, email, expiresAt }) {
  const state = { consumed: false, sessions: [], events: [], ownerEpoch: 0, grantsRevoked: false };
  const client = {
    async query(sql, args = []) {
      state.events.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return { rows: [], rowCount: 0 };
      if (sql.includes(`UPDATE ${prefix}login_codes SET consumed_at`)) {
        const valid = args[0] === codeHash && args[1] === challenge && !state.consumed;
        if (!valid) return { rows: [], rowCount: 0 };
        state.consumed = true;
        return { rows: [{ principal_id: principalId, email }], rowCount: 1 };
      }
      if (sql.includes(`INSERT INTO ${prefix}sessions`)) {
        state.sessions.push({ token_hash: args[0], principal_id: args[1], email: args[2], current_email: args[2], expires_at: args[3], revoked_at: null });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes(`UPDATE ${prefix}sessions SET revoked_at`)) {
        const row = state.sessions.find((item) => item.token_hash === args[0] && !item.revoked_at);
        if (row) row.revoked_at = new Date();
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes(`UPDATE ${prefix}principals SET grant_epoch`)) {
        state.ownerEpoch += 1;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes(`UPDATE ${prefix}agent_grants SET revoked_at`)) {
        state.grantsRevoked = true;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() { state.events.push('released'); },
  };
  return {
    state,
    async connect() { return client; },
    async query(sql, args = []) {
      if (sql.includes(`FROM ${prefix}sessions s JOIN ${prefix}principals`)) {
        const row = state.sessions.find((item) => item.token_hash === args[0] && !item.revoked_at);
        return { rows: row ? [{ ...row, issuer: 'https://sso.example',
  allowedEmails: new Set(['pilot@example.org']), upstream_sub: 'private', nostr_pubkey: null, current_email: row.current_email, grant_epoch: 0 }] : [], rowCount: row ? 1 : 0 };
      }
      throw new Error(`Unexpected pool SQL: ${sql}`);
    },
  };
}

const appConfig = {
  publicBase: 'https://identity.example',
  redirectUri: 'https://identity.example/oauth2/callback',
  issuer: 'https://sso.example',
  allowedEmails: new Set(['pilot@example.org']),
  relays: new Set(['wss://relay.example']),
  sessionTtlSeconds: 3600,
  handoffTtlSeconds: 180,
};

test('handoff exchange is bound to the secret, single-use, and yields one fixed persistent session', async (t) => {
  const secret = Buffer.alloc(32, 7).toString('base64url');
  const code = Buffer.alloc(32, 8).toString('base64url');
  const expiresAt = new Date(Date.now() + 3600_000);
  const pool = exchangePool({ codeHash: hash(code), challenge: secretChallenge(secret), principalId: '00000000-0000-4000-8000-000000000001', email: 'pilot@example.org', expiresAt });
  const app = createIdentityApp({ config: appConfig, pool, oidc: {} });
  t.after(() => app.close());

  const wrongSecret = await app.inject({ method: 'POST', url: '/v1/login/exchange', payload: { code, handoff_secret: 'x'.repeat(43) } });
  assert.equal(wrongSecret.statusCode, 401);
  assert.equal(pool.state.consumed, false);

  const issued = await app.inject({ method: 'POST', url: '/v1/login/exchange', payload: { code, handoff_secret: secret } });
  assert.equal(issued.statusCode, 200);
  const session = issued.json();
  assert.equal(session.email, 'pilot@example.org');
  assert.equal(session.profile_projection, null);
  assert.equal(pool.state.sessions.length, 1);
  assert.equal(pool.state.sessions[0].expires_at.toISOString(), session.expires_at);

  const secondExchange = await app.inject({ method: 'POST', url: '/v1/login/exchange', payload: { code, handoff_secret: secret } });
  assert.equal(secondExchange.statusCode, 401);
  const checked = await app.inject({ method: 'GET', url: '/v1/session', headers: { authorization: `Bearer ${session.session_token}` } });
  assert.equal(checked.statusCode, 200);
  assert.equal(checked.json().expires_at, session.expires_at);
  assert.equal(checked.json().session_token, undefined);
  assert.ok(pool.state.events.includes('COMMIT'));

  const logout = await app.inject({ method: 'POST', url: '/v1/logout', headers: { authorization: `Bearer ${session.session_token}` } });
  assert.equal(logout.statusCode, 204);
  assert.equal(pool.state.ownerEpoch, 1);
  assert.equal(pool.state.grantsRevoked, true);
  const afterLogout = await app.inject({ method: 'GET', url: '/v1/session', headers: { authorization: `Bearer ${session.session_token}` } });
  assert.equal(afterLogout.statusCode, 401);
  assert.deepEqual(afterLogout.json(), { error: 'session_required' });
});

test('session endpoint distinguishes missing credentials and rejects malformed Bearer syntax', async (t) => {
  const pool = { async query(sql) { if (sql.includes('FROM buzz_identity.sessions')) return { rows: [], rowCount: 0 }; throw new Error('must not query for malformed credentials'); } };
  const app = createIdentityApp({ config: appConfig, pool, oidc: {} });
  t.after(() => app.close());
  const missing = await app.inject({ method: 'GET', url: '/v1/session' });
  assert.equal(missing.statusCode, 401);
  assert.deepEqual(missing.json(), { error: 'session_required' });
  const assertionWithoutSession = await app.inject({ method: 'POST', url: '/v1/identity/assertions', payload: {} });
  assert.equal(assertionWithoutSession.statusCode, 401);
  assert.deepEqual(assertionWithoutSession.json(), { error: 'session_required' });
  const unusableBearer = await app.inject({ method: 'GET', url: '/v1/session', headers: { authorization: 'Bearer short' } });
  assert.equal(unusableBearer.statusCode, 401);
  assert.deepEqual(unusableBearer.json(), { error: 'session_required' });
  const malformed = await app.inject({ method: 'GET', url: '/v1/session', headers: { authorization: 'Basic abc' } });
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.json(), { error: 'invalid_request' });
  const duplicate = await app.inject({ method: 'GET', url: '/v1/session', headers: { authorization: ['Bearer ' + 'a'.repeat(43), 'Bearer ' + 'b'.repeat(43)] } });
  assert.equal(duplicate.statusCode, 400);
  assert.deepEqual(duplicate.json(), { error: 'invalid_request' });
  const tooLarge = await app.inject({ method: 'POST', url: '/v1/login/exchange', headers: { 'content-type': 'application/json' }, payload: 'x'.repeat(4097) });
  assert.equal(tooLarge.statusCode, 413);
  assert.deepEqual(tooLarge.json(), { error: 'request_too_large' });
  const unknownField = await app.inject({ method: 'POST', url: '/v1/login/exchange', payload: { code: 'x', handoff_secret: 'x'.repeat(43), extra: true } });
  assert.equal(unknownField.statusCode, 400);
  assert.deepEqual(unknownField.json(), { error: 'invalid_request' });
});
