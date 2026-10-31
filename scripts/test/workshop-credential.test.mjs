import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('workshop management refuses mismatched CF target or participant before contacting services', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzz-workshop-user-'));
  try {
    const cfHome = join(dir, 'cf');
    mkdirSync(join(cfHome, '.cf'), { recursive: true });
    const claims = Buffer.from(JSON.stringify({ email: 'alice@example.invalid', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
    const token = `synthetic.${claims}.not-a-real-signature`;
    writeFileSync(join(cfHome, '.cf/config.json'), JSON.stringify({ Target: 'https://api.example.invalid', OrganizationFields: { Name: 'workshop' }, SpaceFields: { Name: 'synthetic', GUID: 'fixture-space' }, AccessToken: `bearer ${token}` }));
    const config = { api: 'https://api.example.invalid', org: 'workshop', space: 'synthetic', cfHome, email: 'alice@example.invalid', storeOrigin: 'https://store.example.invalid', storeId: '11111111-1111-4111-8111-111111111111' };
    const path = join(dir, 'participant.json');
    for (const [override, expected] of [[{ space: 'another-space' }, /CF target mismatch/], [{ email: 'bob@example.invalid' }, /Wrong participant/]]) {
      writeFileSync(path, JSON.stringify({ ...config, ...override }));
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../workshop-credential.mjs', import.meta.url)), 'inspect', path], { encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, expected);
      assert.equal((result.stdout + result.stderr).includes(token), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
