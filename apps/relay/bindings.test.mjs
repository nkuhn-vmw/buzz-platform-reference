import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relayEnvironment } from './bindings.mjs';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
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

test('required TLS gives the relay and migration binary explicit verified trust', () => {
  const original = fixture();
  const services = JSON.parse(original.VCAP_SERVICES);
  const ca = '-----BEGIN CERTIFICATE-----\nfixture-trust\n-----END CERTIFICATE-----\n';
  services.postgres[0].credentials.ca_certificate = ca;
  services.postgres[0].credentials.uri += '?sslmode=require&ssl-mode=disable&sslrootcert=/must-not-be-used&ssl-root-cert=/also-wrong&ssl-ca=/wrong&application_name=relay';
  const env = relayEnvironment({ ...original, VCAP_SERVICES: JSON.stringify(services), BUZZ_DATABASE_REQUIRE_TLS: 'true', PGSSLMODE: 'disable' });
  const uri = new URL(env.DATABASE_URL);
  const caFile = uri.searchParams.get('sslrootcert');
  try {
    assert.equal(uri.searchParams.get('sslmode'), 'verify-full');
    assert.deepEqual([...uri.searchParams.keys()].filter(key => key.startsWith('ssl')), ['sslmode', 'sslrootcert']);
    assert.equal(uri.searchParams.get('application_name'), 'relay');
    assert.equal(readFileSync(caFile, 'utf8'), ca);
    assert.equal(statSync(caFile).mode & 0o777, 0o600);
    assert.equal(uri.password, 'pass');
  } finally { rmSync(dirname(caFile), { recursive: true, force: true }); }
});

test('relay required TLS refuses a missing trust bundle before launching', () => {
  assert.throws(() => relayEnvironment({ ...fixture(), BUZZ_DATABASE_REQUIRE_TLS: 'true' }), /^Error: PostgreSQL CA trust is required for verified TLS$/);
});
