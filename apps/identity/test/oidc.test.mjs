import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedLoginEmail } from '../src/oidc.mjs';

const baseClaims = { iss: 'https://sso.example', aud: 'client', sub: 'opaque-provider-sub' };
const tokenSet = (claims, accessToken = 'access-token') => ({ claims: () => claims, access_token: accessToken });

test('OIDC email is trusted only when explicitly verified in the ID token', async () => {
  assert.equal(await verifiedLoginEmail({}, tokenSet({ ...baseClaims, email: 'pilot@example.org', email_verified: true })), 'pilot@example.org');
  assert.equal(await verifiedLoginEmail({}, tokenSet({ ...baseClaims, email: 'pilot@example.org', email_verified: false }, 'access'), async () => ({ sub: baseClaims.sub, email: 'pilot@example.org', email_verified: true })), null);
});

test('OIDC userinfo may supply a missing verified email only for the same subject', async () => {
  let call;
  const email = await verifiedLoginEmail({}, tokenSet({ ...baseClaims }), async (...args) => {
    call = args;
    return { sub: baseClaims.sub, email: 'pilot@example.org', email_verified: true };
  });
  assert.equal(email, 'pilot@example.org');
  assert.equal(call[1], 'access-token');
  assert.equal(call[2], baseClaims.sub);
  assert.equal(await verifiedLoginEmail({}, tokenSet({ ...baseClaims, email: 'old@example.org' }), async () => ({ sub: baseClaims.sub, email: 'pilot@example.org', email_verified: true })), null);
  assert.equal(await verifiedLoginEmail({}, tokenSet({ ...baseClaims }), async () => ({ sub: 'other-sub', email: 'pilot@example.org', email_verified: true })), null);
  assert.equal(await verifiedLoginEmail({}, tokenSet({ ...baseClaims }, null), async () => ({ sub: baseClaims.sub, email: 'pilot@example.org', email_verified: true })), null);
});
