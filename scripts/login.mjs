// Operator login through the configured identity service; session stays local and private.
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { loadDeployment } from './lib/config.mjs';

const deployment = loadDeployment();
const base = deployment.identityOrigin;
if (!base || new URL(base).protocol !== 'https:') throw new Error('Deployment identity origin must use HTTPS');
const stateDir = deployment.stateDir;
const credentialsDir = deployment.credentialsDir;
const secret = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(secret).digest('base64url');
let consumed = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'GET' || url.pathname !== '/callback' || consumed) { res.writeHead(404).end(); return; }
  if (url.searchParams.has('error')) {
    res.writeHead(400).end('SSO refused this login. You can close this tab.');
    console.error('SSO login refused'); clearTimeout(timer); server.close(); process.exitCode = 1; return;
  }
  if (url.searchParams.getAll('code').length !== 1) { res.writeHead(400).end(); return; }
  consumed = true;
  try {
    const exchange = await fetch(`${base}/v1/login/exchange`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: url.searchParams.get('code'), handoff_secret: secret }),
    });
    if (!exchange.ok) throw new Error('Exchange refused');
    const session = await exchange.json();
    const checked = await fetch(`${base}/v1/session`, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${session.session_token}` } });
    if (!checked.ok) throw new Error('Session refused');
    const verified = await checked.json();
    if (!Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) !== Date.parse(verified.expires_at)) throw new Error('Session expiry mismatch');
    mkdirSync(credentialsDir, { recursive: true, mode: 0o700 });
    const sessionPath = join(credentialsDir, 'operator-session.json');
    writeFileSync(sessionPath, JSON.stringify({ base, ...session }), { mode: 0o600 });
    chmodSync(sessionPath, 0o600);
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('SSO verified. You can close this tab.');
    console.log('SSO session verified and saved privately.');
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('Login did not complete. Check the operator terminal.');
    console.error('Login/session verification failed; no credential was saved.'); process.exitCode = 1;
  } finally { clearTimeout(timer); server.close(); }
});
const timer = setTimeout(() => { console.error('Login timed out.'); server.close(); process.exitCode = 1; }, 300_000);
server.listen(0, '127.0.0.1', () => {
  const url = new URL(`${base}/v1/login/start`);
  url.search = new URLSearchParams({ return_to: `http://127.0.0.1:${server.address().port}/callback`, handoff_challenge: challenge, handoff_challenge_method: 'S256' });
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(stateDir, 'login-url.txt'), url.href, { mode: 0o600 });
  console.log(`Open the login URL in ${join(stateDir, 'login-url.txt')}. Listening on loopback port ${server.address().port}.`);
});
