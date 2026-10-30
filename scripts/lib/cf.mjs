import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export function cfHomeFor(deployment) {
  const home = deployment.cfHome ?? resolve(deployment.stateDir, 'cf-home');
  if (typeof home !== 'string' || !isAbsolute(home)) throw new Error('cfHome must be an absolute path');
  return home;
}

export function verifyLocalTarget(deployment, cfHome = cfHomeFor(deployment)) {
  const configPath = resolve(cfHome, '.cf', 'config.json');
  let saved;
  try { saved = JSON.parse(readFileSync(configPath, 'utf8')); }
  catch { throw new Error(`CF target is not configured in isolated CF_HOME (${configPath}); run scripts/cf-login.sh first`); }
  const api = saved.Target ?? saved.target;
  const organization = saved.OrganizationFields ?? saved.organization ?? {};
  const spaceFields = saved.SpaceFields ?? saved.space ?? {};
  const org = organization.Name ?? organization.name;
  const space = spaceFields.Name ?? spaceFields.name;
  let apiMatches = false;
  if (typeof api === 'string') {
    try {
      const parsed = new URL(api);
      apiMatches = parsed.origin === deployment.api && parsed.pathname === '/' && !parsed.search && !parsed.hash && !parsed.username && !parsed.password;
    } catch { /* mismatched local CLI context */ }
  }
  if (!apiMatches || org !== deployment.org || space !== deployment.space) {
    throw new Error('Isolated CF_HOME target does not match configured API, org, and space; run scripts/cf-login.sh');
  }
  const organizationGuid = organization.GUID ?? organization.guid;
  const spaceGuid = spaceFields.GUID ?? spaceFields.guid;
  if (typeof organizationGuid !== 'string' || !organizationGuid || typeof spaceGuid !== 'string' || !spaceGuid) {
    throw new Error('Isolated CF_HOME is missing the configured org or space GUID; run scripts/cf-login.sh');
  }
  return { cfHome, configPath, organizationGuid, spaceGuid };
}

const restricted = new Set(['api', 'auth', 'login', 'target', 'logout']);
export function restrictedCFCommand(args) {
  let commandIndex = 0;
  let contextOverride = false;
  const globalValueFlags = new Set(['-a', '--api', '-o', '--org', '-s', '--space']);
  while (commandIndex < args.length) {
    const arg = args[commandIndex];
    if (globalValueFlags.has(arg)) {
      contextOverride = true;
      commandIndex += 2;
    } else if (arg.startsWith('-')) commandIndex += 1;
    else break;
  }
  const command = args[commandIndex]?.toLowerCase();
  if (restricted.has(command)) return true;
  return contextOverride || args.slice(0, commandIndex).includes('--config');
}

export function runCF(args, { deployment, cwd = process.cwd(), capture = false, stdio } = {}) {
  const { cfHome } = verifyLocalTarget(deployment);
  if (!Array.isArray(args) || args.length === 0 || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('A valid cf command is required');
  const result = spawnSync('cf', args, {
    cwd,
    env: { ...process.env, CF_HOME: cfHome },
    encoding: capture ? 'utf8' : undefined,
    maxBuffer: 16 * 1024 * 1024,
    stdio: capture ? 'pipe' : (stdio ?? 'inherit'),
  });
  if (result.error) throw new Error(`Could not run the cf CLI: ${result.error.code ?? 'launch failed'}`);
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function loginArguments(deployment) {
  return [deployment.api, deployment.org, deployment.space, cfHomeFor(deployment)];
}

export function verifyTarget(deployment) {
  verifyLocalTarget(deployment);
}

export function cf(deployment, args, { capture = false } = {}) {
  const result = runCF(args, { deployment, capture });
  if (result.status !== 0) throw new Error(`cf ${args[0]} failed (exit ${result.status})`);
  return capture ? result.stdout : undefined;
}
