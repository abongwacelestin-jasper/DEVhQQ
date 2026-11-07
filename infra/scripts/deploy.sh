#!/usr/bin/env bash
# Health-gated rollout with automatic rollback. Runs ON the deploy host,
# invoked by .github/workflows/deploy.yml (or by hand):
#
#   cd /opt/devhq && infra/scripts/deploy.sh <40-hex commit sha>
#
# 1. remember the current commit + DEVHQ_TAG (the rollback target)
# 2. encrypted DB backup (skip with PRE_DEPLOY_BACKUP=0)
# 3. check out the new commit's compose/infra files, set DEVHQ_TAG=sha-<sha>
# 4. docker compose pull + up -d (migrate runs before the backend starts)
# 5. gate: backend/frontend/edge healthy AND /api/health + /api/ready return
#    200 through the edge within GATE_TIMEOUT seconds
# 6. on any failure: restore the previous commit + tag, `up -d` again, exit 1
#
# Migrations must be backward compatible (expand/contract): a rollback runs the
# previous backend against the already-migrated schema.
set -euo pipefail
# shellcheck source=infra/scripts/lib.sh
source "$(dirname "$0")/lib.sh"

sha=${1:-}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "usage: deploy.sh <40-hex commit sha>"
new_tag="sha-$sha"
GATE_TIMEOUT=${GATE_TIMEOUT:-180}
SERVICES=${DEPLOY_SERVICES:-edge frontend backend migrate models postgres minio minio-init}

domain=$(env_get DEVHQ_DOMAIN localhost)
https_port=$(env_get EDGE_HTTPS_PORT 443)
state_dir="${DEVHQ_STATE_DIR:-$HOME/.local/state/devhq}"   # outside the checkout (not gitignored)
mkdir -p "$state_dir"

prev_sha=$(git rev-parse HEAD)
prev_tag=$(env_get DEVHQ_TAG local)

set_tag() {
  if grep -q '^DEVHQ_TAG=' .env; then
    sed -i.bak "s/^DEVHQ_TAG=.*/DEVHQ_TAG=$1/" .env && rm -f .env.bak
  else
    printf 'DEVHQ_TAG=%s\n' "$1" >> .env
  fi
}

healthy() { # service -> 0 when the running container reports healthy
  local id
  id=$(compose ps -q "$1")
  [[ -n "$id" ]] && [[ "$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)" == healthy ]]
}

gate() {
  local deadline=$((SECONDS + GATE_TIMEOUT)) curl_opts=(-fsS --max-time 5 --resolve "$domain:$https_port:127.0.0.1")
  if [[ "$domain" == localhost ]]; then
    compose cp edge:/data/caddy/pki/authorities/local/root.crt "$state_dir/root.crt" >/dev/null 2>&1 || true
    curl_opts+=(--cacert "$state_dir/root.crt")
  fi
  while (( SECONDS < deadline )); do
    if healthy backend && healthy frontend && healthy edge \
       && curl "${curl_opts[@]}" -o /dev/null "https://$domain:$https_port/api/health" \
       && curl "${curl_opts[@]}" -o /dev/null "https://$domain:$https_port/api/ready"; then
      return 0
    fi
    sleep 5
  done
  return 1
}

rollout() { # sha tag
  git checkout --quiet --detach "$1"
  set_tag "$2"
  # shellcheck disable=SC2086 # word splitting of the service list is intended
  compose pull --quiet $SERVICES
  # shellcheck disable=SC2086
  compose up -d --no-build --remove-orphans $SERVICES
}

log "deploy $new_tag (previous: $prev_tag @ ${prev_sha:0:12})"
printf '%s %s\n' "$prev_sha" "$prev_tag" > "$state_dir/previous"

if [[ "${PRE_DEPLOY_BACKUP:-1}" == 1 ]] && [[ -n "$(compose ps -q postgres)" ]]; then
  "$ROOT/infra/scripts/backup-db.sh"
fi

git fetch --quiet origin
if rollout "$sha" "$new_tag" && gate; then
  printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$sha" "$new_tag" >> "$state_dir/history"
  log "deploy ok: $new_tag is live"
  exit 0
fi

log "health gate FAILED for $new_tag; rolling back to $prev_tag"
compose logs --tail 80 backend migrate edge >&2 || true
if rollout "$prev_sha" "$prev_tag" && gate; then
  log "rollback ok: $prev_tag is live again"
else
  log "ROLLBACK FAILED: manual intervention required (docs/deploy/RUNBOOK.md, Incident checklist)"
fi
exit 1
