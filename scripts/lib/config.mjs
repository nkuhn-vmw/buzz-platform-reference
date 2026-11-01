import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const slug = /^[a-z][a-z0-9-]{1,39}$/;
function origin(value, label) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error(`${label} must be an HTTPS origin`);
  return u.origin;
}
export function loadDeployment(file = process.env.BUZZ_DEPLOYMENT_CONFIG || resolve(root, '.state/deployment.json')) {
  const configPath = resolve(file);
  const c = JSON.parse(readFileSync(configPath, 'utf8'));
  if (c.databaseTls !== undefined && typeof c.databaseTls !== 'boolean') throw new Error('databaseTls must be a boolean');
  for (const field of ['org', 'space', 'stack', 'model', 'oidcIssuer', 'identityProvider']) {
    if (typeof c[field] !== 'string' || !c[field].trim() || /[\r\n\0]/.test(c[field])) throw new Error(`Missing or invalid ${field}`);
  }
  const api = origin(c.api, 'api');
  if (!slug.test(c.routePrefix)) throw new Error('routePrefix must be a lowercase DNS label (2–40 characters)');
  if (typeof c.domain !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(c.domain)) throw new Error('domain must be a DNS name');
  if (new URL(c.oidcIssuer).protocol !== 'https:') throw new Error('oidcIssuer must be HTTPS');
  if (!Array.isArray(c.allowedEmails) || !c.allowedEmails.length || c.allowedEmails.some(v => typeof v !== 'string' || !/^[^\s@,]+@[^\s@,]+$/.test(v))) throw new Error('allowedEmails must contain exact email addresses');
  if (!c.desktop || !slug.test(c.desktop.profile) || !/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w-]*){2,}$/.test(c.desktop.bundleId) || !/^[a-zA-Z0-9][a-zA-Z0-9 -]{1,59}$/.test(c.desktop.name)) throw new Error('desktop requires a safe name, bundleId, and isolated profile slug');
  for (const name of ['postgres','cache','objects','ai','sso','gateway','credentials','secrets']) {
    const s = c.services?.[name];
    if (!s || typeof s.offering !== 'string' || !s.offering || typeof s.plan !== 'string' || !s.plan) throw new Error(`services.${name} requires offering and plan`);
  }
  const stateDir = c.stateDir ? resolve(dirname(configPath), c.stateDir) : resolve(root, '.state');
  const credentialsDir = c.credentialsDir ? resolve(dirname(configPath), c.credentialsDir) : resolve(root, '.credentials');
  const cfHome = c.cfHome ? resolve(dirname(configPath), c.cfHome) : resolve(stateDir, 'cf-home');
  // These directories are operator-local and are never used as cf push paths.
  const identityOrigin = `https://${c.routePrefix}-identity.${c.domain}`;
  const relayOrigin = `https://${c.routePrefix}-relay.${c.domain}`;
  return {...c, api, configPath, stateDir, credentialsDir, cfHome, identityOrigin, relayOrigin, relayUrl:relayOrigin.replace(/^https:/,'wss:'), gatewayService:`${c.routePrefix}-gateway`, credentialStoreService:`${c.routePrefix}-credentials`, internalIdentity:`${c.routePrefix}-identity.apps.internal`, internalAgent:`${c.routePrefix}-agent.apps.internal`, internalMcp:`${c.routePrefix}-docs.apps.internal`};
}
