#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
image='ghcr.io/block/buzz@sha256:d30f1b0b393df82a023810c00e080b1418c6123fd74a18a7232ca01c0d3db90c'
docker pull --platform linux/amd64 "$image"
container=$(docker create --platform linux/amd64 "$image")
trap 'docker rm "$container" >/dev/null' EXIT
mkdir -p artifacts/relay/bin artifacts/relay/cf-mtls
cp apps/relay/bindings.mjs apps/relay/launch.mjs apps/relay/package.json artifacts/relay/
cp apps/relay/jwks-proxy.mjs artifacts/relay/
cp integrations/cf-mtls/{certs,proxy}.mjs artifacts/relay/cf-mtls/
for binary in buzz-relay buzz-admin; do
  docker cp "$container:/usr/local/bin/$binary" "artifacts/relay/bin/$binary"
done
# These are generated assets; avoid nesting web/web on a repeated package run.
rm -rf artifacts/relay/web artifacts/relay/admin-web
docker cp "$container:/srv/buzz/web" artifacts/relay/web
docker cp "$container:/srv/buzz/admin-web" artifacts/relay/admin-web
printf '%s\n' "$image" > artifacts/relay/upstream-image.txt
shasum -a 256 artifacts/relay/bin/* > artifacts/relay/SHA256SUMS

cp integrations/Buzz-LICENSE artifacts/relay/Buzz-LICENSE
