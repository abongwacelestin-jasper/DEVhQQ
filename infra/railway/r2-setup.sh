#!/usr/bin/env bash
# Cloudflare R2 for DevHQ: buckets, CORS, lifecycle and bucket lock rules.
# Runbook: docs/deploy/RAILWAY.md ("Object storage on R2"). Re-runnable: each
# bucket is created only if missing, and every rule set is replaced as a whole
# (PUT), so running it twice gives the same result.
#
#   infra/railway/r2-setup.sh --dry-run   # print every request body, change nothing
#   infra/railway/r2-setup.sh
#
# Inputs (environment, else prompted):
#   CLOUDFLARE_API_TOKEN   token with "Workers R2 Storage: Edit" on the account
#   R2_ACCOUNT_ID          Cloudflare account id
#   DEVHQ_DOMAIN           app host, e.g. app.example.com (CORS origin)
#   R2_JURISDICTION        optional: `eu` (buckets in the EU jurisdiction)
#   BACKUP_RETENTION_DAYS  (35)   lock + expiry for devhq-backups
#   AUDIT_RETENTION_DAYS   (365)  lock for devhq-audit (never expired by lifecycle)
#
# What this cannot do: create the S3 access keys the services use. Create two
# R2 API tokens in the dashboard (R2 -> Manage API tokens), "Object Read &
# Write", scoped to specific buckets:
#   devhq-backend  devhq-uploads, devhq-backups, devhq-audit   -> backend, worker, cron
#   devhq-models   devhq-models                                -> models
#
# WORM honesty: bucket lock rules stop every S3/API token from deleting or
# overwriting a locked object, but an account member with R2 admin rights can
# remove the rule first. That is weaker than S3 Object Lock COMPLIANCE; see
# RAILWAY.md "WORM on R2".
set -euo pipefail

API="https://api.cloudflare.com/client/v4"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '[r2-setup] %s\n' "$*"; }
die() { printf '[r2-setup] error: %s\n' "$*" >&2; exit 1; }
command -v jq >/dev/null || die "jq is required"
command -v curl >/dev/null || die "curl is required"

ask() {
  local var="$1" prompt="$2" secret="${3:-}" value
  if [ -n "${!var:-}" ]; then return 0; fi
  if [ "$DRY_RUN" = 1 ]; then printf -v "$var" '%s' "<$var>"; return 0; fi
  [ -t 0 ] || die "$var is not set and there is no terminal to ask"
  if [ -n "$secret" ]; then read -rsp "$prompt: " value; echo; else read -rp "$prompt: " value; fi
  [ -n "$value" ] || die "$var is required"
  printf -v "$var" '%s' "$value"
}
ask CLOUDFLARE_API_TOKEN "Cloudflare API token (Workers R2 Storage: Edit)" secret
ask R2_ACCOUNT_ID "Cloudflare account id"
ask DEVHQ_DOMAIN "App host (CORS origin), e.g. app.example.com"

BACKUP_DAYS="${BACKUP_RETENTION_DAYS:-35}"
AUDIT_DAYS="${AUDIT_RETENTION_DAYS:-365}"
DAY=86400
UPLOADS="${S3_BUCKET_UPLOADS:-devhq-uploads}"
BACKUPS="${S3_BUCKET_BACKUPS:-devhq-backups}"
AUDIT="${S3_BUCKET_AUDIT:-devhq-audit}"
MODELS="${S3_BUCKET_MODELS:-devhq-models}"

# cf METHOD PATH [BODY]: Cloudflare API call; token via a header file, body via stdin.
cf() {
  local method="$1" path="$2" body="${3:-}" hdr out
  if [ "$DRY_RUN" = 1 ]; then
    printf '  %s %s\n' "$method" "$path" >&2
    [ -n "$body" ] && printf '%s\n' "$body" | jq . | sed 's/^/    /' >&2
    printf '%s' '{"success":true,"result":{}}'
    return 0
  fi
  hdr="$(mktemp)"
  chmod 600 "$hdr"
  {
    printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "$CLOUDFLARE_API_TOKEN"
    [ -n "${R2_JURISDICTION:-}" ] && printf 'cf-r2-jurisdiction: %s\n' "$R2_JURISDICTION"
  } >"$hdr"
  out="$(printf '%s' "$body" | curl -sS -X "$method" -H "@$hdr" ${body:+--data-binary @-} "$API$path")" || {
    rm -f "$hdr"
    die "$method $path failed"
  }
  rm -f "$hdr"
  printf '%s' "$out"
}

ok() { [ "$(printf '%s' "$1" | jq -r '.success')" = true ]; }
base="/accounts/$R2_ACCOUNT_ID/r2/buckets"

# ---- buckets ----------------------------------------------------------------
for b in "$UPLOADS" "$BACKUPS" "$AUDIT" "$MODELS"; do
  if [ "$DRY_RUN" = 0 ] && ok "$(cf GET "$base/$b")"; then
    log "bucket $b exists"
  else
    log "creating bucket $b"
    res="$(cf POST "$base" "$(jq -nc --arg n "$b" '{name: $n}')")"
    ok "$res" || die "create $b: $(jq -c '.errors' <<<"$res")"
  fi
  # No public r2.dev URL: objects are reached through presigned URLs only.
  cf PUT "$base/$b/domains/managed" '{"enabled":false}' >/dev/null
done

# ---- CORS: presigned browser uploads and downloads (uploads bucket only) -----
log "CORS on $UPLOADS for https://$DEVHQ_DOMAIN"
cors="$(jq -nc --arg o "https://$DEVHQ_DOMAIN" '{rules: [{
  id: "devhq-presigned",
  allowed: {origins: [$o], methods: ["PUT", "GET", "HEAD"], headers: ["content-type"]},
  exposeHeaders: ["ETag"],
  maxAgeSeconds: 600
}]}')"
res="$(cf PUT "$base/$UPLOADS/cors" "$cors")"
ok "$res" || die "CORS: $(jq -c '.errors' <<<"$res")"

# ---- lifecycle -------------------------------------------------------------
abort_mpu() { jq -nc --argjson s "$DAY" '{condition: {type: "Age", maxAge: $s}}'; }

log "lifecycle on $UPLOADS: pending/ after 1 day, stale multipart after 1 day"
res="$(cf PUT "$base/$UPLOADS/lifecycle" "$(jq -nc --argjson d "$DAY" --argjson a "$(abort_mpu)" '{rules: [
  {id: "expire-abandoned-pending-uploads", enabled: true, conditions: {prefix: "pending/"},
   deleteObjectsTransition: {condition: {type: "Age", maxAge: $d}}},
  {id: "abort-incomplete-multipart", enabled: true, conditions: {prefix: ""},
   abortMultipartUploadsTransition: $a}
]}')")"
ok "$res" || die "lifecycle $UPLOADS: $(jq -c '.errors' <<<"$res")"

log "lifecycle on $BACKUPS: expire after $((BACKUP_DAYS + 1)) days (the lock holds them for $BACKUP_DAYS)"
res="$(cf PUT "$base/$BACKUPS/lifecycle" "$(jq -nc --argjson s "$(((BACKUP_DAYS + 1) * DAY))" --argjson a "$(abort_mpu)" '{rules: [
  {id: "expire-after-retention", enabled: true, conditions: {prefix: ""},
   deleteObjectsTransition: {condition: {type: "Age", maxAge: $s}},
   abortMultipartUploadsTransition: $a}
]}')")"
ok "$res" || die "lifecycle $BACKUPS: $(jq -c '.errors' <<<"$res")"

for b in "$AUDIT" "$MODELS"; do
  log "lifecycle on $b: abort stale multipart only (objects are kept)"
  res="$(cf PUT "$base/$b/lifecycle" "$(jq -nc --argjson a "$(abort_mpu)" '{rules: [
    {id: "abort-incomplete-multipart", enabled: true, conditions: {prefix: ""}, abortMultipartUploadsTransition: $a}
  ]}')")"
  ok "$res" || die "lifecycle $b: $(jq -c '.errors' <<<"$res")"
done

# ---- bucket locks (WORM) ---------------------------------------------------
lock() { # lock BUCKET DAYS
  log "bucket lock on $1: no delete or overwrite for $2 days after upload"
  res="$(cf PUT "$base/$1/lock" "$(jq -nc --arg id "retain-$2d" --argjson s "$(($2 * DAY))" '{rules: [
    {id: $id, enabled: true, prefix: "", condition: {type: "Age", maxAgeSeconds: $s}}
  ]}')")"
  ok "$res" || die "lock $1: $(jq -c '.errors' <<<"$res")"
}
lock "$BACKUPS" "$BACKUP_DAYS"
lock "$AUDIT" "$AUDIT_DAYS"

# ---- read back -------------------------------------------------------------
if [ "$DRY_RUN" = 0 ]; then
  for b in "$BACKUPS" "$AUDIT"; do
    log "$b lock rules: $(cf GET "$base/$b/lock" | jq -c '.result.rules')"
  done
fi
log "done. Now create the two R2 API tokens (see the header of this script)."
