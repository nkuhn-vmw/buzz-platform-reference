import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restrictedCFCommand, runCF, verifyLocalTarget } from '../lib/cf.mjs';
import { parseArgs, selectServiceInstances, serviceDefinitions, serviceInstancesPath } from '../provision.mjs';

function withCFConfig(saved, run) {
  const home = mkdtempSync(join(tmpdir(), 'buzz-cf-home-'));
  try {
    const dir = join(home, '.cf');
    mkdirSync(dir);
    writeFileSync(join(dir, 'config.json'), JSON.stringify(saved));
    run(home);
  } finally { rmSync(home, { recursive: true, force: true }); }
}
const deployment = { api: 'https://api.example.org', org: 'pilot-org', space: 'pilot-space', stateDir: '/tmp/buzz-state' };
const localConfig = {
  Target: 'https://api.example.org',
  OrganizationFields: { Name: 'pilot-org', GUID: 'org-guid' },
  SpaceFields: { Name: 'pilot-space', GUID: 'space-guid' },
};

test('CF target preflight accepts only the exact configured API, org, and space', () => {
  withCFConfig(localConfig, (home) => assert.equal(verifyLocalTarget(deployment, home).cfHome, home));
  withCFConfig({ ...localConfig, Target: 'https://other.example.org' }, (home) => assert.throws(() => verifyLocalTarget(deployment, home), /does not match configured API/));
  withCFConfig({ ...localConfig, OrganizationFields: { Name: 'other-org' } }, (home) => assert.throws(() => verifyLocalTarget(deployment, home), /does not match configured API/));
  withCFConfig({ ...localConfig, SpaceFields: { Name: 'other-space' } }, (home) => assert.throws(() => verifyLocalTarget(deployment, home), /does not match configured API/));
});

test('CF command is not launched when the isolated local target is wrong', () => {
  const home = mkdtempSync(join(tmpdir(), 'buzz-cf-guard-'));
  const bin = join(home, 'bin');
  const cfHome = join(home, 'cf-home');
  const marker = join(home, 'cf-was-called');
  mkdirSync(bin);
  mkdirSync(join(cfHome, '.cf'), { recursive: true });
  writeFileSync(join(cfHome, '.cf', 'config.json'), JSON.stringify({ ...localConfig, SpaceFields: { Name: 'some-other-space' } }));
  const fakeCF = join(bin, 'cf');
  writeFileSync(fakeCF, '#!/bin/sh\nprintf called > "$CF_MARKER"\n');
  chmodSync(fakeCF, 0o700);
  const previousPath = process.env.PATH;
  const previousMarker = process.env.CF_MARKER;
  process.env.PATH = `${bin}:${previousPath ?? ''}`;
  process.env.CF_MARKER = marker;
  try {
    assert.throws(() => runCF(['push'], { deployment: { ...deployment, cfHome } }), /does not match configured API/);
    assert.equal(existsSync(marker), false);
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousMarker === undefined) delete process.env.CF_MARKER; else process.env.CF_MARKER = previousMarker;
    rmSync(home, { recursive: true, force: true });
  }
});

test('CF wrapper blocks commands and flags that can change authentication or target context', () => {
  for (const command of ['api', 'auth', 'login', 'target', 'logout', 'l', 't', 'lo']) assert.equal(restrictedCFCommand([command]), true);
  for (const flags of [['-a', 'https://other.example', 'push'], ['--org', 'other-org', 'push'], ['--space', 'other-space', 'push']]) assert.equal(restrictedCFCommand(flags), true);
  assert.equal(restrictedCFCommand(['push', '--strategy', 'rolling']), false);
  assert.equal(restrictedCFCommand(['push', '-s', 'cflinuxfs4']), false);
});

test('service inventory scopes duplicate logical names to the verified CF space GUID', () => {
  const resources = [
    { name: 'buzz-db', guid: 'old-space-instance', relationships: { space: { data: { guid: 'old-space-guid' } } } },
    { name: 'buzz-db', guid: 'target-space-instance', relationships: { space: { data: { guid: 'target-space-guid' } } } },
  ];
  const path = serviceInstancesPath(['buzz-db'], 'target-space-guid');
  const query = new URL(path, 'https://api.example.org').searchParams;
  assert.equal(query.get('names'), 'buzz-db');
  assert.equal(query.get('space_guids'), 'target-space-guid');
  assert.equal(selectServiceInstances(resources, ['buzz-db'], 'target-space-guid').get('buzz-db').guid, 'target-space-instance');
});

test('provisioner accepts explicit plan mode and rejects contradictory modes', () => {
  assert.deepEqual(parseArgs([]), { apply: false, wait: false });
  assert.deepEqual(parseArgs(['--plan']), { apply: false, wait: false });
  assert.throws(() => parseArgs(['--plan', '--apply']), /cannot be combined/);
});

test('provider dashboard services use deployment-scoped logical names', () => {
  const names = serviceDefinitions({ routePrefix: 'pilot-blue' }).map(({ name }) => name);
  assert.ok(names.includes('pilot-blue-gateway'));
  assert.ok(names.includes('pilot-blue-credentials'));
  assert.ok(!names.includes('buzz-gateway'));
  assert.ok(!names.includes('buzz-credentials'));
  assert.ok(names.includes('buzz-sso'));
  assert.ok(names.includes('buzz-identity-secrets'));
});
