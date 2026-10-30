import test from 'node:test';
import assert from 'node:assert/strict';
import { Configuration, ClientSecretPost } from 'openid-client';
import { createIdentityApp } from '../src/server.mjs';

const oidc = new Configuration({
  issuer: 'https://sso.example',
  authorization_endpoint: 'https://sso.example/oauth/authorize',
  token_endpoint: 'https://sso.example/oauth/token',
  jwks_uri: 'https://sso.example/keys',
}, 'client', 'secret', ClientSecretPost());

test('login start bounds one client IP and prunes expired records before writing new flows', async (t) => {
  let flowInserts = 0;
  let cleanupQueries = 0;
  const pool = {
    async query(sql) {
      if (sql.startsWith('DELETE FROM buzz_identity.')) { cleanupQueries += 1; return { rowCount: 0, rows: [] }; }
      if (sql.startsWith('INSERT INTO buzz_identity.browser_flows')) { flowInserts += 1; return { rowCount: 1, rows: [] }; }
      throw new Error('unexpected query');
    },
  };
  const app = createIdentityApp({
    config: { publicBase: 'https://identity.example', redirectUri: 'https://identity.example/oauth2/callback' },
    pool, oidc, clock: () => 1000,
  });
  t.after(() => app.close());

  const query = new URLSearchParams({
    return_to: 'http://127.0.0.1:43210/callback',
    handoff_challenge: Buffer.alloc(32, 9).toString('base64url'),
    handoff_challenge_method: 'S256',
  });
  for (let index = 0; index < 20; index += 1) {
    const response = await app.inject({ method: 'GET', url: `/v1/login/start?${query}` });
    assert.equal(response.statusCode, 302);
  }
  const limited = await app.inject({ method: 'GET', url: `/v1/login/start?${query}` });
  assert.equal(limited.statusCode, 429);
  assert.deepEqual(limited.json(), { error: 'rate_limited' });
  assert.equal(limited.headers['retry-after'], '60');
  assert.equal(flowInserts, 20);
  assert.equal(cleanupQueries, 60);
});
