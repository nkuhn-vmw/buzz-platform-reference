#!/usr/bin/env bash
# Disposable local integration fixture. Never points at a foundation database.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
container="buzz-lease-test-$(date +%s)-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
cat > "$work/certificate.cnf" <<'EOF'
[req]
distinguished_name=dn
x509_extensions=extensions
prompt=no
[dn]
CN=localhost
[extensions]
subjectAltName=DNS:localhost,IP:127.0.0.1
basicConstraints=critical,CA:TRUE
keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign
EOF
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -config "$work/certificate.cnf" \
  -keyout "$work/server.key" -out "$work/server.crt" >/dev/null 2>&1
docker run -d --name "$container" -p 127.0.0.1::5432 \
  -e POSTGRES_PASSWORD=disposable-ci-test -e POSTGRES_DB=buzz_lease_test \
  -v "$work:/fixture:ro" postgres:17 \
  bash -c 'cp /fixture/server.crt /tmp/server.crt; cp /fixture/server.key /tmp/server.key; chown postgres:postgres /tmp/server.key; chmod 600 /tmp/server.key; exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key' >/dev/null
ready=false
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -U postgres -d buzz_lease_test >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Disposable PostgreSQL did not become ready' >&2; exit 1; }
port=$(docker port "$container" 5432/tcp | sed 's/.*://')
export BUZZ_AGENT_TEST_DATABASE_URL="postgres://postgres:disposable-ci-test@localhost:$port/buzz_lease_test"
export BUZZ_AGENT_TEST_CA_PATH="$work/server.crt"
cd "$root/apps/agent"
npm test
