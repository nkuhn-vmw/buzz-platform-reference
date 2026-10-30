#!/usr/bin/env node
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDeployment } from './lib/config.mjs';
import { runCF, verifyLocalTarget } from './lib/cf.mjs';

const MAX_WAIT_MS = 15 * 60 * 1000;
const POLL_MS = 15_000;
export function serviceDefinitions(deployment) {
  return [
  ['postgres', 'buzz-db'], ['postgres', 'buzz-identity-db'], ['postgres', 'buzz-agent-db'],
  ['cache', 'buzz-cache'], ['objects', 'buzz-objects'], ['ai', 'buzz-ai'], ['sso', 'buzz-sso'],
  ['gateway', `${deployment.routePrefix}-gateway`], ['credentials', `${deployment.routePrefix}-credentials`],
  ['secrets', 'buzz-secrets'], ['secrets', 'buzz-identity-secrets'], ['secrets', 'buzz-mcp-secret'],
  ['secrets', 'buzz-agent-identity'], ['secrets', 'buzz-docs-service-access'],
  ].map(([serviceKey, name]) => ({ serviceKey, name }));
}
const parameterized = new Set(['buzz-secrets', 'buzz-identity-secrets', 'buzz-mcp-secret']);

export function parseArgs(args) {
  let apply = false;
  let wait = false;
  let plan = false;
  for (const arg of args) {
    if (arg === '--apply' && !apply) apply = true;
    else if (arg === '--plan' && !plan) plan = true;
    else if (arg === '--wait' && !wait) wait = true;
    else throw new Error('Usage: node scripts/provision.mjs [--plan | --apply] [--wait]');
  }
  if (apply && plan) throw new Error('--plan and --apply cannot be combined');
  if (wait && !apply) throw new Error('--wait requires --apply');
  return { apply, wait };
}
function cfJson(args, deployment) {
  const result = runCF(args, { deployment, capture: true });
  if (result.status !== 0) throw new Error(`cf ${args[0]} failed (exit ${result.status})`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`cf ${args[0]} returned invalid JSON`); }
}
export function serviceInstancesPath(names, spaceGuid) {
  const query = new URLSearchParams({ names: names.join(','), space_guids: spaceGuid, per_page: '100' });
  return `/v3/service_instances?${query}`;
}
export function selectServiceInstances(resources, names, spaceGuid) {
  const byName = new Map();
  for (const item of resources) {
    if (typeof item.name !== 'string' || !names.includes(item.name)) continue;
    const itemSpaceGuid = item.relationships?.space?.data?.guid;
    if (typeof itemSpaceGuid !== 'string' || !itemSpaceGuid) throw new Error(`Cannot verify CF space for service instance ${item.name}`);
    if (itemSpaceGuid !== spaceGuid) continue;
    if (byName.has(item.name)) throw new Error(`Multiple service instances named ${item.name} exist in the configured CF space`);
    byName.set(item.name, item);
  }
  return byName;
}
function verifiedSpace(deployment) {
  const target = verifyLocalTarget(deployment);
  const organization = cfJson(['curl', `/v3/organizations/${encodeURIComponent(target.organizationGuid)}`], deployment);
  const space = cfJson(['curl', `/v3/spaces/${encodeURIComponent(target.spaceGuid)}`], deployment);
  if (organization.guid !== target.organizationGuid || organization.name !== deployment.org ||
      space.guid !== target.spaceGuid || space.name !== deployment.space ||
      space.relationships?.organization?.data?.guid !== target.organizationGuid) {
    throw new Error('CF API org or space identity does not match the verified isolated target');
  }
  return { organizationGuid: target.organizationGuid, spaceGuid: target.spaceGuid };
}
function listInstances(names, deployment, spaceGuid) {
  const result = cfJson(['curl', serviceInstancesPath(names, spaceGuid)], deployment);
  if (!Array.isArray(result.resources)) throw new Error('Could not read service instance inventory from the configured CF space');
  return selectServiceInstances(result.resources, names, spaceGuid);
}
function getOfferingPlan(instance, deployment, cache) {
  const planGuid = instance.relationships?.service_plan?.data?.guid;
  if (!planGuid) return null;
  if (cache.has(planGuid)) return cache.get(planGuid);
  const plan = cfJson(['curl', `/v3/service_plans/${encodeURIComponent(planGuid)}`], deployment);
  const offeringGuid = plan.relationships?.service_offering?.data?.guid;
  if (!offeringGuid) { cache.set(planGuid, null); return null; }
  const offering = cfJson(['curl', `/v3/service_offerings/${encodeURIComponent(offeringGuid)}`], deployment);
  const result = { plan: plan.name, offering: offering.name };
  cache.set(planGuid, result);
  return result;
}
function snapshot(deployment) {
  const { spaceGuid } = verifiedSpace(deployment);
  const definitions = serviceDefinitions(deployment);
  const instances = listInstances(definitions.map(({ name }) => name), deployment, spaceGuid);
  const planCache = new Map();
  return definitions.map((definition) => {
    const existing = instances.get(definition.name);
    const expected = deployment.services[definition.serviceKey];
    if (!existing) return { ...definition, expected, existing: null, state: 'missing', matches: true };
    const actual = getOfferingPlan(existing, deployment, planCache);
    const state = existing.last_operation?.state ?? existing.state ?? 'unknown';
    const matches = actual?.offering === expected.offering && actual?.plan === expected.plan;
    return { ...definition, expected, existing, actual, state, matches };
  });
}
function renderPlan(services, deployment) {
  console.log(`CF target: ${deployment.api} / ${deployment.org} / ${deployment.space}`);
  console.log('Service                         Offering / plan                    State');
  for (const item of services) {
    const expected = `${item.expected.offering} / ${item.expected.plan}`;
    const state = !item.existing ? 'missing' : item.matches ? `present (${item.state})` : `MISMATCH (${item.actual?.offering ?? 'unknown'} / ${item.actual?.plan ?? 'unknown'})`;
    console.log(`${item.name.padEnd(31)} ${expected.padEnd(34)} ${state}`);
  }
}
function readOrCreateParameters(name, deployment) {
  const dir = join(deployment.credentialsDir, 'service-parameters');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = join(dir, `${name}.json`);
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Saved service parameters for ${name} are invalid JSON`);
    if (name === 'buzz-secrets') parsed = {
      BUZZ_RELAY_PRIVATE_KEY: randomBytes(32).toString('hex'),
      BUZZ_GIT_HOOK_HMAC_SECRET: randomBytes(32).toString('hex'),
    };
    else if (name === 'buzz-identity-secrets') {
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      parsed = { NIP_FI_SIGNING_KEY: privateKey.export({ format: 'jwk' }) };
    } else if (name === 'buzz-mcp-secret') parsed = { MCP_BEARER_TOKEN: randomBytes(32).toString('base64url') };
    else throw new Error(`No parameter generator for ${name}`);
    writeFileSync(path, JSON.stringify(parsed), { flag: 'wx', mode: 0o600 });
  }
  const required = {
    'buzz-secrets': ['BUZZ_RELAY_PRIVATE_KEY', 'BUZZ_GIT_HOOK_HMAC_SECRET'],
    'buzz-identity-secrets': ['NIP_FI_SIGNING_KEY'],
    'buzz-mcp-secret': ['MCP_BEARER_TOKEN'],
  }[name];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || required.some((key) => !Object.hasOwn(parsed, key))) throw new Error(`Saved service parameters for ${name} are incomplete`);
  if (name === 'buzz-secrets' && (!/^[a-f0-9]{64}$/.test(parsed.BUZZ_RELAY_PRIVATE_KEY) || !/^[a-f0-9]{64}$/.test(parsed.BUZZ_GIT_HOOK_HMAC_SECRET))) throw new Error('Saved relay secrets must be 32-byte hex strings');
  if (name === 'buzz-mcp-secret' && (typeof parsed.MCP_BEARER_TOKEN !== 'string' || parsed.MCP_BEARER_TOKEN.length < 32)) throw new Error('Saved MCP bearer token is invalid');
  if (name === 'buzz-identity-secrets') {
    const key = parsed.NIP_FI_SIGNING_KEY;
    if (!key || key.kty !== 'EC' || key.crv !== 'P-256' || !key.d || !key.x || !key.y) throw new Error('Saved identity signing key must be a P-256 private JWK');
  }
  chmodSync(path, 0o600);
  return path;
}
function createMissing(items, deployment) {
  for (const item of items) {
    if (item.existing) continue;
    const args = ['create-service', item.expected.offering, item.expected.plan, item.name];
    if (item.name === 'buzz-docs-service-access') args.push('-t', 'mcp-server');
    if (parameterized.has(item.name)) args.push('-c', readOrCreateParameters(item.name, deployment));
    else if (item.serviceKey === 'secrets') args.push('-c', '{"pending_enrollment":true}');
    const result = runCF(args, { deployment, capture: true });
    if (result.status !== 0) throw new Error(`Creating ${item.name} failed (cf exited ${result.status}); rerun --plan and inspect the broker operation before retrying`);
    console.log(`Created ${item.name}; broker provisioning may still be in progress.`);
  }
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForReady(deployment) {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const services = snapshot(deployment);
    const failed = services.filter((item) => item.existing && !['succeeded', 'in progress', 'initializing', 'pending'].includes(String(item.state).toLowerCase()));
    if (failed.length) throw new Error(`Provisioning failed for ${failed.map(({ name, state }) => `${name} (${state})`).join(', ')}; inspect with scripts/cf.mjs service NAME`);
    const pending = services.filter((item) => !item.existing || String(item.state).toLowerCase() !== 'succeeded');
    if (!pending.length) { console.log('All planned services are ready.'); return; }
    console.log(`Waiting for ${pending.length} service operation(s) to finish (15-minute limit).`);
    await delay(POLL_MS);
  }
  throw new Error('Timed out waiting for CF broker operations; inspect pending services and rerun with --wait');
}

export async function main(args = process.argv.slice(2)) {
  try {
    const { apply, wait } = parseArgs(args);
    const deployment = loadDeployment();
    verifyLocalTarget(deployment);
    const services = snapshot(deployment);
    renderPlan(services, deployment);
    const mismatches = services.filter((item) => item.existing && !item.matches);
    const failed = services.filter((item) => item.existing && !['succeeded', 'in progress', 'initializing', 'pending'].includes(String(item.state).toLowerCase()));
    if (mismatches.length) throw new Error(`Existing service offering/plan mismatch: ${mismatches.map(({ name }) => name).join(', ')}; no service was changed`);
    if (failed.length) throw new Error(`Existing service operation failed: ${failed.map(({ name }) => name).join(', ')}; inspect those broker operations before provisioning`);
    if (!apply) {
      console.log('Plan only. Pass --apply to create missing services.');
      return 0;
    }
    createMissing(services, deployment);
    if (wait) await waitForReady(deployment);
    else console.log('Apply complete; broker operations may still be in progress. Run with --wait to poll for readiness.');
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
