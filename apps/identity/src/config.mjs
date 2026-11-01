import { createPrivateKey, createPublicKey } from 'node:crypto';
import { calculateJwkThumbprint } from 'jose';
import { parseAllowedEmails } from './allowlist.mjs';
import { readFileSync, readdirSync, statSync } from 'node:fs';

function postgresTls(credentials, caPath) {
  let ca = credentials.ca || credentials.ca_cert || credentials.ca_certificate;
  if (!ca && caPath) {
    try {
      ca = statSync(caPath).isDirectory()
        ? readdirSync(caPath).filter(name => /\.(pem|crt|cer)$/i.test(name)).sort().map(name => readFileSync(`${caPath}/${name}`, 'utf8')).join('\n')
        : readFileSync(caPath, 'utf8');
    } catch { throw new Error('Unable to read PostgreSQL CA trust'); }
  }
  if (typeof ca !== 'string' || !ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) throw new Error('PostgreSQL CA trust is required for verified TLS');
  return { ca, rejectUnauthorized: true };
}

function validObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function bindingsFrom(services) {
  if (!validObject(services)) throw new Error('VCAP_SERVICES is required');
  const result = [];
  for (const [label, list] of Object.entries(services)) {
    if (!Array.isArray(list)) throw new Error('Invalid service binding shape');
    for (const item of list) {
      if (!validObject(item) || !validObject(item.credentials)) throw new Error('Invalid service binding credentials');
      result.push({ label, item });
    }
  }
  return result;
}

function firstPostgresBinding(bindings, env) {
  const found = bindings.find(({ item }) => item.name === 'buzz-identity-db');
  if (!found) throw new Error('buzz-identity-db PostgreSQL service binding is required');
  const c = found.item.credentials;
  if (env.BUZZ_DATABASE_REQUIRE_TLS !== undefined && !['true', 'false'].includes(env.BUZZ_DATABASE_REQUIRE_TLS)) throw new Error('BUZZ_DATABASE_REQUIRE_TLS must be true or false');
  const ssl = env.BUZZ_DATABASE_REQUIRE_TLS === 'true' ? postgresTls(c, env.CF_SYSTEM_CERT_PATH) : undefined;
  const uri = c.uri ?? c.jdbcUrl;
  if (typeof uri === 'string' && (uri.startsWith('postgres://') || uri.startsWith('postgresql://') || uri.startsWith('jdbc:postgresql://'))) {
    const connectionString = uri.startsWith('jdbc:') ? uri.slice('jdbc:'.length) : uri;
    if (!ssl) return { connectionString };
    const parsed = new URL(connectionString);
    // node-postgres replaces the explicit ssl object if these URL options
    // remain. Preserve other connection parameters, but enforce our trust.
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('ssl') || key === 'uselibpqcompat') parsed.searchParams.delete(key);
    }
    return { connectionString: parsed.href, ssl };
  }
  const firstHost = Array.isArray(c.hosts) ? (typeof c.hosts[0] === 'string' ? c.hosts[0] : c.hosts[0]?.host) : undefined;
  const config = {
    host: c.host ?? c.primary_host ?? c.hostname ?? firstHost,
    port: Number(c.port ?? 5432),
    database: c.dbname ?? c.database ?? c.db,
    user: c.username ?? c.user,
    password: c.password,
  };
  if (ssl) config.ssl = ssl;
  else if (c.ca) config.ssl = { ca: c.ca, rejectUnauthorized: true };
  else if (c.ssl === true || c.sslmode === 'require') config.ssl = { rejectUnauthorized: true };
  if (!config.host || !config.database || !config.user || typeof config.password !== 'string' || !Number.isFinite(config.port)) throw new Error('Invalid PostgreSQL credentials');
  return config;
}

function firstIdentityBinding(bindings) {
  const found = bindings.find(({ item }) => item.name === 'buzz-sso');
  if (!found) throw new Error('buzz-sso p-identity service binding is required');
  const isIdentity = found.label === 'p-identity' || found.item.label === 'p-identity' || (found.item.tags ?? []).includes('sso');
  if (!isIdentity) throw new Error('Invalid buzz-sso p-identity binding');
  const c = found.item.credentials;
  const authDomain = c.auth_domain ?? c.issuer ?? c.uaa_url;
  if (typeof authDomain !== 'string' || !authDomain.startsWith('https://') || !c.client_id || !c.client_secret) throw new Error('Invalid p-identity binding');
  return { authDomain: authDomain.replace(/\/+$/, ''), clientId: c.client_id, clientSecret: c.client_secret };
}

export async function loadConfig(env = process.env) {
  const allowedEmails = parseAllowedEmails(env.ALLOWED_EMAILS_JSON);
  const publicBase = new URL(env.PUBLIC_BASE_URL ?? '');
  if (publicBase.protocol !== 'https:' || publicBase.pathname !== '/' || publicBase.search || publicBase.hash) throw new Error('PUBLIC_BASE_URL must be an HTTPS origin');
  const bindings = bindingsFrom(JSON.parse(env.VCAP_SERVICES ?? 'null'));
  const signingBinding = bindings.find(({ item }) => item.name === 'buzz-identity-secrets' && (item.credentials.NIP_FI_SIGNING_KEY || item.credentials.nip_fi_signing_key));
  const signingKeyRaw = env.NIP_FI_SIGNING_KEY ?? signingBinding?.item.credentials.NIP_FI_SIGNING_KEY ?? signingBinding?.item.credentials.nip_fi_signing_key;
  if (!signingKeyRaw) throw new Error('NIP_FI_SIGNING_KEY is required from env or the buzz-identity-secrets binding');
  const signingText = typeof signingKeyRaw === 'string' ? signingKeyRaw : JSON.stringify(signingKeyRaw);
  let signingJwk;
  let privateKey;
  if (signingText.trimStart().startsWith('{')) {
    signingJwk = JSON.parse(signingText);
    const keyMaterial = { ...signingJwk };
    delete keyMaterial.alg;
    delete keyMaterial.kid;
    delete keyMaterial.use;
    delete keyMaterial.key_ops;
    delete keyMaterial.ext;
    privateKey = createPrivateKey({ key: keyMaterial, format: 'jwk' });
  } else {
    privateKey = createPrivateKey(signingText.replace(/\\n/g, '\n'));
    signingJwk = privateKey.export({ format: 'jwk' });
  }
  const publicKey = createPublicKey(privateKey);
  const publicJwk = publicKey.export({ format: 'jwk' });
  const alg = privateKey.asymmetricKeyType === 'rsa' ? 'RS256' : privateKey.asymmetricKeyType === 'ec' && privateKey.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? 'ES256' : null;
  if (!alg) throw new Error('Signing key must be RSA or P-256 EC');
  const kid = signingJwk.kid ?? await calculateJwkThumbprint(publicJwk);
  const oidc = firstIdentityBinding(bindings);
  const pg = firstPostgresBinding(bindings, env);
  const relayValues = (env.RELAY_URLS ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  if (!relayValues.length) throw new Error('RELAY_URLS is required');
  const fiIssuer = env.NIP_FI_ISSUER ?? publicBase.origin;
  if (new URL(fiIssuer).protocol !== 'https:') throw new Error('NIP_FI_ISSUER must be HTTPS');
  return {
    publicBase: publicBase.origin,
    redirectUri: `${publicBase.origin}/oauth2/callback`,
    issuer: fiIssuer,
    oidcIssuer: (env.OIDC_ISSUER ?? env.OIDC_AUTH_DOMAIN ?? oidc.authDomain).replace(/\/+$/, ''),
    authDomain: env.OIDC_AUTH_DOMAIN ? env.OIDC_AUTH_DOMAIN.replace(/\/+$/, '') : oidc.authDomain,
    clientId: env.OIDC_CLIENT_ID ?? oidc.clientId,
    clientSecret: env.OIDC_CLIENT_SECRET ?? oidc.clientSecret,
    relays: new Set(relayValues),
    sessionTtlSeconds: Number.parseInt(env.SESSION_TTL_SECONDS ?? '28800', 10),
    handoffTtlSeconds: 180,
    privateKey,
    signingJwk,
    publicJwk: { ...publicJwk, alg, use: 'sig', kid },
    alg,
    kid,
    pg,
    allowedEmails,
  };
}
