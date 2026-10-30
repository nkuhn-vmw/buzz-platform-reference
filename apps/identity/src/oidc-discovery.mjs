import { ClientSecretPost, Configuration } from 'openid-client';

function trustedEndpoint(value, origin) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === origin && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export async function discoverBoundOidc(config, fetchImpl = fetch) {
  const authDomain = new URL(config.authDomain);
  if (authDomain.protocol !== 'https:' || authDomain.username || authDomain.password || authDomain.search || authDomain.hash) {
    throw new Error('OIDC discovery contract mismatch');
  }
  const discoveryUrl = new URL('.well-known/openid-configuration', `${authDomain.href.replace(/\/$/, '')}/`);
  const response = await fetchImpl(discoveryUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const error = new Error('OIDC discovery request failed');
    error.code = `HTTP_${response.status}`;
    throw error;
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 128 * 1024) throw new Error('OIDC discovery contract mismatch');
  const rawMetadata = await response.text();
  if (Buffer.byteLength(rawMetadata) > 128 * 1024) throw new Error('OIDC discovery contract mismatch');
  const metadata = JSON.parse(rawMetadata);
  const issuer = typeof metadata.issuer === 'string' ? new URL(metadata.issuer) : null;
  const endpoints = [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri];
  if (metadata.userinfo_endpoint) endpoints.push(metadata.userinfo_endpoint);
  if (!issuer || issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash ||
      metadata.issuer !== config.oidcIssuer || !endpoints.every((endpoint) => trustedEndpoint(endpoint, authDomain.origin))) {
    throw new Error('OIDC discovery contract mismatch');
  }
  return new Configuration(metadata, config.clientId, config.clientSecret, ClientSecretPost());
}
