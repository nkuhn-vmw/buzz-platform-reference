import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import https from 'node:https';
import { loadInstanceIdentity } from '../certs.mjs';
import { startJwksProxy } from '../proxy.mjs';
import { startJwksServer } from '../server.mjs';

const relayGuid = 'c2573f14-4293-45a2-9a86-42b171deb05c';
const identityGuid = 'c5d5327b-f043-46a5-962e-1d6c4a736d41';
const wrongGuid = '11111111-2222-4333-8444-555555555555';
const jwks = { keys: [{ kty: 'RSA', kid: 'pilot-key', use: 'sig' }] };
let directory;
let identities;

function openssl(args) {
  execFileSync('openssl', args, { stdio: 'ignore' });
}

function makeCa(name, subject, issuer) {
  const key = join(directory, `${name}.key`);
  const csr = join(directory, `${name}.csr`);
  const cert = join(directory, `${name}.crt`);
  const ext = join(directory, `${name}.ext`);
  writeFileSync(ext, 'basicConstraints=critical,CA:true,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', subject]);
  if (issuer) openssl(['x509', '-req', '-in', csr, '-CA', issuer.cert, '-CAkey', issuer.key, '-CAcreateserial', '-out', cert, '-days', '2', '-extfile', ext]);
  else openssl(['x509', '-req', '-in', csr, '-signkey', key, '-out', cert, '-days', '2', '-extfile', ext]);
  return { key, cert };
}

function makeLeaf(name, appGuid, issuer) {
  const key = join(directory, `${name}.key`);
  const csr = join(directory, `${name}.csr`);
  const cert = join(directory, `${name}.crt`);
  const chain = join(directory, `${name}-chain.pem`);
  const ext = join(directory, `${name}.ext`);
  writeFileSync(ext, 'basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth,clientAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=cf-instance/OU=app:${appGuid}+OU=space:pilot+OU=organization:pilot`]);
  openssl(['x509', '-req', '-in', csr, '-CA', issuer.cert, '-CAkey', issuer.key, '-CAcreateserial', '-out', cert, '-days', '2', '-extfile', ext]);
  writeFileSync(chain, `${readFileSync(cert, 'utf8')}\n${readFileSync(issuer.cert, 'utf8')}`);
  return () => loadInstanceIdentity({ certPath: chain, keyPath: key });
}

function requestHttps(url, identity) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      ca: identity?.ca,
      allowPartialTrustChain: true,
      cert: identity?.cert,
      key: identity?.key,
      rejectUnauthorized: true,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
  });
}

before(() => {
  directory = mkdtempSync(join(tmpdir(), 'buzz-cf-mtls-'));
  const root = makeCa('root', '/CN=Test Root', null);
  const intermediate = makeCa('intermediate', '/CN=Test Instance Identity Intermediate', root);
  const otherRoot = makeCa('other-root', '/CN=Untrusted Root', null);
  const serverIdentity = makeLeaf('identity', identityGuid, intermediate);
  const relayIdentity = makeLeaf('relay', relayGuid, intermediate);
  const wrongClientIdentity = makeLeaf('wrong-client', wrongGuid, intermediate);
  const wrongServerIdentity = makeLeaf('wrong-server', wrongGuid, intermediate);
  const untrustedIdentity = makeLeaf('untrusted-client', relayGuid, otherRoot);
  identities = { serverIdentity, relayIdentity, wrongClientIdentity, wrongServerIdentity, untrustedIdentity };
  const subject = identities.serverIdentity().leaf;
  assert.ok(subject.subject.includes(' + OU='));
  assert.deepEqual(new Set(subject.toLegacyObject().subject.OU), new Set([
    `app:${identityGuid}`, 'space:pilot', 'organization:pilot',
  ]));
});

after(() => rmSync(directory, { recursive: true, force: true }));

test('authenticates both CF app identities over TLS and serves only the fixed JWKS endpoint', async () => {
  const server = await startJwksServer({
    jwks,
    allowedAppGuid: relayGuid,
    port: 0,
    host: '127.0.0.1',
    identityProvider: identities.serverIdentity,
  });
  const address = server.address();
  const targetUrl = `https://localhost:${address.port}/.well-known/jwks.json`;
  const proxy = await startJwksProxy({
    targetUrl,
    expectedAppGuid: identityGuid,
    port: 0,
    identityProvider: identities.relayIdentity,
  });
  const wrongClientProxy = await startJwksProxy({
    targetUrl,
    expectedAppGuid: identityGuid,
    port: 0,
    identityProvider: identities.wrongClientIdentity,
  });
  const wrongServer = await startJwksServer({
    jwks,
    allowedAppGuid: relayGuid,
    port: 0,
    host: '127.0.0.1',
    identityProvider: identities.wrongServerIdentity,
  });
  const wrongServerProxy = await startJwksProxy({
    targetUrl: `https://localhost:${wrongServer.address().port}/.well-known/jwks.json`,
    expectedAppGuid: identityGuid,
    port: 0,
    identityProvider: identities.relayIdentity,
  });

  try {
    const good = await fetch(`http://127.0.0.1:${proxy.port}/.well-known/jwks.json`);
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), jwks);

    const ipv6 = await fetch(`http://[::1]:${proxy.port}/.well-known/jwks.json`);
    assert.equal(ipv6.status, 200);
    assert.deepEqual(await ipv6.json(), jwks);

    const wrongPeer = await fetch(`http://127.0.0.1:${wrongClientProxy.port}/.well-known/jwks.json`);
    assert.equal(wrongPeer.status, 502);
    const wrongTarget = await fetch(`http://127.0.0.1:${wrongServerProxy.port}/.well-known/jwks.json`);
    assert.equal(wrongTarget.status, 502);

    const notJwks = await fetch(`http://127.0.0.1:${proxy.port}/etc/passwd`);
    assert.equal(notJwks.status, 404);
    const wrongMethod = await fetch(`http://127.0.0.1:${proxy.port}/.well-known/jwks.json`, { method: 'POST' });
    assert.equal(wrongMethod.status, 405);

    const noCertificate = identities.serverIdentity();
    await assert.rejects(requestHttps(targetUrl, { ca: noCertificate.ca }));
    const untrusted = identities.untrustedIdentity();
    await assert.rejects(requestHttps(targetUrl, untrusted));
  } finally {
    await Promise.all([proxy.close(), wrongClientProxy.close(), wrongServerProxy.close()]);
    await Promise.all([closeServer(server), closeServer(wrongServer)]);
  }
});

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
