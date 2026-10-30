#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sprig=${1:?Usage: scripts/package-agent.sh /path/to/sprig}
mkdir -p artifacts/agent/{bin,runtime}
cp "$sprig" artifacts/agent/bin/sprig
chmod 755 artifacts/agent/bin/sprig
for name in buzz-acp buzz-agent buzz-dev-mcp buzz rg tree git-credential-nostr git-sign-nostr; do
  ln -sfn sprig "artifacts/agent/bin/$name"
done
cp integrations/agent/package{,-lock}.json artifacts/agent/
cp integrations/agent/*.js artifacts/agent/runtime/
chmod +x artifacts/agent/runtime/{buildpack-acp,mcp-http-stdio}.js
cp apps/agent/{launch,worker,lease,lease-config,gateway-mcp,verify-native}.mjs artifacts/agent/
chmod +x artifacts/agent/gateway-mcp.mjs
shasum -a 256 artifacts/agent/bin/sprig > artifacts/agent/SHA256SUMS

cp integrations/Buzz-LICENSE artifacts/agent/Buzz-LICENSE
