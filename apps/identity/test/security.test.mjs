import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateReturnTo, verifyNip98 } from '../src/security.mjs';

test('loopback return_to accepts only exact RFC 8252 IP literal origins', () => {
  assert.equal(validateReturnTo('http://127.0.0.1:49152/callback?state=x'), true);
  assert.equal(validateReturnTo('http://[::1]:49152/callback'), true);
  for (const value of [
    'http://localhost:49152/callback',
    'http://127.0.0.2:49152/callback',
    'https://127.0.0.1:49152/callback',
    'http://127.0.0.1.evil.test:49152/callback',
    'http://127.0.0.1/callback',
    'http://127.0.0.1:49152/callback#fragment',
  ]) assert.equal(validateReturnTo(value), false, value);
});

test('NIP-98 proof is bound to request method, absolute URL, exact body bytes, and freshness', async () => {
  const body = Buffer.from('{"relay_url":"wss://relay.example","nostr_pubkey":"' + 'a'.repeat(64) + '"}');
  const proof = {
    id: 'f'.repeat(64), pubkey: 'a'.repeat(64), created_at: Math.floor(Date.now() / 1000),
    kind: 27235,
    tags: [['u', 'https://adapter.example/v1/identity/assertions'], ['method', 'POST'], ['payload', createHash('sha256').update(body).digest('hex')]],
    content: '', sig: '0'.repeat(128),
  };
  const verify = async () => true;
  const input = { proof, method: 'POST', url: 'https://adapter.example/v1/identity/assertions', body, expectedPubkey: 'a'.repeat(64), verify };
  assert.equal(await verifyNip98(input), true);
  assert.equal(await verifyNip98({ ...input, method: 'PUT' }), false);
  assert.equal(await verifyNip98({ ...input, body: Buffer.from('{}') }), false);
  assert.equal(await verifyNip98({ ...input, proof: { ...proof, tags: [...proof.tags, ['u', 'https://evil.example/']] } }), false);
  assert.equal(await verifyNip98({ ...input, expectedPubkey: 'b'.repeat(64) }), false);
  assert.equal(await verifyNip98({ ...input, proof: { ...proof, created_at: Math.floor(Date.now() / 1000) - 61 } }), false);
});

test('relay audiences require configured canonical URLs without a trailing slash', async () => {
  const { canonicalRelayAudience } = await import('../src/security.mjs');
  const configured = new Set(['wss://relay.example.com', 'wss://relay.example.com:8443']);
  assert.equal(canonicalRelayAudience('wss://relay.example.com', configured), 'https://relay.example.com');
  assert.equal(canonicalRelayAudience('wss://relay.example.com:8443', configured), 'https://relay.example.com:8443');
  for (const value of ['wss://relay.example.com/', 'wss://RELAY.example.com', 'wss://relay.example.com:443', 'wss://relay.example.com:80']) {
    assert.equal(canonicalRelayAudience(value, new Set([value])), null, value);
  }
});

test('NIP-98 event signature is verified with the event public key', async () => {
  const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools');
  const secretKey = generateSecretKey();
  const publicKey = getPublicKey(secretKey);
  const body = Buffer.from('{"relay_url":"wss://community.example.com","nostr_pubkey":"' + publicKey + '"}');
  const event = finalizeEvent({
    created_at: Math.floor(Date.now() / 1000),
    kind: 27235,
    tags: [['u', 'https://adapter.example/v1/identity/assertions'], ['method', 'POST'], ['payload', createHash('sha256').update(body).digest('hex')]],
    content: '',
  }, secretKey);
  const input = { proof: event, method: 'POST', url: 'https://adapter.example/v1/identity/assertions', body, expectedPubkey: publicKey };
  assert.equal(await verifyNip98(input), true);
  const forged = Object.fromEntries(Object.entries(event));
  forged.sig = '0'.repeat(128);
  assert.equal(await verifyNip98({ ...input, proof: forged }), false);
});

test('loopback validation rejects noncanonical IPv6 and default-port substitution', () => {
  assert.equal(validateReturnTo('http://[::1]:80/callback'), true);
  assert.equal(validateReturnTo('http://[0:0:0:0:0:0:0:1]:49152/callback'), false);
  assert.equal(validateReturnTo('HTTP://127.0.0.1:49152/callback'), false);
});

test('IPv6 relay audience follows RFC 5952 canonical form', async () => {
  const { canonicalRelayAudience } = await import('../src/security.mjs');
  assert.equal(canonicalRelayAudience('wss://[2001:db8::1]:8443', new Set(['wss://[2001:db8::1]:8443'])), 'https://[2001:db8::1]:8443');
  assert.equal(canonicalRelayAudience('wss://[2001:0db8::1]:8443', new Set(['wss://[2001:0db8::1]:8443'])), null);
});
