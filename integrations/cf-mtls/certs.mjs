import { createPrivateKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

const GUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function loadInstanceIdentity({ certPath = process.env.CF_INSTANCE_CERT, keyPath = process.env.CF_INSTANCE_KEY } = {}) {
  if (!certPath || !keyPath) throw new Error('CF instance identity is unavailable');
  const cert = readFileSync(certPath, 'utf8');
  const key = readFileSync(keyPath, 'utf8');
  const chain = cert.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (chain.length < 2) throw new Error('CF instance certificate chain is incomplete');
  const leaf = new X509Certificate(chain[0]);
  const intermediate = new X509Certificate(chain[1]);
  if (leaf.ca || !intermediate.ca || !leaf.checkIssued(intermediate)) {
    throw new Error('CF instance certificate chain is invalid');
  }
  if (!leaf.checkPrivateKey(createPrivateKey(key))) throw new Error('CF instance private key does not match certificate');
  return Object.freeze({ cert: chain.join('\n'), key, ca: chain[1], leaf });
}

export function assertAppGuid(certificate, appGuid) {
  if (!GUID.test(appGuid)) throw new Error('Invalid expected CF app GUID');
  const subjectOus = certificate.toLegacyObject().subject?.OU;
  const ous = (Array.isArray(subjectOus) ? subjectOus : [subjectOus])
    .filter((value) => typeof value === 'string');
  const appOus = ous.filter((value) => value.startsWith('app:'));
  if (appOus.length !== 1 || appOus[0] !== `app:${appGuid}`) {
    throw new Error('Peer CF app identity mismatch');
  }
}

export function validateAppGuid(appGuid) {
  if (!GUID.test(appGuid)) throw new Error('Invalid expected CF app GUID');
}
