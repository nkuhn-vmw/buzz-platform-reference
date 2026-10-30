import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('worker startup failure exits unsuccessfully without starting ACP', {timeout:5000}, async () => {
  const agentRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const tempRoot = mkdtempSync(join(tmpdir(), 'buzz-worker-startup-'));
  let worker;
  try {
    const env = {...process.env,
      BUZZ_AGENT_DATABASE_CONFIG:'invalid-json',
      BUZZ_ACP_AGENT_PUBKEY:'d'.repeat(64),
      BUZZ_GRANT_EXPIRES_AT:new Date(Date.now()+60000).toISOString(),
      BUZZ_WORKSPACE:join(tempRoot,'workspace'), HOME:join(tempRoot,'home'),
      XDG_CONFIG_HOME:join(tempRoot,'config'), XDG_DATA_HOME:join(tempRoot,'data'), XDG_CACHE_HOME:join(tempRoot,'cache')};
    worker = spawn(process.execPath, [join(agentRoot,'worker.mjs')], {env, stdio:['ignore','pipe','pipe']});
    let output = '';
    worker.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    worker.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker did not exit after startup failure')), 3000);
      worker.once('exit', value => { clearTimeout(timer); resolve(value); });
    });
    assert.notEqual(code, 0, 'database startup failure must not report a successful task');
    assert.match(output, /Agent worker failed:/);
    assert.doesNotMatch(output, /agent process failed to start/);
  } finally {
    if (worker && worker.exitCode === null) worker.kill('SIGKILL');
    rmSync(tempRoot, {recursive:true, force:true});
  }
});
