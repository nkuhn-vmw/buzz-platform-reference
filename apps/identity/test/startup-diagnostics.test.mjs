import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { startIdentityService } from '../src/server.mjs';

const signingJwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });

test('startup records a safe phase/error code and closes the pool on discovery failure', async () => {
  const lines = [];
  let poolClosed = false;
  const error = Object.assign(new Error('upstream response included a credential: do-not-log'), { code: 'ECONNRESET' });
  await assert.rejects(() => startIdentityService({
    env: { PORT: '8080' },
    logger: (line) => lines.push(line),
    configLoader: async () => ({
      authDomain: 'https://sso.example', clientId: 'client', clientSecret: 'private',
      sessionTtlSeconds: 3600, pg: {}, signingJwk, alg: 'ES256',
    }),
    poolFactory: () => ({ query: async () => ({ rowCount: 0 }), end: async () => { poolClosed = true; } }),
    storeInitializer: async () => {},
    oidcDiscovery: async () => { throw error; },
    appFactory: () => { throw new Error('must not create app'); },
  }), error);
  assert.equal(poolClosed, true);
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.phase, 'oidc-discovery');
  assert.equal(record.error_name, 'Error');
  assert.equal(record.error_code, 'ECONNRESET');
  assert.equal(record.message, undefined);
  assert.equal(lines[0].includes('do-not-log'), false);
  assert.equal(lines[0].includes('private'), false);
});

test('startup includes only explicitly safe configuration messages', async () => {
  const lines = [];
  await assert.rejects(() => startIdentityService({
    env: {}, logger: (line) => lines.push(line),
    configLoader: async () => { throw new Error('buzz-identity-db PostgreSQL service binding is required'); },
  }));
  assert.deepEqual(JSON.parse(lines[0]), {
    event: 'identity_startup_failed', phase: 'config', error_name: 'Error',
    message: 'buzz-identity-db PostgreSQL service binding is required',
  });
});
