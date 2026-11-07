#!/usr/bin/env bash
# End-to-end smoke test of a running stack, through the edge only.
#
#   make smoke                       # against https://$DEVHQ_DOMAIN
#   EDGE_HTTPS_PORT=8443 make smoke  # non-standard ports (local verification)
#
# For DEVHQ_DOMAIN=localhost the edge's internal root CA is copied out of the
# container and used for verification (no -k / --insecure anywhere).
set -euo pipefail
# shellcheck source=infra/scripts/lib.sh
source "$(dirname "$0")/lib.sh"

domain=${DEVHQ_DOMAIN:-$(env_get DEVHQ_DOMAIN localhost)}
https_port=${EDGE_HTTPS_PORT:-$(env_get EDGE_HTTPS_PORT 443)}
http_port=${EDGE_HTTP_PORT:-$(env_get EDGE_HTTP_PORT 80)}
base="https://$domain"; [[ "$https_port" == 443 ]] || base="$base:$https_port"

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
curl_opts=(-sS --max-time 10 --proto '=https,http')
if [[ "$domain" == localhost ]]; then
  compose cp edge:/data/caddy/pki/authorities/local/root.crt "$work/root.crt" >/dev/null 2>&1 \
    || die "could not read the edge's internal CA (is the edge running?)"
  curl_opts+=(--cacert "$work/root.crt")
fi

pass=0; fail=0
check() { # description, command...
  local d=$1; shift
  if "$@" >/dev/null 2>&1; then pass=$((pass + 1)); echo "  ok    $d"
  else fail=$((fail + 1)); echo "  FAIL  $d"; fi
}
header() { # url header-name -> value
  curl "${curl_opts[@]}" -o /dev/null -D - "$1" | tr -d '\r' | grep -i "^$2:" | head -n1 | cut -d' ' -f2-
}

echo "Smoke: $base"

curl "${curl_opts[@]}" "$base/api/health" > "$work/health"
check "GET /api/health -> {ok:true}" grep -q '"ok":true' "$work/health"
check "GET /api/ready -> 200" curl "${curl_opts[@]}" -f -o /dev/null "$base/api/ready"
check "HTTP/2 or HTTP/3 negotiated" sh -c "curl ${curl_opts[*]} -o /dev/null -w '%{http_version}' '$base/api/health' | grep -qE '^(2|3)'"

hsts=$(header "$base/" strict-transport-security)
check "HSTS on SPA responses" test -n "$hsts"
csp=$(header "$base/" content-security-policy)
check "CSP on SPA shell (frame-ancestors 'none')" sh -c "printf '%s' \"\$1\" | grep -q \"frame-ancestors 'none'\"" _ "$csp"
check "SPA shell is no-cache" sh -c "test \"\$1\" = no-cache" _ "$(header "$base/" cache-control)"
check "client-side route falls back to index.html" sh -c "curl ${curl_opts[*]} '$base/some/deep/route' | grep -q '<div id=\"root\">'"

asset=$(curl "${curl_opts[@]}" "$base/" | grep -oE '/assets/[^"]+\.js' | head -n1 || true)
check "hashed asset referenced by index.html" test -n "$asset"
if [[ -n "$asset" ]]; then
  check "hashed asset is immutable" sh -c "printf '%s' \"\$1\" | grep -q immutable" _ "$(header "$base$asset" cache-control)"
  check "asset served compressed" sh -c "curl ${curl_opts[*]} -H 'Accept-Encoding: gzip' -o /dev/null -D - '$base$asset' | tr -d '\r' | grep -qiE '^content-encoding: (gzip|zstd)'"
fi

check "API errors are JSON, not the SPA shell" sh -c "curl ${curl_opts[*]} '$base/api/definitely-not-a-route' | grep -q '\"error\"'"
check "Server header stripped" sh -c "! curl ${curl_opts[*]} -o /dev/null -D - '$base/api/health' | grep -qi '^server:'"

# Spoofed X-Forwarded-For must not reach the backend as the client IP.
probe="smoke-xff-$(date +%s)-$RANDOM"
curl "${curl_opts[@]}" -o /dev/null -H 'X-Forwarded-For: 203.0.113.77' "$base/api/$probe" || true
sleep 1
line=$(compose logs --no-log-prefix --since 2m backend 2>/dev/null | grep "$probe" | tail -n1 || true)
check "backend logged the probe request" test -n "$line"
check "spoofed X-Forwarded-For ignored by the edge" sh -c "! printf '%s' \"\$1\" | grep -q 203.0.113.77" _ "$line"

# Plain HTTP must redirect to HTTPS.
code=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "http://$domain:$http_port/" || true)
check "HTTP redirects to HTTPS (got $code)" sh -c "case '$code' in 301|302|307|308) exit 0;; *) exit 1;; esac"

# Data services must not be published on the host.
for svc_port in postgres:5432 minio:9000 minio:9001 models:8000; do
  svc=${svc_port%%:*}; p=${svc_port##*:}
  # `compose port` prints ":0" for an exposed-but-unpublished port.
  check "$svc:$p not published" sh -c "! docker compose port $svc $p 2>/dev/null | grep -qE ':[1-9][0-9]*$'"
done

echo "Smoke: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
