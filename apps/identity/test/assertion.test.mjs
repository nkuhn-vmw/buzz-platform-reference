import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { importJWK, jwtVerify } from 'jose';
import { createIdentityApp } from '../src/server.mjs';
import { sha256 } from '../src/security.mjs';

const schema = 'buzz_identity';
const principalId = randomUUID();
const token = randomBytes(32).toString('base64url');
const expiresAt = new Date(Date.now() + 3600_000);

function sessionAndBindingPool() {
  const state = { nostrPubkey: null };
  const client = {
    async query(sql, args = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (sql.includes(`SELECT nostr_pubkey FROM ${schema}.principals`)) return { rows: [{ nostr_pubkey: state.nostrPubkey }], rowCount: 1 };
      if (sql.includes(`SELECT role, owner_id FROM ${schema}.key_roles`)) return { rows: [], rowCount: 0 };
      if (sql.includes(`INSERT INTO ${schema}.key_roles`)) { state.nostrPubkey = args[0]; return { rows: [], rowCount: 1 }; }
      if (sql.includes(`UPDATE ${schema}.principals SET nostr_pubkey`)) { state.nostrPubkey = args[1]; return { rows: [], rowCount: 1 }; }
      throw new Error(`Unexpected transaction SQL: ${sql}`);
    },
    release() {},
  };
  return {
    state,
    async connect() { return client; },
    async query(sql, args = []) {
      if (sql.includes(`FROM ${schema}.sessions s JOIN ${schema}.principals`)) {
        if (args[0] !== sha256(token)) return { rows: [], rowCount: 0 };
        return { rows: [{ token_hash: args[0], principal_id: principalId, email: 'pilot@example.org', current_email: 'pilot@example.org', expires_at: expiresAt, revoked_at: null, nostr_pubkey: state.nostrPubkey, grant_epoch: 0 }], rowCount: 1 };
      }
      throw new Error(`Unexpected pool SQL: ${sql}`);
    },
  };
}

function proofFor(secretKey, pubkey, body, now = Math.floor(Date.now() / 1000)) {
  return finalizeEvent({
    created_at: now,
    kind: 27235,
    tags: [
      ['u', 'https://identity.example/v1/identity/assertions'],
      ['method', 'POST'],
      ['payload', sha256(Buffer.from(body))],
    ],
    content: '',
  }, secretKey);
}

test('human assertion binds key possession and signs the dedicated NIP-FI contract', async (t) => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKey = createPrivateKey({ key: pair.privateKey.export({ format: 'jwk' }), format: 'jwk' });
  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' });
  const signingKey = await importJWK({ ...privateKey.export({ format: 'jwk' }), alg: 'ES256' }, 'ES256');
  const config = {
    publicBase: 'https://identity.example', issuer: 'https://identity.example', relays: new Set(['wss://relay.example']),
    allowedEmails: new Set(['pilot@example.org']),
    sessionTtlSeconds: 3600, alg: 'ES256', kid: 'test-signing-key', signingKey,
    publicJwk: { ...publicJwk, alg: 'ES256', use: 'sig', kid: 'test-signing-key' },
  };
  const pool = sessionAndBindingPool();
  const app = createIdentityApp({ config, pool, oidc: {} });
  t.after(() => app.close());
  const clientKey = generateSecretKey();
  const clientPubkey = getPublicKey(clientKey);
  const body = JSON.stringify({ relay_url: 'wss://relay.example', nostr_pubkey: clientPubkey });
  const event = proofFor(clientKey, clientPubkey, body);
  const proofHeader = `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`;
  const duplicateProof = await app.inject({
    method: 'POST', url: '/v1/identity/assertions', payload: body,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'nostr-authorization': [proofHeader, proofHeader] },
  });
  assert.equal(duplicateProof.statusCode, 400);
  assert.deepEqual(duplicateProof.json(), { error: 'invalid_request' });
  const malformedProof = await app.inject({
    method: 'POST', url: '/v1/identity/assertions', payload: body,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'nostr-authorization': 'Nostr malformed' },
  });
  assert.equal(malformedProof.statusCode, 403);
  assert.deepEqual(malformedProof.json(), { error: 'invalid_proof' });
  const response = await app.inject({
    method: 'POST', url: '/v1/identity/assertions', payload: body,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'nostr-authorization': proofHeader },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(pool.state.nostrPubkey, clientPubkey);
  const { payload, protectedHeader } = await jwtVerify(response.json().assertion, await importJWK(publicJwk, 'ES256'), { issuer: 'https://identity.example', audience: 'https://relay.example' });
  assert.equal(protectedHeader.typ, 'nip-fi+jwt');
  assert.equal(protectedHeader.kid, 'test-signing-key');
  assert.equal(payload.sub, principalId);
  assert.equal(payload.nostr_pubkey, clientPubkey);
  assert.equal(payload.nostr_owner_pubkey, undefined);
  assert.ok(payload.exp - payload.iat <= 300);
  assert.equal(response.json().expires_at, payload.exp);

  const otherKey = generateSecretKey();
  const otherPubkey = getPublicKey(otherKey);
  const otherBody = JSON.stringify({ relay_url: 'wss://relay.example', nostr_pubkey: otherPubkey });
  const otherEvent = proofFor(otherKey, otherPubkey, otherBody);
  const mismatch = await app.inject({
    method: 'POST', url: '/v1/identity/assertions', payload: otherBody,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'nostr-authorization': `Nostr ${Buffer.from(JSON.stringify(otherEvent)).toString('base64')}` },
  });
  assert.equal(mismatch.statusCode, 403);
  assert.deepEqual(mismatch.json(), { error: 'binding_mismatch' });
});
