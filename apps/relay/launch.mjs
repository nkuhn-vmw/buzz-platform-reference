import { relayEnvironment } from './bindings.mjs';
import { mkdirSync } from 'node:fs';
try {
  const env = relayEnvironment(process.env);
  mkdirSync('work/repos', { recursive: true, mode: 0o700 });
  const args = process.argv.slice(2);
  const binary = args.length ? 'buzz-admin' : 'buzz-relay';
  if (!args.length && env.BUZZ_NIP_FI_MODE === 'enforce') {
    let ready = false;
    for (let attempt = 0; attempt < 20 && !ready; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:8082/.well-known/jwks.json', {
          redirect: 'error', signal: AbortSignal.timeout(1500),
        });
        ready = response.ok && Array.isArray((await response.json()).keys);
      } catch { /* the separately supervised CF sidecar may still be starting */ }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Authenticated JWKS bridge is unavailable');
  }
  process.execve(`${process.cwd()}/bin/${binary}`, [binary, ...args], env);
} catch (error) {
  // Configuration errors include field names only; never serialize bindings.
  const detail = error instanceof SyntaxError ? 'Invalid binding JSON' : error.message;
  console.error(`Relay launcher refused startup: ${detail}`);
  process.exit(1);
}
