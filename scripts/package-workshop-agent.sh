#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=7.15.5
archive="oauth2-proxy-v${version}.linux-amd64.tar.gz"
expected=f63f94bf72c5f46ab002a0a275aa8b3cf19b4d828aed08a13978cb9a62c3a1fd
cache=.state/downloads/oauth2-proxy
out=artifacts/workshop-agent
# Recreate only this generated artifact directory; never package stale local files.
rm -rf "$out"
mkdir -p "$cache" "$out/bin" "$out/runtime"
if [[ ! -f "$cache/$archive" ]]; then
  curl --fail --location --proto '=https' --tlsv1.2 \
    "https://github.com/oauth2-proxy/oauth2-proxy/releases/download/v${version}/${archive}" -o "$cache/$archive"
fi
actual=$(shasum -a 256 "$cache/$archive" | awk '{print $1}')
[[ "$actual" == "$expected" ]] || { echo 'OAuth2 Proxy archive checksum mismatch' >&2; exit 1; }
tar -xzf "$cache/$archive" -C "$cache" "oauth2-proxy-v${version}.linux-amd64/oauth2-proxy"
cp "$cache/oauth2-proxy-v${version}.linux-amd64/oauth2-proxy" "$out/bin/"
cp apps/workshop-agent/{AGENTS.md,Procfile} "$out/"
cp apps/workshop-agent/runtime/launch.sh "$out/runtime/"
chmod 755 "$out/bin/oauth2-proxy" "$out/runtime/launch.sh"
curl --fail --location --proto '=https' --tlsv1.2 \
  "https://raw.githubusercontent.com/oauth2-proxy/oauth2-proxy/v${version}/LICENSE" -o "$out/OAuth2-Proxy-LICENSE"
printf '%s\n' "OAuth2 Proxy ${version}; official linux-amd64 archive SHA256 ${expected}" > "$out/DEPENDENCIES.txt"
echo "Prepared $out using the verified official OAuth2 Proxy release."
