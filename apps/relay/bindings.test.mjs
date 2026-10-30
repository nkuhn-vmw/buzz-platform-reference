import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relayEnvironment } from './bindings.mjs';
const fixture = () => ({ PORT: '8080', VCAP_SERVICES: JSON.stringify({
  postgres: [{name:'buzz-db',credentials:{uri:'postgres://user:pass@db:5432/buzz'}}],
  'p-redis': [{name:'buzz-cache',credentials:{host:'cache',port:6379,password:'p@ss:/?'}}],
  seaweedfs: [{name:'buzz-objects',credentials:{endpoint_url:'https://s3.example',access_key:'access',secret_key:'secret',bucket:'bucket'}}],
  credhub: [{name:'buzz-secrets',credentials:{BUZZ_RELAY_PRIVATE_KEY:'a'.repeat(64),BUZZ_GIT_HOOK_HMAC_SECRET:'b'.repeat(64)}}],
}) });
test('bindings override stale secret env and preserve encoded cache credentials', () => {
  const env=relayEnvironment({...fixture(), DATABASE_URL:'postgres://stale'});
  assert.equal(env.DATABASE_URL,'postgres://user:pass@db:5432/buzz');
  assert.equal(decodeURIComponent(new URL(env.REDIS_URL).password),'p@ss:/?');
  assert.notEqual(env.BUZZ_HEALTH_PORT, '8080');
});
test('missing/ambiguous bindings fail closed without exposing binding values', () => {
  assert.throws(() => relayEnvironment({VCAP_SERVICES:'{}'}), /buzz-db/);
  const env=fixture();const services=JSON.parse(env.VCAP_SERVICES);
  services.postgres.push(services.postgres[0]); env.VCAP_SERVICES=JSON.stringify(services);
  assert.throws(() => relayEnvironment(env), /^Error: Exactly one buzz-db service binding is required$/);
});
