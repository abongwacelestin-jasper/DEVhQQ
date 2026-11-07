#!/usr/bin/env bash
# Generate DevHQ secrets under infra/secrets/ (gitignored).
#
#   infra/scripts/gen-secrets.sh            # create missing secrets only
#   infra/scripts/gen-secrets.sh --rotate NAME   # regenerate one generated secret
#
# Idempotent: existing files are never overwritten (rotating a database or
# MinIO password needs a coordinated change, see docs/deploy/RUNBOOK.md).
# Session-secret rotation has its own procedure:
#   infra/scripts/rotate-session-secret.md
#
# Permissions: the directory is 0700 and files are 0640 owned by the current
# user and its primary group. Containers run as their own non-root uids and are
# added to that group (compose `group_add: DEVHQ_SECRETS_GID`), because
# non-swarm compose bind-mounts secret files with their host ownership and
# mode: a 0600 file would be unreadable to every non-root container. On
# Ubuntu each user has a private primary group, so the effective audience is
# the same as 0600. The script records the gid in .env.
#
# External credentials (Anthropic, SMTP, GitHub) are created EMPTY. Paste the
# real values into those files; an empty file means "integration not
# configured" and the feature degrades gracefully.
set -euo pipefail
umask 077

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DIR="$ROOT/infra/secrets"
ENV_FILE="$ROOT/.env"

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

mkdir -p "$DIR"
chmod 0700 "$DIR"

write() { # name value
  local f="$DIR/$1"
  printf '%s' "$2" > "$f.tmp"
  chmod 0640 "$f.tmp"
  mv -f "$f.tmp" "$f"
  echo "  wrote   $1"
}

hex() { openssl rand -hex "$1"; }

# Derived URLs always match the password files:
#   database_url           backend, DML-only role devhq_app
#   database_url_migrator  migrate service, schema owner devhq
write_db_urls() {
  [[ -s "$DIR/app_db_password" && -s "$DIR/postgres_password" ]] || return 0
  write database_url "postgres://devhq_app:$(cat "$DIR/app_db_password")@postgres:5432/devhq"
  write database_url_migrator "postgres://devhq:$(cat "$DIR/postgres_password")@postgres:5432/devhq"
}

# name -> generator. Database/MinIO passwords are hex so they never need
# URL-encoding inside DATABASE_URL.
generate() {
  case "$1" in
    session_secret)        hex 32 ;;   # 64 hex chars (backend minimum in prod)
    data_encryption_key)   hex 32 ;;   # 32-byte AES-256-GCM key (hex)
    postgres_password)     hex 24 ;;   # owner/migrator role `devhq`
    app_db_password)       hex 24 ;;   # runtime role `devhq_app`
    minio_root_user)       printf 'devhq-root-%s' "$(hex 4)" ;;
    minio_root_password)   hex 24 ;;
    s3_access_key_id)      printf 'devhq-app-%s' "$(hex 6)" ;;
    s3_secret_access_key)  hex 24 ;;
    ml_service_token)      hex 32 ;;
    backup_encryption_key) hex 32 ;;
    *) return 1 ;;
  esac
}

GENERATED="session_secret data_encryption_key postgres_password app_db_password minio_root_user minio_root_password s3_access_key_id s3_secret_access_key ml_service_token backup_encryption_key"
EXTERNAL="session_secret_previous anthropic_api_key smtp_password github_app_private_key github_webhook_secret github_client_secret github_token"

if [[ "${1:-}" == "--rotate" ]]; then
  name=${2:?usage: gen-secrets.sh --rotate NAME}
  case " $GENERATED " in *" $name "*) ;; *) echo "not a generated secret: $name" >&2; exit 1 ;; esac
  case "$name" in
    session_secret)
      echo "use infra/scripts/rotate-session-secret.md (keeps sessions valid)" >&2; exit 1 ;;
    postgres_password|app_db_password|minio_root_user|minio_root_password|s3_access_key_id|s3_secret_access_key)
      echo "warning: $name is also stored inside its service; follow RUNBOOK 'Rotation'" >&2 ;;
  esac
  write "$name" "$(generate "$name")"
  write_db_urls
  exit 0
fi

echo "Secrets directory: $DIR"
for name in $GENERATED; do
  if [[ -s "$DIR/$name" ]]; then
    echo "  kept    $name"
  else
    write "$name" "$(generate "$name")"
  fi
done

write_db_urls

for name in $EXTERNAL; do
  if [[ -e "$DIR/$name" ]]; then
    echo "  kept    $name"
  else
    : > "$DIR/$name"
    chmod 0640 "$DIR/$name"
    echo "  created $name (empty: fill in to enable the integration)"
  fi
done

# Normalise modes in case files were edited by hand.
find "$DIR" -maxdepth 1 -type f ! -name '.gitignore' ! -name 'README.md' -exec chmod 0640 {} +

# Record the group the containers must join to read the files.
gid=$(id -g)
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT/.env.example" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
  echo "  created .env from .env.example (review DEVHQ_DOMAIN and ACME_EMAIL)"
fi
if grep -q '^DEVHQ_SECRETS_GID=' "$ENV_FILE"; then
  sed -i.bak "s/^DEVHQ_SECRETS_GID=.*/DEVHQ_SECRETS_GID=$gid/" "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
else
  printf '\nDEVHQ_SECRETS_GID=%s\n' "$gid" >> "$ENV_FILE"
fi
echo "DEVHQ_SECRETS_GID=$gid recorded in .env"
echo "Done. Never commit infra/secrets/ or .env."
