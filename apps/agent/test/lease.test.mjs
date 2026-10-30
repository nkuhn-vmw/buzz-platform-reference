import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { advisoryKey, databaseConfig, validateGrant, validateIdentityServiceName } from '../lease-config.mjs';
import { acquireLease } from '../lease.mjs';

test('grant validation fails closed for absent, malformed, and expired grants', () => {
  assert.throws(() => validateGrant(undefined, undefined), /Invalid owner/);
  assert.throws(() => validateGrant('a'.repeat(64), undefined), /Missing grant expiration/);
  assert.throws(() => validateGrant('a'.repeat(64), 'not-a-date'), /expired/);
  assert.throws(() => validateGrant('a'.repeat(64), new Date(1000).toISOString(), 1000), /expired/);
  assert.equal(validateGrant('a'.repeat(64), new Date(2000).toISOString(), 1000), 2000);
});

test('identity binding service names follow the activated agent-name grammar', () => {
  assert.equal(validateIdentityServiceName(), 'buzz-agent-identity');
  assert.equal(validateIdentityServiceName('buzz-agent-identity-1research'), 'buzz-agent-identity-1research');
  assert.equal(validateIdentityServiceName('buzz-agent-identity-research_team'), 'buzz-agent-identity-research_team');
  assert.equal(validateIdentityServiceName('buzz-agent-identity-a_b-3'), 'buzz-agent-identity-a_b-3');
  assert.throws(() => validateIdentityServiceName('buzz-agent-identity-Upper'), /Invalid BUZZ_IDENTITY_SERVICE/);
  assert.throws(() => validateIdentityServiceName('buzz-agent-identity-'), /Invalid BUZZ_IDENTITY_SERVICE/);
});

test('advisory lock identity is stable and rejects malformed owners', () => {
  assert.equal(advisoryKey('0'.repeat(64)), '7379282877061709175');
  assert.equal(advisoryKey('0000000000000001' + '0'.repeat(48)), '-2215828674914797327');
  assert.throws(() => advisoryKey('bad'), /Invalid agent public key/);
});

test('database binding parser preserves special characters and enforces verified TLS', () => {
  const ca = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
  const config = databaseConfig({db:'agents', primary_host:'db.example', port:5432, user:'worker', password:'p:@ ss', ca}, '');
  assert.equal(config.password, 'p:@ ss');
  assert.deepEqual(config.ssl, {rejectUnauthorized:true, ca});
  const fromUri = databaseConfig({uri:'postgresql://worker:p%3A%40%20ss@db.example:5432/agents', ca}, '');
  assert.equal(fromUri.password, 'p:@ ss');
  assert.equal(fromUri.ssl.rejectUnauthorized, true);
  assert.throws(() => databaseConfig({uri:'postgresql://worker:secret@db.example/agents?sslmode=disable', ca}, ''), /unsafe sslmode/);
  assert.throws(() => databaseConfig({db:'agents', primary_host:'db.example', port:5432, user:'worker', password:'secret'}, ''), /CA certificate required/);
});

test('database binding loads certificates from a system trust directory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'buzz-ca-'));
  const cert = '-----BEGIN CERTIFICATE-----\nca bundle entry\n-----END CERTIFICATE-----';
  try {
    writeFileSync(join(directory, 'root.crt'), cert);
    writeFileSync(join(directory, 'ignored.txt'), 'not a certificate');
    const config = databaseConfig({db:'agents', primary_host:'db.example', port:5432, user:'worker', password:'secret'}, directory);
    assert.equal(config.ssl.ca, cert);
    assert.throws(() => databaseConfig({db:'agents', primary_host:'db.example', port:5432, user:'worker', password:'secret'}, join(directory, 'missing')), /Unable to read PostgreSQL CA trust/);
  } finally { rmSync(directory, {recursive:true, force:true}); }
});

function testConnectionConfig() {
  const testUrl = new URL(process.env.BUZZ_AGENT_TEST_DATABASE_URL);
  const ssl = {rejectUnauthorized:true};
  if (process.env.BUZZ_AGENT_TEST_CA_PATH) ssl.ca = readFileSync(process.env.BUZZ_AGENT_TEST_CA_PATH, 'utf8');
  return {host:testUrl.hostname, port:Number(testUrl.port || 5432), database:testUrl.pathname.slice(1), user:decodeURIComponent(testUrl.username), password:decodeURIComponent(testUrl.password), ssl};
}

test('PostgreSQL session lock excludes a duplicate and is released', {skip: !process.env.BUZZ_AGENT_TEST_DATABASE_URL}, async () => {
  const options = {connectionConfig:testConnectionConfig(), agentPubkey:'a'.repeat(64), heartbeatMs:250, failureTimeoutMs:1000};
  const first = await acquireLease(options);
  await assert.rejects(acquireLease(options), /already owns/);
  await first.release();
  const second = await acquireLease(options);
  await second.release();
});

test('lease loss is detected on the owning PostgreSQL session', {skip: !process.env.BUZZ_AGENT_TEST_DATABASE_URL}, async () => {
  const {default: pg} = await import('pg');
  const config = testConnectionConfig();
  let resolveLost;
  const lost = new Promise(resolve => { resolveLost = resolve; });
  const lease = await acquireLease({connectionConfig:config, agentPubkey:'b'.repeat(64), heartbeatMs:250, failureTimeoutMs:1000, onLost:resolveLost});
  const killer = new pg.Client(config);
  await killer.connect();
  try {
    await killer.query('SELECT pg_terminate_backend($1::int)', [lease.backendPid]);
    const error = await Promise.race([lost, new Promise((_, reject) => setTimeout(() => reject(new Error('lease loss was not detected')), 5000))]);
    assert.match(error.message, /terminat|connection|closed|socket/i);
  } finally {
    await killer.end();
    await lease.release();
  }
});

test('worker kills its whole child group after lease loss before another lease starts', {skip: !process.env.BUZZ_AGENT_TEST_DATABASE_URL, timeout:30000}, async () => {
  const {default: pg} = await import('pg');
  const config = testConnectionConfig();
  const pubkey = 'c'.repeat(64);
  const ownerKey = advisoryKey(pubkey);
  const unsigned = BigInt.asUintN(64, BigInt(ownerKey));
  const classId = Number((unsigned >> 32n) & 0xffffffffn);
  const objectId = Number(unsigned & 0xffffffffn);
  const tempRoot = mkdtempSync(join(tmpdir(), 'buzz-worker-supervision-'));
  let task;
  let killer;
  try {
    mkdirSync(join(tempRoot, 'bin'));
    for (const file of ['worker.mjs','lease.mjs','lease-config.mjs']) copyFileSync(join(dirname(new URL(import.meta.url).pathname), '..', file), join(tempRoot, file));
    const modules = join(tempRoot, 'node_modules');
    const sourceModules = join(dirname(new URL(import.meta.url).pathname), '..', 'node_modules');
    await import('node:fs/promises').then(({symlink}) => symlink(sourceModules, modules));
    const pidFile = join(tempRoot, 'children.json');
    const fakeAgent = `#!/bin/sh\nexec node -e 'const {spawn}=require("node:child_process");const fs=require("node:fs");process.on("SIGTERM",()=>{});const child=spawn(process.execPath,["-e","process.on(\\"SIGTERM\\",()=>{});setInterval(()=>{},1000)"]);fs.writeFileSync(process.env.TEST_CHILD_PIDS,JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000)'\n`;
    writeFileSync(join(tempRoot, 'bin', 'buzz-acp'), fakeAgent, {mode:0o755});
    const env = {...process.env, BUZZ_AGENT_DATABASE_CONFIG:JSON.stringify(config), BUZZ_ACP_AGENT_PUBKEY:pubkey,
      BUZZ_GRANT_EXPIRES_AT:new Date(Date.now()+90000).toISOString(), BUZZ_WORKSPACE:join(tempRoot, 'workspace'),
      HOME:join(tempRoot, 'home'), XDG_CONFIG_HOME:join(tempRoot, 'config'), XDG_DATA_HOME:join(tempRoot, 'data'), XDG_CACHE_HOME:join(tempRoot, 'cache'), TEST_CHILD_PIDS:pidFile};
    mkdirSync(env.BUZZ_WORKSPACE);
    task = spawn(process.execPath, [join(tempRoot, 'worker.mjs')], {env, stdio:['ignore','ignore','pipe']});
    let workerStderr = '';
    task.stderr.setEncoding('utf8').on('data', chunk => { workerStderr += chunk; });
    killer = new pg.Client(config);
    await killer.connect();
    let backendPid;
    const lockDeadline = Date.now()+10000;
    while (!backendPid && Date.now() < lockDeadline) {
      const {rows} = await killer.query(`SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted AND classid=$1::oid AND objid=$2::oid AND objsubid=1`, [classId,objectId]);
      backendPid = rows[0]?.pid;
      if (!backendPid) await new Promise(resolve => setTimeout(resolve,100));
    }
    assert.ok(backendPid, 'worker never acquired its session lock');
    const childDeadline = Date.now()+20000;
    while (!existsSync(pidFile) && Date.now() < childDeadline) await new Promise(resolve => setTimeout(resolve,100));
    assert.ok(existsSync(pidFile), `worker did not start its child group; stderr: ${workerStderr}`);
    const childPids = JSON.parse(readFileSync(pidFile, 'utf8'));
    await killer.query('SELECT pg_terminate_backend($1::int)', [backendPid]);
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('worker did not exit after lease loss')), 8000);
      task.once('exit', value => { clearTimeout(timeout); resolve(value); });
    });
    assert.notEqual(code, 0, 'worker must fail after losing its lock');
    for (const pid of childPids) {
      assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH', `child process ${pid} survived worker shutdown`);
    }
    const replacement = await acquireLease({connectionConfig:config, agentPubkey:pubkey});
    await replacement.release();
  } finally {
    if (task && task.exitCode === null) task.kill('SIGKILL');
    if (killer) await killer.end().catch(() => {});
    rmSync(tempRoot, {recursive:true, force:true});
  }
});
