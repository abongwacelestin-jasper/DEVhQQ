#!/usr/bin/env bash
# DevHQ on Railway: create the project, services, plugins, settings and
# variables. Runbook: docs/deploy/RAILWAY.md. Safe to re-run: existing
# services, plugins, volumes and variables are kept, and generated secrets
# are only generated when the variable does not exist yet.
#
#   infra/railway/setup.sh --dry-run          # print every step, change nothing
#   infra/railway/setup.sh                    # provision (prompts for what is missing)
#   infra/railway/setup.sh --db-roles         # create the Postgres roles (psql >= 15)
#   infra/railway/setup.sh --with-worker      # also deploy the long-running worker (phase 2)
#
# Tools: railway (CLI v4, logged in: `railway login`), jq, curl, openssl.
# The CLI does projects, plugins, services, plain variables, volumes and the
# custom domain. Shared variables, secrets, service settings (config file,
# root directory) and repo connections go through Railway's public GraphQL API
# with RAILWAY_API_TOKEN (Account Settings -> Tokens), and secrets are sent on
# stdin, never on a command line.
#
# Inputs (environment, else prompted; nothing is hard-coded):
#   RAILWAY_API_TOKEN                     account or workspace token
#   DEVHQ_PROJECT    (devhq)              Railway project name
#   DEVHQ_DOMAIN                          public host, e.g. app.example.com
#   GITHUB_REPO                           owner/repo the services deploy from
#   DEPLOY_BRANCH    (main)               branch Railway deploys
#   R2_ACCOUNT_ID                         Cloudflare account id
#   R2_BACKEND_ACCESS_KEY_ID / R2_BACKEND_SECRET_ACCESS_KEY   token: uploads, backups, audit
#   R2_MODELS_ACCESS_KEY_ID  / R2_MODELS_SECRET_ACCESS_KEY    token: models bucket only
#   R2_JURISDICTION  (unset)              `eu` for an EU-jurisdiction account
#   ANTHROPIC_API_KEY (optional)          assistant in the models service
#   RESEND_API_KEY   (optional)           mail via Resend; with it, MAIL_FROM is required
#   MAIL_FROM        (with Resend)        e.g. "DevHQ <no-reply@mail.example.com>"
#   BRAND_*          (optional, env only) BRAND_NAME, BRAND_LEGAL_NAME, BRAND_LOGO_URL,
#                                         BRAND_PRIMARY_COLOR, BRAND_ACCENT_COLOR,
#                                         BRAND_SUPPORT_EMAIL, BRAND_POSTAL_ADDRESS,
#                                         BRAND_WEBSITE_URL, MAIL_REPLY_TO
# Generated when missing: SESSION_SECRET, DATA_ENCRYPTION_KEY, ML_SERVICE_TOKEN,
# MODEL_SIGNING_KEY, APP_DB_PASSWORD, MIGRATOR_DB_PASSWORD, JOBS_DB_PASSWORD.
# GraphQL documents and Railway ${{...}} references are single-quoted on purpose.
# shellcheck disable=SC2016
set -euo pipefail

GQL_URL="${RAILWAY_GRAPHQL_URL:-https://backboard.railway.com/graphql/v2}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DRY_RUN=0
DB_ROLES=0
WITH_WORKER=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --db-roles) DB_ROLES=1 ;;
    --with-worker) WITH_WORKER=1 ;;
    -h | --help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\033[1m[railway-setup]\033[0m %s\n' "$*"; }
die() { printf '[railway-setup] error: %s\n' "$*" >&2; exit 1; }

# run CMD...: execute, or print it in dry-run mode.
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '  $'; printf ' %q' "$@"; printf '\n'; return 0; fi
  "$@"
}

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required ($2)"; }

# ask VAR "prompt" [secret]: keep the env value, else prompt (hidden for secrets).
ask() {
  local var="$1" prompt="$2" secret="${3:-}" value
  if [ -n "${!var:-}" ]; then return 0; fi
  if [ "$DRY_RUN" = 1 ]; then printf -v "$var" '%s' "<$var>"; return 0; fi
  [ -t 0 ] || die "$var is not set and there is no terminal to ask"
  if [ -n "$secret" ]; then read -rsp "$prompt: " value; echo; else read -rp "$prompt: " value; fi
  [ -n "$value" ] || die "$var is required"
  printf -v "$var" '%s' "$value"
}

optional() { # optional VAR "prompt": like ask, but empty is fine
  local var="$1" prompt="$2" value=""
  if [ -n "${!var:-}" ] || [ "$DRY_RUN" = 1 ] || [ ! -t 0 ]; then return 0; fi
  read -rsp "$prompt (optional, Enter to skip): " value; echo
  printf -v "$var" '%s' "$value"
}

# gql QUERY VARIABLES_JSON: Railway GraphQL; the token goes in a header file and
# the body on stdin, so neither appears in `ps`.
gql() {
  local query="$1" vars="$2" hdr out
  if [ "$DRY_RUN" = 1 ]; then
    printf '  graphql: %s\n' "$(printf '%s' "$query" | tr -s ' \n' ' ' | cut -c1-110)" >&2
    printf '%s' '{"data":{}}'
    return 0
  fi
  hdr="$(mktemp)"
  chmod 600 "$hdr"
  printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "$RAILWAY_API_TOKEN" >"$hdr"
  out="$(jq -n --arg q "$query" --argjson v "$vars" '{query: $q, variables: $v}' |
    curl -fsS -H "@$hdr" --data-binary @- "$GQL_URL")" || { rm -f "$hdr"; die "GraphQL request failed"; }
  rm -f "$hdr"
  if [ "$(printf '%s' "$out" | jq 'has("errors")')" = true ]; then
    die "GraphQL error: $(printf '%s' "$out" | jq -c '.errors')"
  fi
  printf '%s' "$out"
}

# ---------------------------------------------------------------------------
# 0. Preconditions and inputs
# ---------------------------------------------------------------------------
need jq "https://jqlang.org"
need curl "curl"
need openssl "openssl"
if [ "$DRY_RUN" = 0 ]; then
  need railway "npm i -g @railway/cli, then railway login"
  railway whoami >/dev/null 2>&1 || die "not logged in: run \`railway login\`"
fi

DEVHQ_PROJECT="${DEVHQ_PROJECT:-devhq}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
ask RAILWAY_API_TOKEN "Railway API token (Account Settings -> Tokens)" secret
ask DEVHQ_DOMAIN "Public host name (e.g. app.example.com)"
ask GITHUB_REPO "GitHub repository (owner/repo)"
ask R2_ACCOUNT_ID "Cloudflare account id (R2)"
ask R2_BACKEND_ACCESS_KEY_ID "R2 backend token: Access Key ID" secret
ask R2_BACKEND_SECRET_ACCESS_KEY "R2 backend token: Secret Access Key" secret
ask R2_MODELS_ACCESS_KEY_ID "R2 models token: Access Key ID" secret
ask R2_MODELS_SECRET_ACCESS_KEY "R2 models token: Secret Access Key" secret
optional ANTHROPIC_API_KEY "Anthropic API key"
optional RESEND_API_KEY "Resend API key"
if [ -n "${RESEND_API_KEY:-}" ]; then
  ask MAIL_FROM "Sender for email (e.g. DevHQ <no-reply@mail.example.com>)"
fi

case "$DEVHQ_DOMAIN" in *://* | */*) die "DEVHQ_DOMAIN is a host name, not a URL" ;; esac
R2_HOST="${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
[ -n "${R2_JURISDICTION:-}" ] && R2_HOST="${R2_ACCOUNT_ID}.${R2_JURISDICTION}.r2.cloudflarestorage.com"
R2_ENDPOINT="https://${R2_HOST}"

# ---------------------------------------------------------------------------
# 1. Project and environment
# ---------------------------------------------------------------------------
status_json() {
  if [ "$DRY_RUN" = 1 ]; then echo '{}'; return 0; fi
  railway status --json 2>/dev/null || echo '{}'
}

STATUS="$(status_json)"
if [ "$(printf '%s' "$STATUS" | jq -r '.name // empty')" != "$DEVHQ_PROJECT" ]; then
  log "creating project $DEVHQ_PROJECT (or link an existing one: railway link)"
  run railway init --name "$DEVHQ_PROJECT"
  STATUS="$(status_json)"
fi
PROJECT_ID="${RAILWAY_PROJECT_ID:-$(printf '%s' "$STATUS" | jq -r '.id // empty')}"
ENV_NAME="${RAILWAY_ENVIRONMENT:-production}"
ENVIRONMENT_ID="${RAILWAY_ENVIRONMENT_ID:-$(printf '%s' "$STATUS" |
  jq -r --arg e "$ENV_NAME" '.environments.edges[]? | select(.node.name == $e) | .node.id' | head -n1)}"
if [ "$DRY_RUN" = 1 ]; then PROJECT_ID="${PROJECT_ID:-<project-id>}"; ENVIRONMENT_ID="${ENVIRONMENT_ID:-<environment-id>}"; fi
[ -n "$PROJECT_ID" ] && [ -n "$ENVIRONMENT_ID" ] ||
  die "could not read the project/environment id from \`railway status --json\`; set RAILWAY_PROJECT_ID and RAILWAY_ENVIRONMENT_ID"
log "project $PROJECT_ID, environment $ENV_NAME ($ENVIRONMENT_ID)"

service_id() { # service_id NAME -> id or empty
  printf '%s' "$(status_json)" | jq -r --arg n "$1" '.services.edges[]? | select(.node.name == $n) | .node.id' | head -n1
}

# ---------------------------------------------------------------------------
# 2. Plugins: PostgreSQL and Redis (private networking only)
# ---------------------------------------------------------------------------
for db in Postgres Redis; do
  if [ -n "$(service_id "$db")" ]; then
    log "$db exists"
  else
    log "adding $db"
    run railway add --database "$(printf '%s' "$db" | tr '[:upper:]' '[:lower:]')"
  fi
done

# ---------------------------------------------------------------------------
# 3. Application services (empty: variables first, repo connection last)
# ---------------------------------------------------------------------------
APP_SERVICES="frontend backend worker cron models"
# sid NAME: the service id recorded below (bash 3 has no associative arrays).
sid() { local ref="SID_$1"; printf '%s' "${!ref}"; }
for s in $APP_SERVICES; do
  id="$(service_id "$s")"
  if [ -z "$id" ]; then
    log "creating service $s"
    run railway add --service "$s"
    id="$(service_id "$s")"
  else
    log "service $s exists"
  fi
  printf -v "SID_$s" '%s' "${id:-<$s-id>}"
done

# Config-as-code file and root directory per service. The config file path is
# absolute from the repository root; models builds with Models/ as context.
for s in $APP_SERVICES; do
  root="/"
  [ "$s" = models ] && root="/Models"
  log "settings: $s -> /infra/railway/$s.railway.json (root $root)"
  gql 'mutation($sid: String!, $eid: String!, $input: ServiceInstanceUpdateInput!) {
         serviceInstanceUpdate(serviceId: $sid, environmentId: $eid, input: $input) }' \
    "$(jq -n --arg sid "$(sid "$s")" --arg eid "$ENVIRONMENT_ID" --arg cfg "/infra/railway/$s.railway.json" --arg root "$root" \
      '{sid: $sid, eid: $eid, input: {railwayConfigFile: $cfg, rootDirectory: $root}}')" >/dev/null
done

# Backend volume: durable local audit copy and, because a service with a
# volume is never run twice at once, stop-then-start deploys (one in-memory
# writer at a time; see RAILWAY.md "Scaling").
if [ "$DRY_RUN" = 1 ] || ! railway volume list --service backend 2>/dev/null | grep -q '/var/lib/devhq'; then
  log "adding volume backend:/var/lib/devhq"
  run railway volume add --service backend --mount-path /var/lib/devhq
else
  log "backend volume exists"
fi

# ---------------------------------------------------------------------------
# 4. Variables
# ---------------------------------------------------------------------------
# existing_keys [SERVICE_ID]: names already set (shared when no service id).
existing_keys() {
  local svc="${1:-}"
  gql 'query($pid: String!, $eid: String!, $sid: String) {
         variables(projectId: $pid, environmentId: $eid, serviceId: $sid, unrendered: true) }' \
    "$(jq -n --arg pid "$PROJECT_ID" --arg eid "$ENVIRONMENT_ID" --arg sid "$svc" \
      '{pid: $pid, eid: $eid, sid: (if $sid == "" then null else $sid end)}')" |
    jq -r '.data.variables // {} | keys[]'
}

# upsert [SERVICE_ID] < JSON object: merge variables (shared when no service id).
upsert() {
  local svc="${1:-}" vars
  vars="$(cat)"
  if [ "$DRY_RUN" = 1 ]; then
    printf '  set %s: %s\n' "${svc:-shared}" "$(printf '%s' "$vars" | jq -r 'keys | join(", ")')"
    return 0
  fi
  gql 'mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }' \
    "$(jq -n --arg pid "$PROJECT_ID" --arg eid "$ENVIRONMENT_ID" --arg sid "$svc" --argjson v "$vars" \
      '{input: ({projectId: $pid, environmentId: $eid, variables: $v, skipDeploys: true, replace: false}
                + (if $sid == "" then {} else {serviceId: $sid} end))}')" >/dev/null
}

# Generated shared secrets: created once, never rotated by a re-run.
SHARED_HAVE="$(existing_keys)"
gen_json='{}'
for key in SESSION_SECRET DATA_ENCRYPTION_KEY ML_SERVICE_TOKEN MODEL_SIGNING_KEY \
  APP_DB_PASSWORD MIGRATOR_DB_PASSWORD JOBS_DB_PASSWORD; do
  if printf '%s\n' "$SHARED_HAVE" | grep -qx "$key"; then continue; fi
  gen_json="$(jq --arg k "$key" --arg v "$(openssl rand -hex 32)" '. + {($k): $v}' <<<"$gen_json")"
done
if [ "$gen_json" != '{}' ]; then
  log "generating shared secrets: $(jq -r 'keys | join(", ")' <<<"$gen_json")"
  upsert <<<"$gen_json"
else
  log "shared secrets already set (not rotated)"
fi

# Shared, non-secret configuration and the R2 backend credentials.
log "shared configuration"
jq -n \
  --arg origin "https://$DEVHQ_DOMAIN" --arg rp "$DEVHQ_DOMAIN" \
  --arg s3 "$R2_ENDPOINT" \
  --arg akid "$R2_BACKEND_ACCESS_KEY_ID" --arg sak "$R2_BACKEND_SECRET_ACCESS_KEY" '{
  NODE_ENV: "production",
  APP_ORIGIN: $origin,
  PUBLIC_URL: $origin,
  WEBAUTHN_RP_ID: $rp,
  WEBAUTHN_RP_NAME: "DevHQ",
  LOG_LEVEL: "info",
  DEMO_DISABLED: "1",
  S3_ENDPOINT: $s3,
  S3_PUBLIC_ENDPOINT: $s3,
  S3_REGION: "auto",
  S3_FORCE_PATH_STYLE: "true",
  S3_BUCKET_UPLOADS: "devhq-uploads",
  S3_BUCKET_BACKUPS: "devhq-backups",
  S3_BUCKET_AUDIT: "devhq-audit",
  S3_BUCKET_MODELS: "devhq-models",
  STORAGE_LOCK_MODE: "R2_BUCKET_LOCK",
  BACKUP_RETENTION_DAYS: "35",
  R2_BACKEND_ACCESS_KEY_ID: $akid,
  R2_BACKEND_SECRET_ACCESS_KEY: $sak
}' | upsert

# References: Railway resolves ${{...}} at deploy time. Single quotes keep
# them literal here.
PG_HOSTPORT='${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}'
NODE_COMMON='{
  "NODE_ENV": "${{shared.NODE_ENV}}",
  "APP_ORIGIN": "${{shared.APP_ORIGIN}}",
  "PUBLIC_URL": "${{shared.PUBLIC_URL}}",
  "WEBAUTHN_RP_ID": "${{shared.WEBAUTHN_RP_ID}}",
  "WEBAUTHN_RP_NAME": "${{shared.WEBAUTHN_RP_NAME}}",
  "LOG_LEVEL": "${{shared.LOG_LEVEL}}",
  "DEMO_DISABLED": "${{shared.DEMO_DISABLED}}",
  "APP_VERSION": "${{RAILWAY_GIT_COMMIT_SHA}}",
  "SESSION_SECRET": "${{shared.SESSION_SECRET}}",
  "DATA_ENCRYPTION_KEY": "${{shared.DATA_ENCRYPTION_KEY}}",
  "DATABASE_SSL": "disable",
  "S3_ENDPOINT": "${{shared.S3_ENDPOINT}}",
  "S3_PUBLIC_ENDPOINT": "${{shared.S3_PUBLIC_ENDPOINT}}",
  "S3_REGION": "${{shared.S3_REGION}}",
  "S3_FORCE_PATH_STYLE": "${{shared.S3_FORCE_PATH_STYLE}}",
  "S3_ACCESS_KEY_ID": "${{shared.R2_BACKEND_ACCESS_KEY_ID}}",
  "S3_SECRET_ACCESS_KEY": "${{shared.R2_BACKEND_SECRET_ACCESS_KEY}}",
  "S3_BUCKET_UPLOADS": "${{shared.S3_BUCKET_UPLOADS}}",
  "S3_BUCKET_BACKUPS": "${{shared.S3_BUCKET_BACKUPS}}",
  "S3_BUCKET_AUDIT": "${{shared.S3_BUCKET_AUDIT}}",
  "S3_BUCKET_MODELS": "${{shared.S3_BUCKET_MODELS}}",
  "STORAGE_LOCK_MODE": "${{shared.STORAGE_LOCK_MODE}}",
  "BACKUP_RETENTION_DAYS": "${{shared.BACKUP_RETENTION_DAYS}}"
}'

log "backend variables"
jq --arg pg "$PG_HOSTPORT" '. + {
  PORT: "8080",
  TRUST_PROXY: "1",
  RAILWAY_RUN_UID: "0",
  JOBS_IN_PROCESS: "monitors,digest",
  DATABASE_URL: ("postgresql://devhq_app:${{shared.APP_DB_PASSWORD}}@" + $pg),
  DATABASE_MIGRATION_URL: ("postgresql://devhq_migrator:${{shared.MIGRATOR_DB_PASSWORD}}@" + $pg),
  REDIS_URL: "${{Redis.REDIS_URL}}",
  ML_SERVICE_URL: "http://${{models.RAILWAY_PRIVATE_DOMAIN}}:8000",
  ML_SERVICE_TOKEN: "${{shared.ML_SERVICE_TOKEN}}",
  MAIL_TRANSPORT: "console"
}' <<<"$NODE_COMMON" | upsert "$(sid backend)"

log "cron variables (one-shot backup + restore drill, read-only database role)"
jq --arg pg "$PG_HOSTPORT" '. + {
  DATABASE_URL: ("postgresql://devhq_jobs:${{shared.JOBS_DB_PASSWORD}}@" + $pg),
  DATABASE_POOL_MAX: "3"
}' <<<"$NODE_COMMON" | upsert "$(sid cron)"

log "worker variables (phase 2: deploy only with JOBS_IN_PROCESS=0 on backend)"
jq --arg pg "$PG_HOSTPORT" '. + {
  DATABASE_URL: ("postgresql://devhq_app:${{shared.APP_DB_PASSWORD}}@" + $pg),
  REDIS_URL: "${{Redis.REDIS_URL}}",
  WORKER_JOBS: "monitors,digest",
  WORKER_LOOP_ENABLED: "0",
  MAIL_TRANSPORT: "console"
}' <<<"$NODE_COMMON" | upsert "$(sid worker)"

log "frontend variables"
jq -n --arg s3 "$R2_ENDPOINT" '{
  PORT: "8081",
  API_MODE: "proxy",
  API_UPSTREAM: "${{backend.RAILWAY_PRIVATE_DOMAIN}}:8080",
  S3_PUBLIC_ORIGIN: $s3,
  HSTS_VALUE: "max-age=63072000; includeSubDomains; preload"
}' | upsert "$(sid frontend)"

log "models variables (private networking only, own R2 token)"
jq -n --arg akid "$R2_MODELS_ACCESS_KEY_ID" --arg sak "$R2_MODELS_SECRET_ACCESS_KEY" \
  --arg anthropic "${ANTHROPIC_API_KEY:-}" '{
  NODE_ENV: "production",
  HOST: "::",
  PORT: "8000",
  ML_SERVICE_TOKEN: "${{shared.ML_SERVICE_TOKEN}}",
  MODEL_SIGNING_KEY: "${{shared.MODEL_SIGNING_KEY}}",
  S3_ENDPOINT: "${{shared.S3_ENDPOINT}}",
  S3_REGION: "${{shared.S3_REGION}}",
  S3_FORCE_PATH_STYLE: "${{shared.S3_FORCE_PATH_STYLE}}",
  S3_BUCKET_MODELS: "${{shared.S3_BUCKET_MODELS}}",
  S3_ACCESS_KEY_ID: $akid,
  S3_SECRET_ACCESS_KEY: $sak
} + (if $anthropic == "" then {} else {ANTHROPIC_API_KEY: $anthropic} end)' | upsert "$(sid models)"

# Mail (Resend) and brand. Without a key, mail stays on the console transport
# (logged, not sent). With one, production refuses to boot unless MAIL_FROM is set.
if [ -n "${RESEND_API_KEY:-}" ]; then
  log "Resend mail + brand (backend and worker)"
  MAIL_JSON="$(jq -n --arg k "$RESEND_API_KEY" --arg from "$MAIL_FROM" --arg app "https://${DEVHQ_DOMAIN}" '{
    MAIL_TRANSPORT: "resend", RESEND_API_KEY: $k, MAIL_FROM: $from, APP_URL: $app
  }')"
  for v in MAIL_REPLY_TO BRAND_NAME BRAND_LEGAL_NAME BRAND_LOGO_URL BRAND_LOGO_WIDTH \
           BRAND_PRIMARY_COLOR BRAND_ACCENT_COLOR BRAND_SUPPORT_EMAIL BRAND_POSTAL_ADDRESS \
           BRAND_WEBSITE_URL; do
    if [ -n "${!v:-}" ]; then
      MAIL_JSON="$(jq --arg k "$v" --arg val "${!v}" '. + {($k): $val}' <<<"$MAIL_JSON")"
    fi
  done
  upsert "$(sid backend)" <<<"$MAIL_JSON"
  upsert "$(sid worker)" <<<"$MAIL_JSON"
else
  log "no RESEND_API_KEY: email is logged, not sent (MAIL_TRANSPORT=console)"
fi

# ---------------------------------------------------------------------------
# 5. Database roles (optional here; see postgres-roles.sql)
# ---------------------------------------------------------------------------
if [ "$DB_ROLES" = 1 ]; then
  [ "$DRY_RUN" = 1 ] || need psql "PostgreSQL client >= 15"
  log "creating database roles through \`railway connect Postgres\`"
  if [ "$DRY_RUN" = 0 ]; then
    shared="$(gql 'query($pid: String!, $eid: String!) { variables(projectId: $pid, environmentId: $eid) }' \
      "$(jq -n --arg pid "$PROJECT_ID" --arg eid "$ENVIRONMENT_ID" '{pid: $pid, eid: $eid}')")"
    DEVHQ_APP_DB_PASSWORD="$(jq -r '.data.variables.APP_DB_PASSWORD' <<<"$shared")" \
      DEVHQ_MIGRATOR_DB_PASSWORD="$(jq -r '.data.variables.MIGRATOR_DB_PASSWORD' <<<"$shared")" \
      DEVHQ_JOBS_DB_PASSWORD="$(jq -r '.data.variables.JOBS_DB_PASSWORD' <<<"$shared")" \
      railway connect Postgres <"$HERE/postgres-roles.sql"
  else
    run railway connect Postgres
  fi
fi

# ---------------------------------------------------------------------------
# 6. Custom domain (frontend only; backend, worker, cron, models stay private)
# ---------------------------------------------------------------------------
log "custom domain $DEVHQ_DOMAIN -> frontend (add the DNS records it prints in Cloudflare)"
run railway domain --service frontend "$DEVHQ_DOMAIN" || log "domain already attached (or add it in the dashboard)"

# ---------------------------------------------------------------------------
# 7. Connect the repository: this triggers the first deploys
# ---------------------------------------------------------------------------
connect() {
  log "connecting $1 to $GITHUB_REPO@$DEPLOY_BRANCH"
  gql 'mutation($id: String!, $input: ServiceConnectInput!) { serviceConnect(id: $id, input: $input) { id } }' \
    "$(jq -n --arg id "$(sid "$1")" --arg repo "$GITHUB_REPO" --arg branch "$DEPLOY_BRANCH" \
      '{id: $id, input: {repo: $repo, branch: $branch}}')" >/dev/null
}
for s in models backend frontend cron; do connect "$s"; done
if [ "$WITH_WORKER" = 1 ]; then
  log "worker: remember JOBS_IN_PROCESS=0 on backend and WORKER_LOOP_ENABLED=1 on worker"
  connect worker
else
  log "worker left undeployed (phase 1: jobs stay in backend + cron; RAILWAY.md \"Jobs\")"
fi

log "done. Next: RAILWAY.md \"First deploy\" (roles, R2, DNS, bootstrap-owner)."
