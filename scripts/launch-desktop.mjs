// Launch the isolated pilot desktop with its deployment's shared owner key.
import { readFileSync, openSync, mkdirSync, chmodSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadDeployment } from './lib/config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const deployment = loadDeployment();
const bundle = process.argv[2] || join(root, 'artifacts', 'desktop', deployment.desktop.profile, `${deployment.desktop.name}.app`);
if (!bundle?.endsWith('.app')) throw new Error('Usage: node scripts/launch-desktop.mjs [/absolute/path/Deployment.app]');
const owner = JSON.parse(readFileSync(join(deployment.credentialsDir, 'pilot-owner.json'), 'utf8'));
if (!/^[a-f0-9]{64}$/.test(owner.secret_hex ?? '')) throw new Error('Invalid pilot owner identity');
mkdirSync(deployment.stateDir, { recursive: true, mode: 0o700 });
const logPath = join(deployment.stateDir, 'desktop.log');
const log = openSync(logPath, 'a', 0o600);
chmodSync(logPath, 0o600);
const child = spawn(join(bundle, 'Contents/MacOS/buzz-desktop'), [], {
  env: { ...process.env, BUZZ_PRIVATE_KEY: owner.secret_hex, BUZZ_SHARE_IDENTITY: '1', BUZZ_RELAY_URL: deployment.relayUrl },
  stdio: ['ignore', log, log], detached: true,
});
child.on('error', () => { console.error('Pilot desktop failed to launch'); process.exitCode = 1; });
child.unref();
console.log(`Launched isolated desktop profile '${deployment.desktop.profile}'. Log: ${logPath}`);
