import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function verifiedDatabaseUrl(database, credentials, env) {
  if (env.BUZZ_DATABASE_REQUIRE_TLS !== undefined && !['true', 'false'].includes(env.BUZZ_DATABASE_REQUIRE_TLS)) throw new Error('BUZZ_DATABASE_REQUIRE_TLS must be true or false');
  if (env.BUZZ_DATABASE_REQUIRE_TLS !== 'true') return database;
  let ca = credentials.ca || credentials.ca_cert || credentials.ca_certificate;
  const path = env.CF_SYSTEM_CERT_PATH;
  if (!ca && path) {
    try {
      ca = statSync(path).isDirectory()
        ? readdirSync(path).filter(name => /\.(pem|crt|cer)$/i.test(name)).sort().map(name => readFileSync(join(path, name), 'utf8')).join('\n')
        : readFileSync(path, 'utf8');
    } catch { throw new Error('Unable to read PostgreSQL CA trust'); }
  }
  if (typeof ca !== 'string' || !ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) throw new Error('PostgreSQL CA trust is required for verified TLS');
  const directory = mkdtempSync(join(tmpdir(), 'buzz-postgres-ca-'));
  const caFile = join(directory, 'root.crt');
  writeFileSync(caFile, ca, { mode: 0o600, flag: 'wx' });
  const uri = new URL(database);
  // SQLx accepts hyphenated aliases; remove every supplied TLS option first.
  for (const key of [...uri.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('ssl')) uri.searchParams.delete(key);
  }
  uri.searchParams.set('sslmode', 'verify-full');
  uri.searchParams.set('sslrootcert', caFile);
  return uri.href;
}

export function relayEnvironment(env) {
  const bindings = Object.values(JSON.parse(env.VCAP_SERVICES || '{}')).flat();
  const credentials = (name) => {
    const found = bindings.filter((b) => b.name === name);
    if (found.length !== 1) throw new Error(`Exactly one ${name} service binding is required`);
    return found[0].credentials;
  };
  const db = credentials('buzz-db');
  const cache = credentials('buzz-cache');
  const objects = credentials('buzz-objects');
  const secrets = credentials('buzz-secrets');
  const database = db.uri || db.jdbcUrl?.replace(/^jdbc:/, '');
  if (!database || !/^postgres(ql)?:\/\//.test(database)) throw new Error('PostgreSQL URI missing');
  const redis = new URL(`redis://${cache.host}:${cache.port}`);
  redis.password = cache.password;
  const required = {
    DATABASE_URL: verifiedDatabaseUrl(database, db, env),
    REDIS_URL: redis.href,
    BUZZ_S3_ENDPOINT: objects.endpoint_url || objects.endpoint,
    BUZZ_S3_ACCESS_KEY: objects.access_key,
    BUZZ_S3_SECRET_KEY: objects.secret_key,
    BUZZ_S3_BUCKET: objects.bucket,
    BUZZ_S3_REGION: objects.region || 'us-east-1',
    BUZZ_RELAY_PRIVATE_KEY: secrets.BUZZ_RELAY_PRIVATE_KEY,
    BUZZ_GIT_HOOK_HMAC_SECRET: secrets.BUZZ_GIT_HOOK_HMAC_SECRET,
  };
  for (const [key, value] of Object.entries(required)) {
    if (typeof value !== 'string' || !value) throw new Error(`Missing bound configuration: ${key}`);
  }
  return {
    ...env, ...required,
    BUZZ_BIND_ADDR: `0.0.0.0:${env.PORT || 8080}`,
    BUZZ_HEALTH_PORT: '8081',
    BUZZ_METRICS_PORT: '9102',
    BUZZ_S3_ADDRESSING_STYLE: 'path',
    BUZZ_WEB_DIR: `${process.cwd()}/web`,
    BUZZ_ADMIN_WEB_DIR: `${process.cwd()}/admin-web`,
    BUZZ_GIT_REPOS_DIR: `${process.cwd()}/work/repos`,
    BUZZ_GIT_PACK_CACHE_PATH: `${process.cwd()}/work/pack-cache`,
    BUZZ_GIT_PACK_CACHE_MAX_BYTES: '268435456',
  };
}
