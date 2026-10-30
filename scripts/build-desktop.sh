#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVISION="$(tr -d '\r\n' < "$ROOT/integrations/desktop/upstream-revision.txt")"
UPSTREAM_SOURCE="${BUZZ_UPSTREAM_SOURCE:-$ROOT/upstream/buzz}"
PATCH="$ROOT/integrations/desktop/nip-fa-client.patch"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The desktop package script currently builds macOS app bundles only." >&2
  exit 1
fi
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid pinned upstream revision." >&2; exit 1; }

if [[ ! -d "$UPSTREAM_SOURCE/.git" ]]; then
  mkdir -p "$(dirname "$UPSTREAM_SOURCE")"
  git clone --filter=blob:none --no-checkout https://github.com/block/buzz.git "$UPSTREAM_SOURCE"
  git -C "$UPSTREAM_SOURCE" fetch --depth=1 origin "$REVISION"
  git -C "$UPSTREAM_SOURCE" checkout --detach "$REVISION"
fi

ACTUAL_REVISION="$(git -C "$UPSTREAM_SOURCE" rev-parse HEAD)"
ORIGIN="$(git -C "$UPSTREAM_SOURCE" remote get-url origin)"
[[ "$ACTUAL_REVISION" == "$REVISION" ]] || { echo "Upstream checkout must be pinned at $REVISION." >&2; exit 1; }
[[ "$ORIGIN" == "https://github.com/block/buzz.git" ]] || { echo "Unexpected upstream origin." >&2; exit 1; }
[[ -z "$(git -C "$UPSTREAM_SOURCE" status --porcelain)" ]] || { echo "Upstream checkout must be clean before packaging." >&2; exit 1; }

BUZZ_DESKTOP_ROOT="$ROOT" BUZZ_UPSTREAM_SOURCE="$UPSTREAM_SOURCE" BUZZ_PATCH="$PATCH" BUZZ_PINNED_REVISION="$REVISION" node --input-type=module <<'NODE'
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.BUZZ_DESKTOP_ROOT;
const source = process.env.BUZZ_UPSTREAM_SOURCE;
const patch = process.env.BUZZ_PATCH;
const run = (command, args, cwd, env = process.env) => {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const helperUrl = pathToFileURL(path.join(root, 'scripts/lib/config.mjs'));
const { loadDeployment } = await import(helperUrl.href);
const config = loadDeployment();
const origin = (value, scheme, label) => {
  const u = new URL(value);
  if (u.protocol !== scheme || u.username || u.password || u.pathname !== '/' || u.search || u.hash) {
    throw new Error(`${label} must be a canonical ${scheme} origin`);
  }
  if (u.hostname.endsWith('.invalid')) throw new Error(`${label} must be set to a real deployment origin`);
  return u.origin;
};
const identityOrigin = origin(config.identityOrigin, 'https:', 'identityOrigin');
const relayHttpOrigin = origin(config.relayOrigin, 'https:', 'relayOrigin');
const relayWsUrl = origin(config.relayUrl, 'wss:', 'relayUrl');
if (relayWsUrl !== relayHttpOrigin.replace(/^https:/, 'wss:')) {
  throw new Error('relayUrl must be the websocket form of relayOrigin');
}
if (!/^[a-z][a-z0-9-]{1,39}$/.test(config.desktop.profile)) {
  throw new Error('desktop.profile must be a lowercase deployment slug');
}
const tempRoot = mkdtempSync(path.join(tmpdir(), 'buzz-reference-desktop-'));
const stagedSource = path.join(tempRoot, 'source');
try {
  run('git', ['clone', '--no-hardlinks', '--no-checkout', source, stagedSource], root);
  run('git', ['checkout', '--detach', process.env.BUZZ_PINNED_REVISION], stagedSource);
  run('git', ['apply', '--check', patch], stagedSource);
  run('git', ['apply', patch], stagedSource);

  const desktop = path.join(stagedSource, 'desktop');
  const configOverride = path.join(tempRoot, 'tauri-config.json');
  const plistPath = path.join(stagedSource, 'desktop/src-tauri/Info.reference.plist');
  let plist = readFileSync(path.join(stagedSource, 'desktop/src-tauri/Info.plist'), 'utf8');
  for (const key of ['CFBundleDisplayName', 'CFBundleName']) {
    const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
    if (!pattern.test(plist)) throw new Error(`Pinned Info.plist is missing ${key}`);
    plist = plist.replace(pattern, `$1${config.desktop.name}$2`);
  }
  writeFileSync(plistPath, plist);
  writeFileSync(configOverride, JSON.stringify({
    productName: config.desktop.name,
    identifier: config.desktop.bundleId,
    build: { beforeBuildCommand: 'node_modules/.bin/tsc && node ./scripts/build-protected-feature-artifacts.mjs' },
    bundle: { macOS: { infoPlist: plistPath } },
  }));
  const targetRoot = process.env.BUZZ_CARGO_TARGET_DIR || path.join(root, '.state/build-cache/desktop-target', config.desktop.profile);
  mkdirSync(targetRoot, { recursive: true });
  const childEnv = {
    ...process.env,
    CARGO_TARGET_DIR: targetRoot,
    BUZZ_IDENTITY_ORIGIN: identityOrigin,
    BUZZ_RELAY_HTTP_ORIGIN: relayHttpOrigin,
    BUZZ_RELAY_URL: relayWsUrl,
    BUZZ_DESKTOP_PROFILE: config.desktop.profile,
  };
  run('pnpm', ['install', '--frozen-lockfile'], desktop);
  run('cargo', ['build', '--release', '-p', 'buzz-acp', '-p', 'buzz-agent', '-p', 'buzz-backend-kubernetes', '-p', 'buzz-dev-mcp', '-p', 'buzz-cli', '-p', 'git-credential-nostr'], stagedSource, childEnv);
  const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1];
  if (!host) throw new Error('Could not determine the native Rust target triple');
  const sidecarDir = path.join(stagedSource, 'desktop/src-tauri/binaries');
  mkdirSync(sidecarDir, { recursive: true });
  for (const binary of ['buzz-acp', 'buzz-agent', 'buzz-backend-kubernetes', 'buzz-dev-mcp', 'git-credential-nostr', 'buzz']) {
    const built = path.join(targetRoot, 'release', binary);
    if (!existsSync(built)) throw new Error(`Missing built sidecar: ${built}`);
    const sidecar = path.join(sidecarDir, `${binary}-${host}`);
    cpSync(built, sidecar);
    run('chmod', ['755', sidecar], stagedSource);
  }
  run(process.execPath, ['scripts/tauri-command.mjs', 'build', '--no-sign', '--config', configOverride], desktop, childEnv);

  const builtApp = path.join(targetRoot, 'release/bundle/macos', `${config.desktop.name}.app`);
  if (!existsSync(builtApp)) throw new Error(`Tauri build did not produce ${config.desktop.name}.app`);
  const outputDir = path.join(root, 'artifacts/desktop', config.desktop.profile);
  mkdirSync(outputDir, { recursive: true });
  const outputApp = path.join(outputDir, `${config.desktop.name}.app`);
  if (existsSync(outputApp)) throw new Error(`Output already exists; move it first to preserve prior profile artifacts: ${outputApp}`);
  cpSync(builtApp, outputApp, { recursive: true, errorOnExist: true });
  writeFileSync(path.join(outputDir, 'BUILD-INFO.txt'), [
    `upstream_revision=${process.env.BUZZ_PINNED_REVISION}`,
    `bundle_id=${config.desktop.bundleId}`,
    `profile=${config.desktop.profile}`,
    'developer_signature=none',
    'notarized=no',
    '',
  ].join('\n'));
  console.log(`Created macOS desktop app without developer signing: ${outputApp}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
NODE
