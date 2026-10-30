import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { verifyEvent } from 'nostr-tools';
export { allowedEmail, parseAllowedEmails } from './allowlist.mjs';

export function validateReturnTo(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    if (!value.startsWith('http://')) return false;
    const url = new URL(value);
    if (url.protocol !== 'http:' || url.username || url.password || url.hash) return false;
    const authority = value.slice('http://'.length).split(/[/?#]/, 1)[0];
    const loopback = authority.startsWith('127.0.0.1:') || authority.startsWith('[::1]:');
    const explicitPort = authority.match(/:(\d+)$/)?.[1];
    const port = Number(explicitPort);
    return loopback && explicitPort !== undefined && Number.isInteger(port) && port > 0 && port <= 65535;
  } catch {
    return false;
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function verifyNip98({ proof, method, url, body, expectedPubkey, now = Math.floor(Date.now() / 1000), verify = verifyEvent }) {
  try {
    if (!proof || proof.kind !== 27235 || typeof proof.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(proof.pubkey)) return false;
    if (proof.pubkey !== expectedPubkey || !Number.isSafeInteger(proof.created_at)) return false;
    if (proof.created_at < now - 60 || proof.created_at > now + 5) return false;
    if (!Array.isArray(proof.tags) || proof.content !== '' || typeof proof.sig !== 'string') return false;
    const tagged = (name) => proof.tags.filter((tag) => Array.isArray(tag) && tag[0] === name);
    const u = tagged('u');
    const methods = tagged('method');
    const payloads = tagged('payload');
    if (u.length !== 1 || u[0].length !== 2 || u[0][1] !== url) return false;
    if (methods.length !== 1 || methods[0].length !== 2 || methods[0][1] !== method.toUpperCase()) return false;
    const digest = sha256(body);
    if (payloads.length !== 1 || payloads[0].length !== 2 || payloads[0][1] !== digest) return false;
    return Boolean(await verify(proof));
  } catch {
    return false;
  }
}

export function parseNostrAuthorization(value) {
  if (typeof value !== 'string') return null;
  const match = /^Nostr ([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], 'base64');
    if (decoded.toString('base64') !== match[1]) return null;
    const proof = JSON.parse(decoded.toString('utf8'));
    return proof && typeof proof === 'object' && !Array.isArray(proof) ? proof : null;
  } catch {
    return null;
  }
}

export function canonicalRelayAudience(relayUrl, configuredRelays) {
  if (typeof relayUrl !== 'string' || !configuredRelays.has(relayUrl)) return null;
  try {
    const url = new URL(relayUrl);
    if (url.protocol !== 'wss:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port === '80') return null;
    if (relayUrl !== `wss://${url.host}` || url.hostname.endsWith('.')) return null;
    const ipHost = url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname;
    if (isIP(ipHost) === 0 && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(url.hostname)) return null;
    return `https://${url.host}`;
  } catch {
    return null;
  }
}
