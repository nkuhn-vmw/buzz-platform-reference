import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLease } from './lease.mjs';
import { LEASE_KILL_GRACE_MS } from './lease-config.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const deadline = Date.parse(process.env.BUZZ_GRANT_EXPIRES_AT);
if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error('Owner grant expired');
for (const key of ['HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','BUZZ_WORKSPACE']) mkdirSync(process.env[key], {recursive:true, mode:0o700});

let child;
let stopping;
let killTimer;
let expiration;
let lease;
let stopResolve;
let stopPromise;
let exitCode = 1;
let rejectStartupStop;
const startupStop = new Promise((_, reject) => { rejectStartupStop = reject; });
startupStop.catch(() => {});
async function killGroupAndWait(pid) {
  try { process.kill(-pid, 'SIGKILL'); } catch {}
  while (true) {
    try { process.kill(-pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
function terminate(reason, hardDeadline = false) {
  if (stopping) return stopPromise;
  stopping = true;
  exitCode = 1;
  console.error(`Agent stopping: ${reason}`);
  rejectStartupStop(new Error(reason));
  stopPromise = new Promise(resolve => { stopResolve = resolve; });
  if (!child?.pid) { stopResolve(); return stopPromise; }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { stopResolve(); return stopPromise; }
  const remaining = hardDeadline ? Math.max(0, deadline - Date.now()) : LEASE_KILL_GRACE_MS;
  killTimer = setTimeout(() => {
    void killGroupAndWait(child.pid).finally(() => stopResolve());
  }, remaining);
  return stopPromise;
}
process.on('unhandledRejection', error => { exitCode = 1; void terminate(`unhandled rejection (${error?.message || 'unknown error'})`); });
process.on('uncaughtException', error => { exitCode = 1; void terminate(`uncaught exception (${error.message})`); });
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { void terminate(signal); });
const scheduleExpiration = () => {
  const remaining = deadline - Date.now();
  if (remaining <= 0) { void terminate('owner grant expired', true); return; }
  if (remaining <= 2000) {
    expiration = setTimeout(() => { void terminate('owner grant expired', true); }, remaining);
  } else expiration = setTimeout(scheduleExpiration, Math.min(remaining - 2000, 0x7fffffff));
  expiration.unref();
};
scheduleExpiration();

try {
  lease = await acquireLease({ connectionConfig: JSON.parse(process.env.BUZZ_AGENT_DATABASE_CONFIG), agentPubkey: process.env.BUZZ_ACP_AGENT_PUBKEY, onLost: error => { void terminate(`database lease lost (${error.message})`); } });
  if (stopping || Date.now() >= deadline) throw new Error('Owner grant expired before worker start');
  await Promise.race([lease.waitTakeoverGrace(), startupStop]);
  if (stopping || Date.now() >= deadline) throw new Error('Worker lease or owner grant expired before worker start');
  const childEnv = {...process.env};
  delete childEnv.BUZZ_AGENT_DATABASE_CONFIG;
  delete childEnv.VCAP_SERVICES;
  for (const name of Object.keys(childEnv)) if (/^PG(?:HOST|PORT|DATABASE|USER|PASSWORD|SERVICE|SSLMODE|OPTIONS)$/.test(name)) delete childEnv[name];
  child = spawn(join(root, 'bin', 'buzz-acp'), [], {cwd:process.env.BUZZ_WORKSPACE, env:childEnv, stdio:'inherit', detached:true});
  const childExit = new Promise(resolve => {
    child.once('error', () => { void terminate('agent process failed to start'); resolve(); });
    child.once('exit', async (code, signal) => {
      if (!stopping) exitCode = code ?? (signal ? 1 : 0);
      else if (code !== null && code !== 0) exitCode = code;
      if (stopPromise) await stopPromise;
      else {
        stopping = true;
        await killGroupAndWait(child.pid);
      }
      resolve();
    });
  });
  await childExit;
  if (stopping && stopPromise) await stopPromise;
} catch (error) {
  exitCode = 1;
  console.error(`Agent worker failed: ${error?.message || 'startup or runtime error'}`);
} finally {
  clearTimeout(expiration);
  clearTimeout(killTimer);
  // Keep the lock through child-group termination. PostgreSQL session locks
  // provide bounded best-effort exclusion, not partition fencing.
  try { await lease?.release(); }
  catch (error) {
    exitCode = 1;
    console.error(`Agent lease cleanup failed: ${error?.message || 'unknown error'}`);
  }
}
process.exitCode = exitCode;
