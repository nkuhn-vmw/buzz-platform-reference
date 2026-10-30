import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const LEASE_HEARTBEAT_MS = 3000;
export const LEASE_FAILURE_TIMEOUT_MS = 10000;
export const LEASE_KILL_GRACE_MS = 2000;
export const LEASE_TAKEOVER_MARGIN_MS = 2500;
export const LEASE_TAKEOVER_GRACE_MS = LEASE_HEARTBEAT_MS + LEASE_FAILURE_TIMEOUT_MS + LEASE_KILL_GRACE_MS + LEASE_TAKEOVER_MARGIN_MS;

export function advisoryKey(agentPubkeyHex) {
  if (!/^[0-9a-f]{64}$/.test(agentPubkeyHex)) throw new Error('Invalid agent public key');
  // A stable signed 64-bit key derived from the public key. PostgreSQL's
  // advisory lock namespace is database-local, so all tasks must use this DB.
  const digest = createHash('sha256').update(Buffer.from(agentPubkeyHex, 'hex')).digest();
  return digest.readBigInt64BE(0).toString();
}

export function validateGrant(owner, expiresAt, now = Date.now()) {
  if (typeof owner !== 'string' || !/^[0-9a-f]{64}$/.test(owner)) throw new Error('Invalid owner key');
  if (typeof expiresAt !== 'string' || !expiresAt) throw new Error('Missing grant expiration');
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline) || deadline <= now) throw new Error('Owner grant expired; renew through SSO');
  return deadline;
}

export function validateIdentityServiceName(name = 'buzz-agent-identity') {
  if (typeof name !== 'string' || !/^buzz-agent-identity(?:-[a-z0-9][a-z0-9_-]{0,31})?$/.test(name)) {
    throw new Error('Invalid BUZZ_IDENTITY_SERVICE name');
  }
  return name;
}
export function databaseConfig(credentials, caPath = process.env.CF_SYSTEM_CERT_PATH) {
  if (!credentials || typeof credentials !== 'object') throw new Error('Invalid buzz-agent-db binding');
  const uriText = credentials.uri || credentials.jdbcUrl?.replace(/^jdbc:/, '') || credentials.url;
  let uri;
  if (uriText) {
    try { uri = new URL(uriText); } catch { throw new Error('Invalid PostgreSQL database uri'); }
    if (!['postgres:', 'postgresql:'].includes(uri.protocol)) throw new Error('Database URI must use PostgreSQL');
    const sslmode = uri.searchParams.get('sslmode');
    if (sslmode && !['verify-full','verify-ca'].includes(sslmode)) throw new Error('Database URI contains an unsafe sslmode');
  }
  const host = credentials.primary_host || (Array.isArray(credentials.hosts) ? credentials.hosts[0] : null) || credentials.host || uri?.hostname;
  const database = credentials.db || credentials.dbname || credentials.database || uri?.pathname.replace(/^\//, '');
  const user = credentials.user || credentials.username || (uri?.username ? decodeURIComponent(uri.username) : undefined);
  const password = credentials.password ?? (uri?.password ? decodeURIComponent(uri.password) : undefined);
  const port = Number(credentials.port || uri?.port || 5432);
  if (typeof host !== 'string' || !host || !database || !user || typeof password !== 'string' || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('buzz-agent-db must provide direct host, database, user, password, and port credentials');
  }
  let ca = credentials.ca || credentials.ca_cert || credentials.ca_certificate;
  if (!ca && caPath) {
    try {
      if (statSync(caPath).isDirectory()) {
        ca = readdirSync(caPath).filter(name => /\.(?:pem|crt|cer)$/i.test(name)).sort().map(name => readFileSync(`${caPath}/${name}`, 'utf8')).join('\n');
      } else ca = readFileSync(caPath, 'utf8');
    } catch { throw new Error('Unable to read PostgreSQL CA trust from CF_SYSTEM_CERT_PATH'); }
  }
  if (typeof ca !== 'string' || !ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    throw new Error('PostgreSQL CA certificate required in binding or CF_SYSTEM_CERT_PATH');
  }
  const config = { host, port, database, user, password, ssl: {rejectUnauthorized:true, ca} };
  return config;
}
