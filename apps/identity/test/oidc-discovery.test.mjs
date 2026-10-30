import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverBoundOidc } from '../src/oidc-discovery.mjs';

const config = {
  authDomain: 'https://sso.example',
  oidcIssuer: 'https://sso.example/oauth/token',
  clientId: 'client-id',
  clientSecret: 'not-logged',
};

function metadata(overrides = {}) {
  const origin = config.authDomain;
  return {
    issuer: config.oidcIssuer,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    jwks_uri: `${origin}/token_keys`,
    userinfo_endpoint: `${origin}/userinfo`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    ...overrides,
  };
}

function response(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('bound UAA metadata may pin a different HTTPS issuer while endpoints stay on auth_domain', async () => {
  let request;
  const oidc = await discoverBoundOidc(config, async (url, options) => {
    request = { url: String(url), options };
    return response(metadata());
  });
  assert.equal(request.url, `${config.authDomain}/.well-known/openid-configuration`);
  assert.equal(request.options.redirect, 'error');
  assert.equal(oidc.serverMetadata().issuer, config.oidcIssuer);
  assert.equal(oidc.serverMetadata().token_endpoint, `${config.authDomain}/oauth/token`);
});

test('bound discovery rejects an issuer mismatch and endpoint origin escape', async () => {
  await assert.rejects(() => discoverBoundOidc(config, async () => response(metadata({ issuer: 'https://untrusted.example/issuer' }))), /OIDC discovery contract mismatch/);
  await assert.rejects(() => discoverBoundOidc(config, async () => response(metadata({ jwks_uri: 'https://untrusted.example/keys' }))), /OIDC discovery contract mismatch/);
});
