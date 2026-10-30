#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
args=()
while IFS= read -r line; do args+=("$line"); done < <(node scripts/cf.mjs --login-args)
if [[ ${#args[@]} -ne 4 ]]; then
  echo 'Could not load deployment CF context.' >&2
  exit 1
fi
export CF_HOME="${args[3]}"
mkdir -p "$CF_HOME"
cf login -a "${args[0]}" -o "${args[1]}" -s "${args[2]}"
node scripts/cf.mjs --verify-target
