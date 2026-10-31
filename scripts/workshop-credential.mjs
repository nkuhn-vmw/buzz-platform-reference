// Manage only the caller's disposable native-workshop credential.
import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const [action, configPath] = process.argv.slice(2);
const resource = 'buzz-workshop-receipt-mcp';
const fail = message => { throw new Error(message); };
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
function httpsOrigin(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) fail('Expected an HTTPS origin');
  return u.origin;
}
async function main() {
  if (!['inspect', 'save', 'delete'].includes(action) || !configPath || process.argv.length !== 4) fail('Usage: node scripts/workshop-credential.mjs inspect|save|delete PRIVATE_CONFIG.json');
  const c = readJson(configPath);
  const api = httpsOrigin(c.api), storeOrigin = httpsOrigin(c.storeOrigin);
  if (!isAbsolute(c.cfHome ?? '') || !c.org || !c.space || !/^[^\s@]+@[^\s@]+$/.test(c.email ?? '') || !/^[a-f0-9-]{36}$/.test(c.storeId ?? '')) fail('Incomplete participant configuration');
  const cf = readJson(join(c.cfHome, '.cf/config.json'));
  if (cf.Target !== api || cf.OrganizationFields?.Name !== c.org || cf.SpaceFields?.Name !== c.space) fail('CF target mismatch; sign into the intended isolated CF_HOME');
  const token = String(cf.AccessToken ?? '').replace(/^bearer\s+/i, '');
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); }
  catch { fail('No usable CF SSO session; sign in again'); }
  if (claims.email !== c.email || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) fail('Wrong participant or expired CF session; sign in as the configured user');
  // The claim check prevents accidental use of another local account. The CF
  // and Store servers validate the token cryptographically on every request.
  async function request(url, method = 'GET', body, expected = 200) {
    const r = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: {
      authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (r.status !== expected) { await r.body?.cancel(); fail(`Management request returned HTTP ${r.status}; expected ${expected}`); }
    if (expected === 204) return null;
    return r.json();
  }
  const service = await request(`${api}/v3/service_instances/${c.storeId}`);
  if (service.guid !== c.storeId || service.relationships?.space?.data?.guid !== cf.SpaceFields.GUID) fail('Store is outside the configured space');
  const dashboard = new URL(service.dashboard_url);
  if (dashboard.origin !== storeOrigin || dashboard.username || dashboard.password || dashboard.pathname !== `/stores/${c.storeId}`) fail('Configured Store origin does not match its CF service dashboard');
  const base = `${storeOrigin}/api/stores/${c.storeId}`;
  async function inspect() {
    const data = await request(`${base}/resources`);
    const entry = data.resources?.find(x => x.name === resource);
    if (!entry || entry.storeConfigured) fail('Missing workshop resource or unexpected shared fallback');
    return entry;
  }
  let entry = await inspect();
  if (action === 'save') {
    if (entry.userConfigured) fail('Refusing to overwrite an existing user credential');
    if (!isAbsolute(c.tokenFile ?? '')) fail('tokenFile must be an absolute private file path');
    const stat = lstatSync(c.tokenFile);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail('Token file must be a regular file readable only by its owner (mode 600)');
    const fixture = readJson(c.tokenFile);
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(fixture.token ?? '')) fail('Invalid synthetic token file');
    await request(`${base}/credentials`, 'POST', { resourceName: resource,
      headers: { Authorization: `Bearer ${fixture.token}` }, scope: 'user',
      description: 'Disposable workshop credential',
    }, 201);
  }
  if (action === 'delete') {
    if (!entry.userConfigured || entry.credentialType !== 'static') fail('No disposable static user entry to delete');
    await request(`${base}/credentials?resourceName=${resource}&scope=user`, 'DELETE', undefined, 204);
  }
  if (action !== 'inspect') entry = await inspect();
  console.log(JSON.stringify({ action, userConfigured: entry.userConfigured,
    storeConfigured: entry.storeConfigured, credentialType: entry.credentialType ?? null,
    accessCount: entry.accessCount ?? 0 }));
}
main().catch(error => {
  // No server bodies, CF configuration, request headers, or token values.
  const safe = /^(Usage:|Expected an HTTPS|Incomplete participant|CF target|No usable CF|Wrong participant|Management request returned HTTP|Store is outside|Configured Store origin|Missing workshop resource|Refusing to overwrite|tokenFile must|Token file must|Invalid synthetic token|No disposable static)/;
  console.error(safe.test(error.message) ? error.message : 'Workshop credential operation failed; check the private configuration and connection.');
  process.exitCode = 1;
});
