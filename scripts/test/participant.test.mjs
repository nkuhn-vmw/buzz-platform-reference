import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const key = 'ab'.repeat(32);
const spaceGuid = '11111111-1111-4111-8111-111111111111';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'buzz-participant-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cfHome = join(dir, 'cf-home');
  mkdirSync(join(cfHome, '.cf'), { recursive: true });
  const config = JSON.parse(readFileSync(new URL('config/deployment.example.json', root)));
  config.cfHome = cfHome;
  writeFileSync(join(cfHome, '.cf/config.json'), JSON.stringify({ Target: config.api,
    OrganizationFields: { Name: config.org, GUID: 'org-guid' },
    SpaceFields: { Name: config.space, GUID: spaceGuid } }));
  const configPath = join(dir, 'deployment.json');
  writeFileSync(configPath, JSON.stringify(config));
  const calls = join(dir, 'calls.jsonl');
  writeFileSync(calls, '');
  const fakeCF = join(dir, 'cf');
  writeFileSync(fakeCF, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.CF_TEST_CALLS, JSON.stringify(args)+'\\n');
if (args[0]==='space') console.log('${spaceGuid}');
else if (args[0]==='curl' && args[1].startsWith('/v3/apps?')) console.log(JSON.stringify({resources:[{name:'buzz-relay',guid:'relay-guid'}]}));
else if (args[0]==='curl' && args[1]==='/v3/apps/relay-guid/tasks') console.log(JSON.stringify({guid:'created-task-guid',sequence_id:7}));
else if (args[0]==='curl' && args[1]==='/v3/tasks/created-task-guid') console.log(JSON.stringify({state:process.env.CF_TEST_TASK_STATE || 'SUCCEEDED'}));
else { console.error('Unexpected CF command'); process.exit(1); }
`);
  // The generated CLI uses ESM regardless of the temporary directory's defaults.
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  chmodSync(fakeCF, 0o700);
  return {
    run(args, state = 'SUCCEEDED') {
      return spawnSync(process.execPath, ['scripts/deploy.mjs', ...args], { cwd: root, encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, BUZZ_DEPLOYMENT_CONFIG: configPath,
          CF_TEST_CALLS: calls, CF_TEST_TASK_STATE: state } });
    },
    calls: () => readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
  };
}

test('participant admission and cleanup target only the relay and ordinary member role', (t) => {
  const f = fixture(t);
  for (const [step, command] of [['admit-participant', 'add-member'], ['remove-participant', 'remove-member']]) {
    const result = f.run([step, key]);
    assert.equal(result.status, 0, result.stderr);
    const post = f.calls().filter(args => args.includes('POST')).at(-1);
    assert.equal(post[1], '/v3/apps/relay-guid/tasks');
    const body = JSON.parse(post[post.indexOf('-d') + 1]);
    assert.equal(body.command, `node launch.mjs ${command} --pubkey ${key} --role member`);
    assert.ok(f.calls().some(args => args[1] === '/v3/tasks/created-task-guid'));
  }
});

test('malformed keys and attempted role overrides cannot launch a CF command', (t) => {
  const f = fixture(t);
  for (const args of [['admit-participant', `${key};id`], ['remove-participant', key, '--role', 'admin'], ['admit-participant']]) {
    const result = f.run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /VERIFIED_BUZZ_PUBLIC_KEY_HEX/);
  }
  assert.deepEqual(f.calls(), []);
});

test('a failed membership task is reported as failure, not successful admission', (t) => {
  const f = fixture(t);
  const result = f.run(['admit-participant', key], 'FAILED');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /task failed/);
  assert.doesNotMatch(result.stdout, /membership task completed/);
});
