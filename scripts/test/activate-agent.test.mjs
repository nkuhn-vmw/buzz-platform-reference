import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureAgentManifest, hasNativeC2CPolicy, identityServiceFor, loadEnrollmentFiles, parseArgs, appNameFor } from '../activate-agent.mjs';

function pair() {
  const ecdh = createECDH('secp256k1');
  ecdh.generateKeys();
  const secret = ecdh.getPrivateKey().toString('hex');
  const pubkey = ecdh.getPublicKey(undefined, 'compressed').subarray(1).toString('hex');
  return { secret, pubkey };
}
function writePrivate(path, value) {
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  chmodSync(path, 0o600);
}

test('activation defaults to helper and derives safe app and service names', () => {
  assert.deepEqual(parseArgs([]), { agent: 'helper' });
  assert.deepEqual(parseArgs(['--agent', 'weekly_report-2']), { agent: 'weekly_report-2' });
  assert.throws(() => parseArgs(['--agent', '../unsafe']), /Usage/);
  assert.equal(appNameFor('helper'), 'buzz-agent');
  assert.equal(appNameFor('summarizer'), 'buzz-agent-summarizer');
  assert.equal(identityServiceFor('helper'), 'buzz-agent-identity');
  assert.equal(identityServiceFor('summarizer'), 'buzz-agent-identity-summarizer');
});

test('activation checks owner and agent keys against the private enrollment record and expiry', () => {
  const directory = mkdtempSync(join(tmpdir(), 'buzz-enrollment-'));
  try {
    const credentials = join(directory, '.credentials');
    const agentDir = join(credentials, 'agents', 'helper');
    mkdirSync(agentDir, { recursive: true, mode: 0o700 });
    const owner = pair();
    const agent = pair();
    const expires = new Date(Date.now() + 60_000).toISOString();
    writePrivate(join(credentials, 'pilot-owner.json'), { secret_hex: owner.secret, pubkey: owner.pubkey });
    const binding = {
      BUZZ_PRIVATE_KEY: agent.secret,
      BUZZ_ACP_AGENT_OWNER: owner.pubkey,
      BUZZ_FI_GRANT_TOKEN: 'g'.repeat(43),
      BUZZ_GRANT_EXPIRES_AT: expires,
      BUZZ_AUTH_TAG: JSON.stringify(['auth', owner.pubkey, `created_at<${Math.floor(Date.parse(expires) / 1000)}`, 'a'.repeat(128)]),
    };
    const enrollment = {
      grant_id: '00000000-0000-4000-8000-000000000001',
      owner_pubkey: owner.pubkey,
      agent_pubkey: agent.pubkey,
      expires_at: expires,
    };
    writePrivate(join(agentDir, 'agent-identity.json'), binding);
    writePrivate(join(agentDir, 'agent-enrollment.json'), enrollment);
    assert.equal(loadEnrollmentFiles(credentials, 'helper').ownerPubkey, owner.pubkey);
    const nearExpiry = new Date(Date.now() + 20_000).toISOString();
    binding.BUZZ_GRANT_EXPIRES_AT = nearExpiry;
    enrollment.expires_at = nearExpiry;
    writePrivate(join(agentDir, 'agent-identity.json'), binding);
    writePrivate(join(agentDir, 'agent-enrollment.json'), enrollment);
    assert.throws(() => loadEnrollmentFiles(credentials, 'helper'), /less than 30 seconds/);
    enrollment.owner_pubkey = 'f'.repeat(64);
    writePrivate(join(agentDir, 'agent-enrollment.json'), enrollment);
    assert.throws(() => loadEnrollmentFiles(credentials, 'helper'), /Owner key does not match/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('activation renders per-agent author/runtime settings and keeps native model binding shared', () => {
  const template = { name: 'buzz-agent', services: ['buzz-ai', 'buzz-agent-identity'], env: {
    BUZZ_TANZU_AI_MODEL: 'shared-model', BUZZ_TANZU_AGENT_URL: 'http://agent.internal:8080/api/chat',
  } };
  const ownerPubkey = 'a'.repeat(64);
  const base = { routePrefix: 'team-one', model: 'shared-model', agents: {}, };
  const tanzu = configureAgentManifest(template, { deployment: base, agent: 'helper', identityService: 'buzz-agent-identity', ownerPubkey });
  assert.equal(tanzu.app.name, 'buzz-agent');
  assert.equal(tanzu.app.env.BUZZ_RUNTIME, 'tanzu');
  assert.equal(tanzu.app.env.BUZZ_ACP_SESSION_POLICY, 'thread');
  assert.equal(tanzu.app.env.BUZZ_ACP_RESPOND_TO, 'owner-only');
  assert.equal(tanzu.app.env.BUZZ_TANZU_AI_MODEL, 'shared-model');
  const builtin = configureAgentManifest({ ...template, services: [...template.services], env: { ...template.env } }, {
    deployment: { ...base, agents: { researcher: { runtime: 'builtin', displayName: 'Research Agent', model: 'custom-model', respondTo: 'allowlist', respondToAllowlist: ['b'.repeat(64)] } } },
    agent: 'researcher', identityService: 'buzz-agent-identity-researcher', ownerPubkey,
  });
  assert.equal(builtin.app.name, 'buzz-agent-researcher');
  assert.equal(builtin.app.env.BUZZ_RUNTIME, 'builtin');
  assert.equal(builtin.app.env.BUZZ_ACP_DISPLAY_NAME, 'Research Agent');
  assert.equal(builtin.app.env.BUZZ_TANZU_AI_MODEL, 'custom-model');
  assert.equal(builtin.app.env.BUZZ_TANZU_AGENT_URL, undefined);
  assert.equal(builtin.app.env.BUZZ_ACP_RESPOND_TO_ALLOWLIST, 'b'.repeat(64));
  assert.throws(() => configureAgentManifest(template, {
    deployment: { ...base, agents: { helper: { runtime: 'tanzu', model: 'local-model' } } },
    agent: 'helper', identityService: 'buzz-agent-identity', ownerPubkey,
  }), /applies only to builtin runtime/);
  assert.throws(() => configureAgentManifest(template, {
    deployment: { ...base, agents: { helper: { respondTo: 'allowlist', respondToAllowlist: [] } } },
    agent: 'helper', identityService: 'buzz-agent-identity', ownerPubkey,
  }), /required when respondTo is allowlist/);
});

test('native C2C policy matching requires the exact source, destination, port, space, and org', () => {
  const output = [
    'Listing network policies in org pilot-org / space pilot-space...',
    'source destination protocol ports destination space destination org',
    'buzz-agent-helper buzz-platform-agent tcp 8080 pilot-space pilot-org',
  ].join('\n');
  assert.equal(hasNativeC2CPolicy(output, 'buzz-agent-helper', 'pilot-space', 'pilot-org'), true);
  assert.equal(hasNativeC2CPolicy(output, 'buzz-agent-other', 'pilot-space', 'pilot-org'), false);
  assert.equal(hasNativeC2CPolicy(output.replace('8080', '1-65535'), 'buzz-agent-helper', 'pilot-space', 'pilot-org'), false);
});
