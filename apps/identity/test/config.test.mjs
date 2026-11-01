import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { loadConfig } from '../src/config.mjs';
import pg from 'pg';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const signingJwk = JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid: 'adapter-test-1' });
const services = {
  'p-identity': [{ name: 'buzz-sso', label: 'p-identity', credentials: { auth_domain: 'https://sso.example', client_id: 'client', client_secret: 'secret' } }],
  postgresql: [{ name: 'buzz-identity-db', credentials: { uri: 'postgresql://user:password@localhost:5432/buzz_identity' } }],
  credhub: [{ name: 'buzz-identity-secrets', credentials: { NIP_FI_SIGNING_KEY: signingJwk } }],
};

test('runtime config separates adapter issuer from OIDC issuer and loads named bindings', async () => {
  const config = await loadConfig({
    PUBLIC_BASE_URL: 'https://identity.example',
    NIP_FI_ISSUER: 'https://identity.example',
    RELAY_URLS: 'wss://relay.example',
    ALLOWED_EMAILS_JSON: '[\"pilot@example.org\"]',
    VCAP_SERVICES: JSON.stringify(services),
  });
  assert.equal(config.issuer, 'https://identity.example');
  assert.equal(config.oidcIssuer, 'https://sso.example');
  assert.equal(config.authDomain, 'https://sso.example');
  assert.equal(config.clientId, 'client');
  assert.equal(config.pg.connectionString, services.postgresql[0].credentials.uri);
  assert.equal(config.alg, 'ES256');
  assert.equal(config.kid, 'adapter-test-1');
  assert.equal(config.publicJwk.d, undefined);
  assert.deepEqual([...config.allowedEmails], ['pilot@example.org']);
});

test('runtime config refuses to guess a different PostgreSQL binding', async () => {
  const other = structuredClone(services);
  other.postgresql[0].name = 'unrelated-db';
  await assert.rejects(() => loadConfig({
    PUBLIC_BASE_URL: 'https://identity.example',
    RELAY_URLS: 'wss://relay.example',
    ALLOWED_EMAILS_JSON: '[\"pilot@example.org\"]',
    VCAP_SERVICES: JSON.stringify(other),
  }), /buzz-identity-db PostgreSQL service binding is required/);
});


test('runtime config selects the named buzz-sso binding and refuses similarly tagged instances', async () => {
  const other = structuredClone(services);
  other['p-identity'][0].name = 'another-sso';
  await assert.rejects(() => loadConfig({
    PUBLIC_BASE_URL: 'https://identity.example',
    RELAY_URLS: 'wss://relay.example',
    ALLOWED_EMAILS_JSON: '[\"pilot@example.org\"]',
    VCAP_SERVICES: JSON.stringify(other),
  }), /buzz-sso p-identity service binding is required/);
});

test('runtime config refuses missing or malformed allowlists', async () => {
  for (const value of [undefined, '', '{}', '[]']) await assert.rejects(() => loadConfig({ ALLOWED_EMAILS_JSON: value }), /ALLOWED_EMAILS_JSON/);
});

test('verified database TLS retains its CA through the real pg URL parser', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'identity-ca-test-'));
  const ca = '-----BEGIN CERTIFICATE-----\nfixture-trust\n-----END CERTIFICATE-----\n';
  try {
    writeFileSync(join(directory, 'root.pem'), ca);
    const bound = structuredClone(services);
    bound.postgresql[0].credentials.uri += '?sslmode=no-verify&ssl=false&sslrootcert=/must-not-be-read&application_name=identity';
    const config = await loadConfig({
      PUBLIC_BASE_URL: 'https://identity.example', RELAY_URLS: 'wss://relay.example',
      ALLOWED_EMAILS_JSON: '["pilot@example.org"]', VCAP_SERVICES: JSON.stringify(bound),
      BUZZ_DATABASE_REQUIRE_TLS: 'true', CF_SYSTEM_CERT_PATH: directory,
    });
    const client = new pg.Client(config.pg);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
    assert.equal(client.connectionParameters.ssl.ca, ca);
    assert.equal(client.connectionParameters.application_name, 'identity');
    assert.equal(new URL(config.pg.connectionString).searchParams.has('sslmode'), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('required database TLS fails closed when trusted CA material is absent', async () => {
  await assert.rejects(() => loadConfig({
    PUBLIC_BASE_URL: 'https://identity.example', RELAY_URLS: 'wss://relay.example',
    ALLOWED_EMAILS_JSON: '["pilot@example.org"]', VCAP_SERVICES: JSON.stringify(services),
    BUZZ_DATABASE_REQUIRE_TLS: 'true',
  }), /^Error: PostgreSQL CA trust is required for verified TLS$/);
});
