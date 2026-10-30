import http from 'node:http';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { assertAppGuid, loadInstanceIdentity, validateAppGuid } from './certs.mjs';

const JWKS_PATH = '/.well-known/jwks.json';
const MAX_JWKS_BYTES = 512 * 1024;

export async function startJwksProxy({ targetUrl, expectedAppGuid, port = 8082, timeoutMs = 10000, identityProvider = loadInstanceIdentity }) {
  validateAppGuid(expectedAppGuid);
  const target = new URL(targetUrl);
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash || target.pathname !== JWKS_PATH) {
    throw new Error('JWKS target must be a fixed HTTPS endpoint');
  }
  const handler = async (request, response) => {
    if (request.url !== JWKS_PATH) return response.writeHead(404).end();
    if (request.method !== 'GET') return response.writeHead(405).end();
    try {
      const body = await fetchJwks(target, expectedAppGuid, identityProvider, timeoutMs);
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      }).end(body);
    } catch {
      response.writeHead(502, { 'cache-control': 'no-store' }).end('JWKS unavailable');
    }
  };
  const ipv4 = http.createServer(handler);
  const addresses = await lookup('localhost', { all: true });
  if (!addresses.length || addresses.some(({ address }) => !['127.0.0.1', '::1'].includes(address))) {
    throw new Error('localhost must resolve only to loopback addresses');
  }
  await listen(ipv4, port, '127.0.0.1');
  const boundPort = ipv4.address().port;
  const servers = [ipv4];
  if (addresses.some(({ family }) => family === 6)) {
    const ipv6 = http.createServer(handler);
    try {
      await listen(ipv6, boundPort, '::1');
      servers.push(ipv6);
    } catch (error) {
      await close(ipv4);
      throw error;
    }
  }
  return { port: boundPort, servers, close: () => Promise.all(servers.map(close)) };
}

async function fetchJwks(target, expectedAppGuid, identityProvider, timeoutMs) {
  const identity = identityProvider();
  const agent = new https.Agent({
    ca: identity.ca, allowPartialTrustChain: true,
    cert: identity.cert, key: identity.key, rejectUnauthorized: true,
    maxCachedSessions: 0, keepAlive: false,
    checkServerIdentity: (_hostname, peer) => {
      try { assertAppGuid(new X509Certificate(peer.raw), expectedAppGuid); } catch { return new Error('CF service identity mismatch'); }
    },
  });
  try {
    const body = await new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const request = https.get(target, { agent, headers: { accept: 'application/json' } }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish(reject, new Error('JWKS service rejected the request'));
          return;
        }
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] ?? '') ||
            Number(response.headers['content-length'] ?? 0) > MAX_JWKS_BYTES) {
          const error = new Error('Invalid JWKS response');
          finish(reject, error);
          response.destroy(error);
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_JWKS_BYTES) {
            const error = new Error('JWKS response too large');
            finish(reject, error);
            response.destroy(error);
          }
          else chunks.push(chunk);
        });
        response.on('end', () => finish(resolve, Buffer.concat(chunks)));
        response.on('error', (error) => finish(reject, error));
      });
      timer = setTimeout(() => request.destroy(new Error('JWKS request timed out')), timeoutMs);
      request.on('error', (error) => finish(reject, error));
    });
    const parsed = JSON.parse(body.toString('utf8'));
    if (!parsed || !Array.isArray(parsed.keys)) throw new Error('Invalid JWKS document');
    return body;
  } finally {
    agent.destroy();
  }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
