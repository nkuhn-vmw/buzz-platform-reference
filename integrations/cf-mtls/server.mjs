import { constants } from 'node:crypto';
import https from 'node:https';
import tls from 'node:tls';
import { assertAppGuid, loadInstanceIdentity, validateAppGuid } from './certs.mjs';

const JWKS_PATH = '/.well-known/jwks.json';
const MAX_JWKS_BYTES = 512 * 1024;

export async function startJwksServer({ jwks, allowedAppGuid, port = 8443, host = '0.0.0.0', identityProvider = loadInstanceIdentity }) {
  validateAppGuid(allowedAppGuid);
  if (!jwks || !Array.isArray(jwks.keys)) throw new Error('A JWKS document is required');
  const body = Buffer.from(JSON.stringify(jwks));
  if (body.length > MAX_JWKS_BYTES) throw new Error('JWKS document exceeds size limit');
  const initial = identityProvider();
  const secureOptions = constants.SSL_OP_NO_TICKET;
  const contextFor = (identity) => tls.createSecureContext({
    cert: identity.cert, key: identity.key, ca: identity.ca,
    allowPartialTrustChain: true, secureOptions,
  });
  const server = https.createServer({
    cert: initial.cert, key: initial.key, ca: initial.ca,
    allowPartialTrustChain: true, requestCert: true, rejectUnauthorized: true,
    minVersion: 'TLSv1.2', secureOptions, sessionTimeout: 1, handshakeTimeout: 5000,
    SNICallback: (_servername, callback) => {
      try { callback(null, contextFor(identityProvider())); } catch (error) { callback(error); }
    },
  }, (request, response) => {
    if (request.method !== 'GET') return response.writeHead(405).end();
    if (request.url !== JWKS_PATH) return response.writeHead(404).end();
    try {
      if (!request.socket.authorized) throw new Error('Unauthenticated peer');
      const peer = request.socket.getPeerX509Certificate();
      if (!peer) throw new Error('Missing peer certificate');
      assertAppGuid(peer, allowedAppGuid);
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      }).end(body);
    } catch {
      response.writeHead(403).end();
    }
  });
  server.on('newSession', (_id, _data, callback) => callback());
  server.on('resumeSession', (_id, callback) => callback(null, null));
  await listen(server, port, host);
  return server;
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
