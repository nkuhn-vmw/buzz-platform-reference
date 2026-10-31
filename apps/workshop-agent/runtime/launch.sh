#!/usr/bin/env bash
set -euo pipefail
set +x
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agent_pid=''
proxy_pid=''
allowed_file=''
cleanup() {
  for pid in "$proxy_pid" "$agent_pid"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  done
  [[ -z "$allowed_file" ]] || rm -f "$allowed_file"
}
trap cleanup EXIT INT TERM
port="${PORT:?Cloud Foundry PORT is required}"
route="${TANZU_AGENT_BASE_URL:?TANZU_AGENT_BASE_URL is required}"
[[ "$route" =~ ^https://[a-zA-Z0-9.-]+$ ]] || { echo 'HTTPS base origin required' >&2; exit 1; }
[[ -n "${VCAP_SERVICES:-}" ]] || { echo 'SSO service binding required' >&2; exit 1; }
binding="$(printf '%s' "$VCAP_SERVICES" | jq -ce '[.[] | .[] | select(.name == "buzz-workshop-sso")] | if length == 1 then .[0].credentials else error("one workshop SSO binding required") end')"
auth_domain="$(printf '%s' "$binding" | jq -er '.auth_domain | sub("/+$"; "")')"
[[ "$auth_domain" == https://* ]] || { echo 'HTTPS SSO binding required' >&2; exit 1; }
discovery="$(curl --fail --silent --show-error --max-time 15 "$auth_domain/.well-known/openid-configuration")"
issuer="$(printf '%s' "$discovery" | jq -er '.issuer')"
login_url="$(printf '%s' "$discovery" | jq -er '.authorization_endpoint')"
redeem_url="$(printf '%s' "$discovery" | jq -er '.token_endpoint')"
jwks_url="$(printf '%s' "$discovery" | jq -er '.jwks_uri')"
profile_url="$(printf '%s' "$discovery" | jq -er '.userinfo_endpoint')"
for url in "$issuer" "$login_url" "$redeem_url" "$jwks_url" "$profile_url"; do
  [[ "$url" == https://* ]] || { echo 'SSO endpoints must use HTTPS' >&2; exit 1; }
done
allowed_file="$(mktemp)"
chmod 600 "$allowed_file"
printf '%s' "${APP_ALLOWED_EMAILS:?Exact allowed emails required}" | awk -F, '
  {for(i=1;i<=NF;i++){e=$i;gsub(/^[[:space:]]+|[[:space:]]+$/,"",e);
   if(e ~ /[*?]/ || e !~ /^[^@[:space:]]+@[^@[:space:]]+$/) exit 1; print tolower(e)}}
' | sort -u > "$allowed_file"
[[ -s "$allowed_file" ]] || { echo 'Empty email allowlist refused' >&2; exit 1; }
proxy_client_id="$(printf '%s' "$binding" | jq -er '.client_id')"
proxy_client_secret="$(printf '%s' "$binding" | jq -er '.client_secret')"
# Single instance: rotate the gate cookie key on every restart.
# Keep the key out of the native agent environment.
proxy_cookie_secret="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n')"
unset binding discovery
export TANZU_AGENT_HOST=127.0.0.1
export TANZU_AGENT_PORT=8091
env -u PORT tanzu-agent &
agent_pid=$!
for _attempt in {1..80}; do
  curl --fail --silent --max-time 1 http://127.0.0.1:8091/health >/dev/null 2>&1 && break
  kill -0 "$agent_pid" 2>/dev/null || { echo 'Native agent exited before readiness' >&2; exit 1; }
  sleep 0.25
done
curl --fail --silent --max-time 2 http://127.0.0.1:8091/health >/dev/null
OAUTH2_PROXY_CLIENT_ID="$proxy_client_id" \
OAUTH2_PROXY_CLIENT_SECRET="$proxy_client_secret" \
OAUTH2_PROXY_COOKIE_SECRET="$proxy_cookie_secret" \
"$root/bin/oauth2-proxy" \
  --provider=oidc --provider-display-name='Workshop SSO' \
  --skip-oidc-discovery=true --oidc-issuer-url="$issuer" \
  --login-url="$login_url" --redeem-url="$redeem_url" --oidc-jwks-url="$jwks_url" \
  --profile-url="$profile_url" --skip-claims-from-profile-url=false \
  --scope=openid --prompt=select_account --code-challenge-method=S256 \
  --redirect-url="$route/oauth2/callback" --whitelist-domain="${route#https://}" \
  --authenticated-emails-file="$allowed_file" \
  --http-address="0.0.0.0:$port" --upstream=http://127.0.0.1:8091/ \
  --proxy-websockets=true --upstream-timeout=1h --flush-interval=100ms \
  --skip-provider-button=true --cookie-name=__Host-buzz_workshop_gate \
  --cookie-secure=true --cookie-httponly=true --cookie-samesite=lax \
  --cookie-expire=8h --session-cookie-minimal=true \
  --skip-auth-route='GET=^/health$' --skip-auth-route='HEAD=^/health$' \
  --pass-basic-auth=false --pass-authorization-header=false --pass-access-token=false \
  --pass-user-headers=false --request-logging=false --auth-logging=false \
  --silence-ping-logging=true --banner=- --footer=- &
proxy_pid=$!
wait -n "$agent_pid" "$proxy_pid"
