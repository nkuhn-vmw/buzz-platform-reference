import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { publishAgentPolicy, publishAgentProfile } from '../lib/agent-profile.mjs';

const identityRequire = createRequire(fileURLToPath(new URL('../../apps/identity/package.json', import.meta.url)));
const { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } = identityRequire('nostr-tools');
const { schnorr } = identityRequire('@noble/curves/secp256k1.js');

function enrollment(now = Date.now()) {
  const ownerSecret = generateSecretKey();
  const agentSecret = generateSecretKey();
  const ownerPubkey = getPublicKey(ownerSecret);
  const agentPubkey = getPublicKey(agentSecret);
  const grantExpiresAt = new Date(now + 60 * 60_000).toISOString();
  const conditions = `created_at<${Math.floor(Date.parse(grantExpiresAt) / 1000)}`;
  const digest = createHash('sha256').update(`nostr:agent-auth:${agentPubkey}:${conditions}`).digest();
  const signature = Buffer.from(schnorr.sign(digest, ownerSecret)).toString('hex');
  const authTag = JSON.stringify(['auth', ownerPubkey, conditions, signature]);
  return {
    agentPubkey,
    ownerPubkey,
    binding: {
      BUZZ_PRIVATE_KEY: Buffer.from(agentSecret).toString('hex'),
      BUZZ_ACP_AGENT_OWNER: ownerPubkey,
      BUZZ_FI_GRANT_TOKEN: 'g'.repeat(43),
      BUZZ_GRANT_EXPIRES_AT: grantExpiresAt,
      BUZZ_AUTH_TAG: authTag,
    },
  };
}

function assertionResponse(identity, now, { issuerClockOffsetSeconds = 0, lifetimeSeconds = 300, issuer, audience, ownerPubkey, outerExpiry } = {}) {
  const iat = Math.floor(now / 1000) + issuerClockOffsetSeconds;
  const exp = iat + lifetimeSeconds;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const assertion = [
    encode({ alg: 'ES256', typ: 'nip-fi-agent+jwt', kid: 'fixture' }),
    encode({ iss: issuer ?? 'https://identity.example', aud: audience ?? 'https://relay.example', iat, exp, nostr_pubkey: identity.agentPubkey, nostr_owner_pubkey: ownerPubkey ?? identity.ownerPubkey }),
    Buffer.from('fixture-signature').toString('base64url'),
  ].join('.');
  return { assertion, nostr_pubkey: identity.agentPubkey, expires_at: outerExpiry ?? exp };
}

function humanAssertionResponse(ownerPubkey, now, { issuer = 'https://identity.example', audience = 'https://relay.example', typ = 'nip-fi+jwt' } = {}) {
  const iat = Math.floor(now / 1000);
  const exp = iat + 300;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    assertion: [
      encode({ alg: 'ES256', typ, kid: 'fixture' }),
      encode({ iss: issuer, aud: audience, iat, exp, nostr_pubkey: ownerPubkey }),
      Buffer.from('fixture-signature').toString('base64url'),
    ].join('.'),
    nostr_pubkey: ownerPubkey,
    expires_at: exp,
  };
}

function policyIdentity() {
  const secret = generateSecretKey();
  return { owner: { secret_hex: Buffer.from(secret).toString('hex'), pubkey: getPublicKey(secret) }, agentPubkey: getPublicKey(generateSecretKey()) };
}

test('owner policy registration publishes a least-privilege kind-30177 event with owner proofs', async () => {
  const now = Date.now();
  const { owner, agentPubkey } = policyIdentity();
  const identityOrigin = 'https://identity.example';
  const relayUrl = 'wss://relay.example';
  const session = { base: identityOrigin, session_token: 's'.repeat(43) };
  const requests = [];
  const result = await publishAgentPolicy({
    identityOrigin, relayUrl, owner, session, agentPubkey, displayName: 'Research Agent', now,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url === `${identityOrigin}/v1/identity/assertions`) {
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.authorization, `Bearer ${session.session_token}`);
        assert.deepEqual(JSON.parse(options.body), { relay_url: relayUrl, nostr_pubkey: owner.pubkey });
        const proof = JSON.parse(Buffer.from(options.headers['nostr-authorization'].slice('Nostr '.length), 'base64').toString('utf8'));
        assert.equal(verifyEvent(proof), true);
        assert.equal(proof.pubkey, owner.pubkey);
        assert.deepEqual(proof.tags.filter(([name]) => ['u', 'method', 'payload'].includes(name)), [
          ['u', `${identityOrigin}/v1/identity/assertions`],
          ['method', 'POST'],
          ['payload', createHash('sha256').update(options.body).digest('hex')],
        ]);
        return new Response(JSON.stringify(humanAssertionResponse(owner.pubkey, now)), { status: 200 });
      }
      return new Response(JSON.stringify({ accepted: true }), { status: 200 });
    },
  });
  assert.equal(requests.length, 2);
  const relayRequest = requests[1];
  assert.equal(relayRequest.url, 'https://relay.example/events');
  assert.equal(relayRequest.options.redirect, 'error');
  assert.equal(JSON.stringify(relayRequest.options).includes(session.session_token), false);
  assert.equal(JSON.stringify(relayRequest.options).includes(owner.secret_hex), false);
  assert.equal(relayRequest.options.headers['x-auth-tag'], undefined);
  assert.equal(relayRequest.options.headers['nostr-federated-identity'], `Bearer ${humanAssertionResponse(owner.pubkey, now).assertion}`);
  const event = JSON.parse(relayRequest.options.body);
  assert.equal(event.kind, 30177);
  assert.equal(event.pubkey, owner.pubkey);
  assert.equal(verifyEvent(event), true);
  assert.deepEqual(event.tags, [['d', agentPubkey]]);
  assert.deepEqual(JSON.parse(event.content), { name: 'Research Agent', parallelism: 1, respond_to: 'owner-only' });
  const nip98 = JSON.parse(Buffer.from(relayRequest.options.headers.authorization.slice('Nostr '.length), 'base64').toString('utf8'));
  assert.equal(verifyEvent(nip98), true);
  assert.equal(nip98.pubkey, owner.pubkey);
  assert.deepEqual(nip98.tags.filter(([name]) => ['u', 'method', 'payload'].includes(name)), [
    ['u', 'https://relay.example/events'],
    ['method', 'POST'],
    ['payload', createHash('sha256').update(relayRequest.options.body).digest('hex')],
  ]);
  assert.deepEqual(result, { agentPubkey, displayName: 'Research Agent', eventId: event.id });
});

test('owner policy allowlist requires explicit valid keys and publishes no anyone policy', async () => {
  const now = Date.now();
  const { owner, agentPubkey } = policyIdentity();
  const permittedPubkey = getPublicKey(generateSecretKey());
  let event;
  await publishAgentPolicy({
    identityOrigin: 'https://identity.example', relayUrl: 'wss://relay.example', owner,
    session: { base: 'https://identity.example', session_token: 's'.repeat(43) }, agentPubkey,
    displayName: 'Research Agent', respondTo: 'allowlist', allowlist: [permittedPubkey], now,
    fetchImpl: async (url, options) => {
      if (url.endsWith('/v1/identity/assertions')) return new Response(JSON.stringify(humanAssertionResponse(owner.pubkey, now)), { status: 200 });
      event = JSON.parse(options.body);
      return new Response(JSON.stringify({ accepted: true }), { status: 200 });
    },
  });
  assert.deepEqual(JSON.parse(event.content), {
    name: 'Research Agent', parallelism: 1, respond_to: 'allowlist', respond_to_allowlist: [permittedPubkey],
  });
});

test('owner policy registration never contacts relay when human assertion is denied or invalid', async (t) => {
  const now = Date.now();
  const { owner, agentPubkey } = policyIdentity();
  for (const [name, response] of [
    ['issuer denial', new Response(JSON.stringify({ error: 'authorization_denied' }), { status: 403 })],
    ['wrong issuer', new Response(JSON.stringify(humanAssertionResponse(owner.pubkey, now, { issuer: 'https://elsewhere.example' })), { status: 200 })],
    ['wrong principal type', new Response(JSON.stringify(humanAssertionResponse(owner.pubkey, now, { typ: 'nip-fi-agent+jwt' })), { status: 200 })],
  ]) {
    await t.test(name, async () => {
      let relayRequests = 0;
      await assert.rejects(() => publishAgentPolicy({
        identityOrigin: 'https://identity.example', relayUrl: 'wss://relay.example', owner,
        session: { base: 'https://identity.example', session_token: 's'.repeat(43) }, agentPubkey,
        displayName: 'Research Agent', now,
        fetchImpl: async (url) => {
          if (url.endsWith('/v1/identity/assertions')) return response;
          relayRequests += 1;
          return new Response(JSON.stringify({ accepted: true }), { status: 200 });
        },
      }), /owner assertion/);
      assert.equal(relayRequests, 0);
    });
  }
});

test('owner policy rejects broad or malformed inputs before requesting an assertion', async () => {
  const { owner, agentPubkey } = policyIdentity();
  let requests = 0;
  const common = {
    identityOrigin: 'https://identity.example', relayUrl: 'wss://relay.example', owner,
    session: { base: 'https://identity.example', session_token: 's'.repeat(43) }, agentPubkey,
    displayName: 'Research Agent', fetchImpl: async () => { requests += 1; throw new Error('unexpected request'); },
  };
  await assert.rejects(() => publishAgentPolicy({ ...common, respondTo: 'anyone' }), /owner-only or allowlist/);
  await assert.rejects(() => publishAgentPolicy({ ...common, respondTo: 'allowlist', allowlist: [] }), /allowlist is invalid/);
  await assert.rejects(() => publishAgentPolicy({ ...common, respondTo: 'allowlist', allowlist: ['invalid'] }), /allowlist is invalid/);
  await assert.rejects(() => publishAgentPolicy({ ...common, respondTo: 'owner-only', allowlist: [getPublicKey(generateSecretKey())] }), /allowlist is invalid/);
  await assert.rejects(() => publishAgentPolicy({ ...common, session: { ...common.session, base: 'https://other.example' } }), /session is invalid or mismatched/);
  assert.equal(requests, 0);
});

test('agent profile registration tolerates one-second issuer clock skew and posts kind-0 with scoped proofs', async () => {
  const now = Date.now();
  const identity = enrollment(now);
  const requests = [];
  const relayUrl = 'wss://relay.example';
  const identityOrigin = 'https://identity.example';
  const result = await publishAgentProfile({
    identityOrigin,
    relayUrl,
    ...identity,
    displayName: 'Research Agent',
    now,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url === `${identityOrigin}/v1/agents/assertions`) {
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.authorization, `Bearer ${identity.binding.BUZZ_FI_GRANT_TOKEN}`);
        assert.equal(options.headers['nostr-federated-identity'], undefined);
        assert.deepEqual(JSON.parse(options.body), { agent_pubkey: identity.agentPubkey, relay_url: relayUrl });
        const proof = JSON.parse(Buffer.from(options.headers['nostr-authorization'].slice('Nostr '.length), 'base64').toString('utf8'));
        assert.equal(verifyEvent(proof), true);
        assert.equal(proof.kind, 27235);
        assert.deepEqual(proof.tags.filter(([name]) => ['u', 'method', 'payload'].includes(name)), [
          ['u', `${identityOrigin}/v1/agents/assertions`],
          ['method', 'POST'],
          ['payload', createHash('sha256').update(options.body).digest('hex')],
        ]);
        return new Response(JSON.stringify(assertionResponse(identity, now, { issuerClockOffsetSeconds: 1 })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ accepted: true, message: 'accepted' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(requests.length, 2);
  const request = requests[1];
  assert.equal(request.url, 'https://relay.example/events');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers['nostr-federated-identity'], `Bearer ${assertionResponse(identity, now, { issuerClockOffsetSeconds: 1 }).assertion}`);
  assert.equal(JSON.stringify(request.options).includes(identity.binding.BUZZ_FI_GRANT_TOKEN), false);
  const profile = JSON.parse(request.options.body);
  assert.equal(profile.kind, 0);
  assert.equal(profile.pubkey, identity.agentPubkey);
  assert.equal(verifyEvent(profile), true);
  assert.deepEqual(JSON.parse(profile.content), { display_name: 'Research Agent' });
  assert.deepEqual(profile.tags, [JSON.parse(identity.binding.BUZZ_AUTH_TAG)]);
  assert.equal(request.options.headers['x-auth-tag'], identity.binding.BUZZ_AUTH_TAG);

  const auth = JSON.parse(Buffer.from(request.options.headers.authorization.slice('Nostr '.length), 'base64').toString('utf8'));
  assert.equal(verifyEvent(auth), true);
  assert.equal(auth.kind, 27235);
  assert.deepEqual(auth.tags.filter(([name]) => ['u', 'method', 'payload'].includes(name)), [
    ['u', 'https://relay.example/events'],
    ['method', 'POST'],
    ['payload', createHash('sha256').update(request.options.body).digest('hex')],
  ]);
  assert.match(auth.tags.find(([name]) => name === 'nonce')?.[1] ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(result.agentPubkey, identity.agentPubkey);
  assert.equal(result.displayName, 'Research Agent');
  assert.equal(result.eventId, profile.id);
});

test('agent profile registration never contacts the relay when the identity issuer denies assertion', async () => {
  const now = Date.now();
  const identity = enrollment(now);
  const requests = [];
  await assert.rejects(() => publishAgentProfile({
    identityOrigin: 'https://identity.example',
    relayUrl: 'wss://relay.example',
    ...identity,
    displayName: 'Research Agent',
    now,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ error: 'authorization_denied' }), { status: 403 });
    },
  }), /Identity issuer refused the agent assertion \(HTTP 403\)/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://identity.example/v1/agents/assertions');
});

test('agent profile registration never contacts the relay for malformed or mismatched assertions', async (t) => {
  const now = Date.now();
  const identity = enrollment(now);
  const cases = [
    ['wrong audience', { audience: 'https://other-relay.example' }],
    ['wrong issuer', { issuer: 'https://other-identity.example' }],
    ['wrong owner', { ownerPubkey: 'f'.repeat(64) }],
    ['issuer clock exceeds allowed skew', { issuerClockOffsetSeconds: 6, lifetimeSeconds: 299 }],
    ['assertion lifetime exceeds 300 seconds', { lifetimeSeconds: 301 }],
    ['response expiry disagrees with JWT expiry', { outerExpiry: Math.floor(now / 1000) + 299 }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      let relayRequests = 0;
      await assert.rejects(() => publishAgentProfile({
        identityOrigin: 'https://identity.example',
        relayUrl: 'wss://relay.example',
        ...identity,
        displayName: 'Research Agent',
        now,
        fetchImpl: async (url) => {
          if (url === 'https://identity.example/v1/agents/assertions') {
            return new Response(JSON.stringify(assertionResponse(identity, now, overrides)), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          relayRequests += 1;
          return new Response(JSON.stringify({ accepted: true }), { status: 200 });
        },
      }), /invalid agent assertion/);
      assert.equal(relayRequests, 0);
    });
  }
});

test('agent profile registration fails closed for a mismatched owner proof or relay', async () => {
  const identity = enrollment();
  let requests = 0;
  const fetchImpl = async () => { requests += 1; throw new Error('unexpected request'); };
  await assert.rejects(() => publishAgentProfile({
    identityOrigin: 'https://identity.example',
    relayUrl: 'wss://relay.example',
    ...identity,
    ownerPubkey: 'f'.repeat(64),
    displayName: 'Research Agent',
    fetchImpl,
  }), /does not match its owner/);
  await assert.rejects(() => publishAgentProfile({
    identityOrigin: 'https://identity.example',
    relayUrl: 'https://relay.example',
    ...identity,
    displayName: 'Research Agent',
    fetchImpl,
  }), /canonical wss origin/);
  assert.equal(requests, 0);
});
