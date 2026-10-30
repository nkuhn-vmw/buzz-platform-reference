import { advisoryKey, LEASE_FAILURE_TIMEOUT_MS, LEASE_HEARTBEAT_MS, LEASE_TAKEOVER_GRACE_MS } from './lease-config.mjs';

// Requires a direct PostgreSQL endpoint. Session locks are not safe through a
// transaction-pooling proxy. Loss detection is bounded, not partition fencing.
export async function acquireLease({ connectionConfig, agentPubkey, onLost = () => {}, heartbeatMs = LEASE_HEARTBEAT_MS, failureTimeoutMs = LEASE_FAILURE_TIMEOUT_MS, takeoverGraceMs = LEASE_TAKEOVER_GRACE_MS }) {
  if (!connectionConfig || typeof connectionConfig !== 'object') throw new Error('Dedicated PostgreSQL connection config required');
  const {default: pg} = await import('pg');
  const client = new pg.Client({ ...connectionConfig, connectionTimeoutMillis: failureTimeoutMs, query_timeout: failureTimeoutMs, statement_timeout: failureTimeoutMs, keepAlive: true, keepAliveInitialDelayMillis: 1000 });
  const key = advisoryKey(agentPubkey);
  const unsigned = BigInt.asUintN(64, BigInt(key));
  const classId = Number((unsigned >> 32n) & 0xffffffffn);
  const objectId = Number(unsigned & 0xffffffffn);
  let closed = false;
  let failed = false;
  let acquired = false;
  let lastSuccess;
  let timer;
  let rejectLoss;
  const lostPromise = new Promise((_, reject) => { rejectLoss = reject; });
  lostPromise.catch(() => {});
  const lose = error => {
    if (closed || failed) return;
    failed = true;
    clearTimeout(timer);
    rejectLoss(error);
    try { onLost(error); } catch {}
  };
  client.on('error', lose);
  client.on('end', () => lose(new Error('PostgreSQL session ended')));
  const dispose = async destroy => {
    closed = true;
    clearTimeout(timer);
    if (destroy) client.connection?.stream?.destroy();
    await client.end().catch(() => {});
  };

  let backendPid;
  try {
    await client.connect();
    if (failed) throw new Error('Database session failed during connection');
    const lock = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [key]);
    if (!lock.rows[0]?.acquired) throw new Error('Another task already owns this agent');
    acquired = true;
    const state = await client.query(`SELECT pg_backend_pid() AS pid,
      EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()
        AND granted AND classid=$1::oid AND objid=$2::oid AND objsubid=1) AS held`, [classId, objectId]);
    backendPid = Number(state.rows[0]?.pid);
    if (failed || !Number.isSafeInteger(backendPid) || state.rows[0]?.held !== true) throw new Error('Unable to verify PostgreSQL lock session');
    lastSuccess = performance.now();
  } catch (error) {
    await dispose(failed || acquired);
    throw error;
  }

  const heartbeat = async () => {
    if (closed || failed) return;
    try {
      const {rows} = await client.query(`SELECT pg_backend_pid() AS pid,
        EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()
          AND granted AND classid=$1::oid AND objid=$2::oid AND objsubid=1) AS held`, [classId, objectId]);
      if (Number(rows[0]?.pid) !== backendPid || rows[0]?.held !== true) throw new Error('Database lease session or lock changed');
      lastSuccess = performance.now();
    } catch (error) {
      lose(error);
      return;
    }
    timer = setTimeout(heartbeat, heartbeatMs);
    timer.unref();
  };
  timer = setTimeout(heartbeat, heartbeatMs);
  timer.unref();
  return {
    backendPid,
    async waitTakeoverGrace(graceMs = takeoverGraceMs) {
      const graceDeadline = performance.now() + graceMs;
      while (!failed) {
        const remaining = graceDeadline - performance.now();
        if (remaining <= 0) break;
        await Promise.race([new Promise(resolve => setTimeout(resolve, remaining)), lostPromise]);
      }
      if (failed || performance.now() - lastSuccess >= failureTimeoutMs) throw new Error('Database lease failed takeover grace');
    },
    async release() {
      if (closed) return;
      if (!failed) {
        try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [key]); }
        catch { failed = true; }
      }
      await dispose(failed);
    },
  };
}
