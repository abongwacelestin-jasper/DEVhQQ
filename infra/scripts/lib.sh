# Shared helpers for infra/scripts/*.sh (sourced, not executed).
# shellcheck shell=bash
# Variables defined here are consumed by the scripts that source this file.
# shellcheck disable=SC2034

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SECRETS="$ROOT/infra/secrets"
cd "$ROOT" || exit 1

# Compose files: honour COMPOSE_FILE if the operator set it (e.g. dev override).
compose() { docker compose "$@"; }

# Read a single KEY from .env without sourcing it (values may contain spaces).
env_get() { # KEY DEFAULT
  local v=""
  if [[ -f "$ROOT/.env" ]]; then
    v=$(grep -E "^$1=" "$ROOT/.env" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
  fi
  printf '%s' "${v:-$2}"
}

die() { echo "error: $*" >&2; exit 1; }
log() { echo "[$(date -u +%H:%M:%S)] $*"; }

require_secret() { [[ -s "$SECRETS/$1" ]] || die "missing infra/secrets/$1 (run: make secrets)"; }

BUCKET=$(env_get S3_BUCKET_BACKUPS devhq-backups)
PREFIX=postgres

# Run `mc` inside a throwaway minio-init container on the internal network,
# authenticated as the application user via MC_HOST_* (never on argv).
mc_run() {
  # Single quotes are intended: the script is expanded inside the container.
  # shellcheck disable=SC2016
  compose run --rm --no-deps -T --entrypoint /bin/sh minio-init -c '
    set -eu
    export MC_HOST_devhq="http://$(cat /run/secrets/s3_access_key_id):$(cat /run/secrets/s3_secret_access_key)@minio:9000"
    exec mc "$@"' mc "$@"
}

# HMAC-SHA256 of a file with a key derived from backup_encryption_key.
# Python keeps the key off the process list (openssl would need it on argv).
hmac_file() { # FILE -> hex digest on stdout
  python3 - "$SECRETS/backup_encryption_key" "$1" <<'PY'
import hashlib, hmac, sys
key = open(sys.argv[1], "rb").read().strip()
mac_key = hashlib.sha256(b"devhq-backup-mac:" + key).digest()
h = hmac.new(mac_key, digestmod=hashlib.sha256)
with open(sys.argv[2], "rb") as f:
    for chunk in iter(lambda: f.read(1 << 20), b""):
        h.update(chunk)
print(h.hexdigest())
PY
}

# Cipher parameters shared by backup and restore.
OPENSSL_ENC=(openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt)
