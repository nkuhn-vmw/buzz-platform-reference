import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, generateKeyPairSync } from 'node:crypto';
import { Pool } from 'pg';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { importJWK, jwtVerify } from 'jose';
import { createIdentityApp } from '../src/server.mjs';
import { sha256 } from '../src/security.mjs';
import { cleanupExpiredRows, initializeStore, SCHEMA } from '../src/store.mjs';

const connectionString = process.env.TEST_DATABASE_URL;

test('PostgreSQL preserves single-use codes, fixed sessions, and revoked owner grants across pool restart', { skip: !connectionString }, async () => {
  let pool = new Pool({ connectionString });
  try {
    await initializeStore(pool);
    await pool.query(`TRUNCATE ${SCHEMA}.agent_grants, ${SCHEMA}.sessions, ${SCHEMA}.login_codes, ${SCHEMA}.browser_flows, ${SCHEMA}.key_roles, ${SCHEMA}.principals CASCADE`);
    const principalId = randomUUID();
    const tokenHash = 'a'.repeat(64);
    const codeHash = 'b'.repeat(64);
    const agentTokenHash = 'c'.repeat(64);
    const ownerKey = '1'.repeat(64);
    const agentKey = '2'.repeat(64);
    const expiresAt = new Date(Date.now() + 60_000);
    await pool.query(`INSERT INTO ${SCHEMA}.principals (id, issuer, upstream_sub, email, nostr_pubkey) VALUES ($1,$2,$3,$4,$5)`,
      [principalId, 'https://identity.example', 'upstream-subject', 'pilot@example.org', ownerKey]);
    await pool.query(`INSERT INTO ${SCHEMA}.key_roles (pubkey, role, owner_id) VALUES ($1,'human',$2),($3,'agent',$2)`, [ownerKey, principalId, agentKey]);
    await pool.query(`INSERT INTO ${SCHEMA}.login_codes (code_hash,principal_id,handoff_challenge,email,expires_at) VALUES ($1,$2,$3,$4,$5)`, [codeHash, principalId, 'challenge', 'pilot@example.org', expiresAt]);
    await pool.query(`INSERT INTO ${SCHEMA}.sessions (token_hash,principal_id,email,expires_at) VALUES ($1,$2,$3,$4)`, [tokenHash, principalId, 'pilot@example.org', expiresAt]);
    await pool.query(`INSERT INTO ${SCHEMA}.browser_flows (state_hash,nonce,verifier,return_to,handoff_challenge,expires_at) VALUES ($1,$2,$3,$4,$5,now()-interval '1 second')`, ['d'.repeat(64), 'nonce', 'verifier', 'http://127.0.0.1:1234', 'challenge']);
    await pool.query(`INSERT INTO ${SCHEMA}.agent_grants (id,owner_id,owner_pubkey,agent_pubkey,relay_url,token_hash,owner_epoch,expires_at) VALUES ($1,$2,$3,$4,$5,$6,0,$7)`,
      [randomUUID(), principalId, ownerKey, agentKey, 'wss://relay.example', agentTokenHash, expiresAt]);

    const consumedOnce = await pool.query(`UPDATE ${SCHEMA}.login_codes SET consumed_at = now() WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND handoff_challenge = $2 RETURNING code_hash`, [codeHash, 'challenge']);
    const consumedTwice = await pool.query(`UPDATE ${SCHEMA}.login_codes SET consumed_at = now() WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND handoff_challenge = $2 RETURNING code_hash`, [codeHash, 'challenge']);
    assert.equal(consumedOnce.rowCount, 1);
    assert.equal(consumedTwice.rowCount, 0);
    await cleanupExpiredRows(pool);
    const expiredFlow = await pool.query(`SELECT 1 FROM ${SCHEMA}.browser_flows WHERE state_hash = $1`, ['d'.repeat(64)]);
    const consumedCode = await pool.query(`SELECT 1 FROM ${SCHEMA}.login_codes WHERE code_hash = $1`, [codeHash]);
    assert.equal(expiredFlow.rowCount, 0);
    assert.equal(consumedCode.rowCount, 0);

    await pool.end();
    pool = new Pool({ connectionString });
    const sessionBefore = await pool.query(`SELECT expires_at, revoked_at FROM ${SCHEMA}.sessions WHERE token_hash = $1`, [tokenHash]);
    const grantBefore = await pool.query(`SELECT owner_epoch FROM ${SCHEMA}.agent_grants WHERE token_hash = $1`, [agentTokenHash]);
    assert.equal(sessionBefore.rowCount, 1);
    assert.equal(new Date(sessionBefore.rows[0].expires_at).toISOString(), expiresAt.toISOString());
    assert.equal(sessionBefore.rows[0].revoked_at, null);
    assert.equal(grantBefore.rows[0].owner_epoch, '0');

    await pool.query('BEGIN');
    await pool.query(`UPDATE ${SCHEMA}.sessions SET revoked_at = now() WHERE token_hash = $1`, [tokenHash]);
    await pool.query(`UPDATE ${SCHEMA}.principals SET grant_epoch = grant_epoch + 1 WHERE id = $1`, [principalId]);
    await pool.query(`UPDATE ${SCHEMA}.agent_grants SET revoked_at = now() WHERE owner_id = $1 AND revoked_at IS NULL`, [principalId]);
    await pool.query('COMMIT');
    const sessionAfter = await pool.query(`SELECT revoked_at FROM ${SCHEMA}.sessions WHERE token_hash = $1`, [tokenHash]);
    const grantAfter = await pool.query(`SELECT g.revoked_at, g.owner_epoch, p.grant_epoch FROM ${SCHEMA}.agent_grants g JOIN ${SCHEMA}.principals p ON p.id = g.owner_id WHERE g.token_hash = $1`, [agentTokenHash]);
    assert.ok(sessionAfter.rows[0].revoked_at);
    assert.ok(grantAfter.rows[0].revoked_at);
    assert.equal(grantAfter.rows[0].owner_epoch, '0');
    assert.equal(grantAfter.rows[0].grant_epoch, '1');

    await pool.query(`TRUNCATE ${SCHEMA}.agent_grants, ${SCHEMA}.sessions, ${SCHEMA}.login_codes, ${SCHEMA}.browser_flows, ${SCHEMA}.key_roles, ${SCHEMA}.principals CASCADE`);
    const ownerSecret = generateSecretKey();
    const ownerPubkey = getPublicKey(ownerSecret);
    const agentSecret = generateSecretKey();
    const agentPubkey = getPublicKey(agentSecret);
    const userSessionToken = randomBytes(32).toString('base64url');
    const routePrincipalId = randomUUID();
    const routeExpiry = new Date(Date.now() + 3600_000);
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const privateJwk = { ...pair.privateKey.export({ format: 'jwk' }), alg: 'ES256' };
    const publicJwk = { ...pair.publicKey.export({ format: 'jwk' }), alg: 'ES256', use: 'sig', kid: 'pg-integration-key' };
    const signingKey = await importJWK(privateJwk, 'ES256');
    const app = createIdentityApp({ config: {
      publicBase: 'https://identity.example', issuer: 'https://identity.example', relays: new Set(['wss://relay.example']), allowedEmails: new Set(['pilot@example.org']),
      sessionTtlSeconds: 3600, alg: 'ES256', kid: 'pg-integration-key', signingKey, publicJwk,
    }, pool, oidc: {} });
    try {
      await pool.query(`INSERT INTO ${SCHEMA}.principals (id,issuer,upstream_sub,email,nostr_pubkey) VALUES ($1,$2,$3,$4,$5)`,
        [routePrincipalId, 'https://identity.example', 'private-upstream-sub', 'pilot@example.org', ownerPubkey]);
      await pool.query(`INSERT INTO ${SCHEMA}.key_roles (pubkey,role,owner_id) VALUES ($1,'human',$2)`, [ownerPubkey, routePrincipalId]);
      await pool.query(`INSERT INTO ${SCHEMA}.sessions (token_hash,principal_id,email,expires_at) VALUES ($1,$2,$3,$4)`, [sha256(userSessionToken), routePrincipalId, 'pilot@example.org', routeExpiry]);

      const signedRequest = (secret, pubkey, method, path, body) => {
        const event = finalizeEvent({ created_at: Math.floor(Date.now() / 1000), kind: 27235, content: '', tags: [
          ['u', `https://identity.example${path}`], ['method', method], ['payload', sha256(Buffer.from(body))],
        ] }, secret);
        return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`;
      };
      const humanBody = JSON.stringify({ relay_url: 'wss://relay.example', nostr_pubkey: ownerPubkey });
      const humanAssertion = await app.inject({ method: 'POST', url: '/v1/identity/assertions', payload: humanBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${userSessionToken}`,
        'nostr-authorization': signedRequest(ownerSecret, ownerPubkey, 'POST', '/v1/identity/assertions', humanBody),
      } });
      assert.equal(humanAssertion.statusCode, 200, humanAssertion.body);
      const humanJwt = await jwtVerify(humanAssertion.json().assertion, await importJWK(publicJwk, 'ES256'), { issuer: 'https://identity.example', audience: 'https://relay.example' });
      assert.equal(humanJwt.protectedHeader.typ, 'nip-fi+jwt');
      assert.equal(humanJwt.payload.nostr_pubkey, ownerPubkey);

      const otherHumanSecret = generateSecretKey();
      const otherHumanKey = getPublicKey(otherHumanSecret);
      const unboundPrincipal = randomUUID();
      const unboundToken = randomBytes(32).toString('base64url');
      const humanPrincipal = randomUUID();
      const humanToken = randomBytes(32).toString('base64url');
      await pool.query(`INSERT INTO ${SCHEMA}.principals (id,issuer,upstream_sub,email) VALUES ($1,$2,$3,$4)`,
        [unboundPrincipal, 'https://identity.example', 'second-private-sub', 'operator@example.org']);
      await pool.query(`INSERT INTO ${SCHEMA}.sessions (token_hash,principal_id,email,expires_at) VALUES ($1,$2,$3,$4)`,
        [sha256(unboundToken), unboundPrincipal, 'operator@example.org', routeExpiry]);
      await pool.query(`INSERT INTO ${SCHEMA}.principals (id,issuer,upstream_sub,email,nostr_pubkey) VALUES ($1,$2,$3,$4,$5)`,
        [humanPrincipal, 'https://identity.example', 'third-private-sub', 'operator@example.org', otherHumanKey]);
      await pool.query(`INSERT INTO ${SCHEMA}.key_roles (pubkey,role,owner_id) VALUES ($1,'human',$2)`, [otherHumanKey, humanPrincipal]);
      await pool.query(`INSERT INTO ${SCHEMA}.sessions (token_hash,principal_id,email,expires_at) VALUES ($1,$2,$3,$4)`,
        [sha256(humanToken), humanPrincipal, 'operator@example.org', routeExpiry]);

      const crossPrincipalHumanBody = JSON.stringify({ relay_url: 'wss://relay.example', nostr_pubkey: otherHumanKey });
      const crossPrincipalHuman = await app.inject({ method: 'POST', url: '/v1/identity/assertions', payload: crossPrincipalHumanBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${unboundToken}`,
        'nostr-authorization': signedRequest(otherHumanSecret, otherHumanKey, 'POST', '/v1/identity/assertions', crossPrincipalHumanBody),
      } });
      assert.equal(crossPrincipalHuman.statusCode, 403);
      assert.deepEqual(crossPrincipalHuman.json(), { error: 'binding_mismatch' });

      const grantBody = JSON.stringify({ agent_pubkey: agentPubkey, relay_url: 'wss://relay.example' });
      const grantResponse = await app.inject({ method: 'POST', url: '/v1/agents/grants', payload: grantBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${userSessionToken}`,
        'nostr-authorization': signedRequest(ownerSecret, ownerPubkey, 'POST', '/v1/agents/grants', grantBody),
      } });
      assert.equal(grantResponse.statusCode, 201, grantResponse.body);
      let grant = grantResponse.json();
      assert.equal(typeof grant.grant_token, 'string');
      assert.equal(grant.expires_at, routeExpiry.toISOString());
      const persistedGrant = await pool.query(`SELECT token_hash,owner_epoch,expires_at,revoked_at FROM ${SCHEMA}.agent_grants WHERE id = $1`, [grant.grant_id]);
      assert.equal(persistedGrant.rowCount, 1);
      assert.equal(persistedGrant.rows[0].token_hash, sha256(grant.grant_token));
      assert.equal(persistedGrant.rows[0].revoked_at, null);
      assert.equal(new Date(persistedGrant.rows[0].expires_at).toISOString(), routeExpiry.toISOString());

      const grantHumanKeyBody = JSON.stringify({ agent_pubkey: otherHumanKey, relay_url: 'wss://relay.example' });
      const grantHumanKey = await app.inject({ method: 'POST', url: '/v1/agents/grants', payload: grantHumanKeyBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${userSessionToken}`,
        'nostr-authorization': signedRequest(ownerSecret, ownerPubkey, 'POST', '/v1/agents/grants', grantHumanKeyBody),
      } });
      assert.equal(grantHumanKey.statusCode, 403);
      assert.deepEqual(grantHumanKey.json(), { error: 'authorization_denied' });

      const agentBody = JSON.stringify({ agent_pubkey: agentPubkey, relay_url: 'wss://relay.example' });
      const agentAssertion = await app.inject({ method: 'POST', url: '/v1/agents/assertions', payload: agentBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${grant.grant_token}`,
        'nostr-authorization': signedRequest(agentSecret, agentPubkey, 'POST', '/v1/agents/assertions', agentBody),
      } });
      assert.equal(agentAssertion.statusCode, 200, agentAssertion.body);
      const agentJwt = await jwtVerify(agentAssertion.json().assertion, await importJWK(publicJwk, 'ES256'), { issuer: 'https://identity.example', audience: 'https://relay.example' });
      assert.equal(agentJwt.protectedHeader.typ, 'nip-fi-agent+jwt');
      assert.equal(agentJwt.payload.nostr_pubkey, agentPubkey);
      assert.equal(agentJwt.payload.nostr_owner_pubkey, ownerPubkey);
      assert.notEqual(agentJwt.payload.nostr_pubkey, agentJwt.payload.nostr_owner_pubkey);
      assert.ok(agentJwt.payload.exp - agentJwt.payload.iat <= 300);
      assert.ok(agentJwt.payload.exp <= Math.floor(routeExpiry.getTime() / 1000));

      await pool.query(`UPDATE ${SCHEMA}.agent_grants SET expires_at = now() - interval '1 second' WHERE id = $1`, [grant.grant_id]);
      const expiredOldGrant = await app.inject({ method: 'POST', url: '/v1/agents/assertions', payload: agentBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${grant.grant_token}`,
        'nostr-authorization': signedRequest(agentSecret, agentPubkey, 'POST', '/v1/agents/assertions', agentBody),
      } });
      assert.equal(expiredOldGrant.statusCode, 403);
      const renewedGrantResponse = await app.inject({ method: 'POST', url: '/v1/agents/grants', payload: grantBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${userSessionToken}`,
        'nostr-authorization': signedRequest(ownerSecret, ownerPubkey, 'POST', '/v1/agents/grants', grantBody),
      } });
      assert.equal(renewedGrantResponse.statusCode, 201, renewedGrantResponse.body);
      const oldGrantAfterRenewal = await pool.query(`SELECT revoked_at FROM ${SCHEMA}.agent_grants WHERE id = $1`, [grant.grant_id]);
      assert.ok(oldGrantAfterRenewal.rows[0].revoked_at);
      const oldTokenAfterRenewal = await app.inject({ method: 'POST', url: '/v1/agents/assertions', payload: agentBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${grant.grant_token}`,
        'nostr-authorization': signedRequest(agentSecret, agentPubkey, 'POST', '/v1/agents/assertions', agentBody),
      } });
      assert.equal(oldTokenAfterRenewal.statusCode, 403);
      grant = renewedGrantResponse.json();

      await pool.query(`ALTER TABLE ${SCHEMA}.agent_grants ALTER COLUMN expires_at DROP NOT NULL`);
      await pool.query(`UPDATE ${SCHEMA}.agent_grants SET expires_at = NULL WHERE id = $1`, [grant.grant_id]);
      const legacyGrant = await app.inject({ method: 'POST', url: '/v1/agents/assertions', payload: agentBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${grant.grant_token}`,
        'nostr-authorization': signedRequest(agentSecret, agentPubkey, 'POST', '/v1/agents/assertions', agentBody),
      } });
      assert.equal(legacyGrant.statusCode, 403);
      assert.deepEqual(legacyGrant.json(), { error: 'authorization_denied' });
      await pool.query(`UPDATE ${SCHEMA}.agent_grants SET expires_at = $2 WHERE id = $1`, [grant.grant_id, routeExpiry]);
      await pool.query(`ALTER TABLE ${SCHEMA}.agent_grants ALTER COLUMN expires_at SET NOT NULL`);

      await pool.query(`UPDATE ${SCHEMA}.principals SET email = $2 WHERE id = $1`, [routePrincipalId, 'removed@example.net']);
      const removedOwnerAssertion = await app.inject({ method: 'POST', url: '/v1/agents/assertions', payload: agentBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${grant.grant_token}`,
        'nostr-authorization': signedRequest(agentSecret, agentPubkey, 'POST', '/v1/agents/assertions', agentBody),
      } });
      assert.equal(removedOwnerAssertion.statusCode, 403);
      await pool.query(`UPDATE ${SCHEMA}.principals SET email = $2 WHERE id = $1`, [routePrincipalId, 'pilot@example.org']);

      const revokePath = `/v1/agents/grants/${grant.grant_id}`;
      const revoked = await app.inject({ method: 'DELETE', url: revokePath, headers: {
        authorization: `Bearer ${userSessionToken}`,
        'nostr-authorization': signedRequest(ownerSecret, ownerPubkey, 'DELETE', revokePath, ''),
      } });
      assert.equal(revoked.statusCode, 204, revoked.body);
      const afterRevoke = await app.inject({ method: 'POST', url: '/v1/agents/assertions', payload: agentBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${grant.grant_token}`,
        'nostr-authorization': signedRequest(agentSecret, agentPubkey, 'POST', '/v1/agents/assertions', agentBody),
      } });
      assert.equal(afterRevoke.statusCode, 403);
      assert.deepEqual(afterRevoke.json(), { error: 'authorization_denied' });

      const expiredAgentSecret = generateSecretKey();
      const expiredAgentKey = getPublicKey(expiredAgentSecret);
      const expiredGrantBody = JSON.stringify({ agent_pubkey: expiredAgentKey, relay_url: 'wss://relay.example' });
      const expiredGrantResponse = await app.inject({ method: 'POST', url: '/v1/agents/grants', payload: expiredGrantBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${userSessionToken}`,
        'nostr-authorization': signedRequest(ownerSecret, ownerPubkey, 'POST', '/v1/agents/grants', expiredGrantBody),
      } });
      assert.equal(expiredGrantResponse.statusCode, 201, expiredGrantResponse.body);
      const expiredGrant = expiredGrantResponse.json();
      await pool.query(`UPDATE ${SCHEMA}.agent_grants SET expires_at = now() - interval '1 second' WHERE id = $1`, [expiredGrant.grant_id]);
      const expiredAgentBody = JSON.stringify({ agent_pubkey: expiredAgentKey, relay_url: 'wss://relay.example' });
      const expiredAssertion = await app.inject({ method: 'POST', url: '/v1/agents/assertions', payload: expiredAgentBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${expiredGrant.grant_token}`,
        'nostr-authorization': signedRequest(expiredAgentSecret, expiredAgentKey, 'POST', '/v1/agents/assertions', expiredAgentBody),
      } });
      assert.equal(expiredAssertion.statusCode, 403);
      assert.deepEqual(expiredAssertion.json(), { error: 'authorization_denied' });

      const logoutAgentSecret = generateSecretKey();
      const logoutAgentKey = getPublicKey(logoutAgentSecret);
      const logoutGrantBody = JSON.stringify({ agent_pubkey: logoutAgentKey, relay_url: 'wss://relay.example' });
      const logoutGrantResponse = await app.inject({ method: 'POST', url: '/v1/agents/grants', payload: logoutGrantBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${userSessionToken}`,
        'nostr-authorization': signedRequest(ownerSecret, ownerPubkey, 'POST', '/v1/agents/grants', logoutGrantBody),
      } });
      assert.equal(logoutGrantResponse.statusCode, 201, logoutGrantResponse.body);
      const logoutGrant = logoutGrantResponse.json();
      const logout = await app.inject({ method: 'POST', url: '/v1/logout', headers: { authorization: `Bearer ${userSessionToken}` } });
      assert.equal(logout.statusCode, 204);
      const logoutAgentBody = JSON.stringify({ agent_pubkey: logoutAgentKey, relay_url: 'wss://relay.example' });
      const afterLogout = await app.inject({ method: 'POST', url: '/v1/agents/assertions', payload: logoutAgentBody, headers: {
        'content-type': 'application/json', authorization: `Bearer ${logoutGrant.grant_token}`,
        'nostr-authorization': signedRequest(logoutAgentSecret, logoutAgentKey, 'POST', '/v1/agents/assertions', logoutAgentBody),
      } });
      assert.equal(afterLogout.statusCode, 403);
      assert.deepEqual(afterLogout.json(), { error: 'authorization_denied' });
    } finally {
      await app.close();
    }
  } finally {
    await pool.query(`TRUNCATE ${SCHEMA}.agent_grants, ${SCHEMA}.sessions, ${SCHEMA}.login_codes, ${SCHEMA}.browser_flows, ${SCHEMA}.key_roles, ${SCHEMA}.principals CASCADE`).catch(() => {});
    await pool.end();
  }
});
