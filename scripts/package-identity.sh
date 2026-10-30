#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p artifacts/identity/src artifacts/identity/cf-mtls
cp apps/identity/package.json apps/identity/package-lock.json artifacts/identity/
cp apps/identity/src/*.mjs artifacts/identity/src/
cp integrations/cf-mtls/{certs,server}.mjs artifacts/identity/cf-mtls/
