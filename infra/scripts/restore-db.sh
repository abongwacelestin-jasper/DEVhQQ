#!/usr/bin/env bash
# Restore an encrypted PostgreSQL backup produced by backup-db.sh.
#
#   infra/scripts/restore-db.sh --list
#   infra/scripts/restore-db.sh latest --drill        # restore into a scratch DB, check, drop
#   infra/scripts/restore-db.sh <object|latest> --yes # REPLACE the live database
#
# <object> is the key printed by backup-db.sh, e.g.
#   postgres/devhq-20261107T021700Z.dump.enc
#
# The HMAC is verified before anything is decrypted; a tampered or truncated
# file is rejected. A live restore stops backend + edge (no writes during the
# restore), runs pg_restore --clean, then starts them again.
set -euo pipefail
umask 077
# shellcheck source=infra/scripts/lib.sh
source "$(dirname "$0")/lib.sh"

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

target=${1:-}; mode=${2:-}
[[ -n "$target" ]] || usage
require_secret backup_encryption_key

list_backups() {
  mc_run find "devhq/$BUCKET/$PREFIX" --name '*.dump.enc' | sed "s#^devhq/$BUCKET/##" | sort
}

if [[ "$target" == "--list" ]]; then list_backups; exit 0; fi
case "$mode" in --drill|--yes) ;; *) usage ;; esac

if [[ "$target" == "latest" ]]; then
  target=$(list_backups | tail -n1)
  [[ -n "$target" ]] || die "no backups found in s3://$BUCKET/$PREFIX"
fi
log "selected $target"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mc_run cat "devhq/$BUCKET/$target" > "$work/db.enc"
mc_run cat "devhq/$BUCKET/$target.hmac" > "$work/db.enc.hmac"

expected=$(tr -d '[:space:]' < "$work/db.enc.hmac")
actual=$(hmac_file "$work/db.enc")
python3 -c 'import hmac,sys; sys.exit(0 if hmac.compare_digest(sys.argv[1], sys.argv[2]) else 1)' \
  "$expected" "$actual" || die "HMAC mismatch: backup is corrupt or was tampered with"
log "integrity verified"

decrypt() { "${OPENSSL_ENC[@]}" -d -pass "file:$SECRETS/backup_encryption_key" -in "$work/db.enc"; }

if [[ "$mode" == "--drill" ]]; then
  db="devhq_restore_drill_$(date -u +%s)"
  log "drill: restoring into scratch database $db"
  compose exec -T postgres createdb -U devhq "$db"
  cleanup_drill() { compose exec -T postgres dropdb -U devhq --if-exists "$db" || true; rm -rf "$work"; }
  trap cleanup_drill EXIT
  decrypt | compose exec -T postgres pg_restore -U devhq -d "$db" --no-owner --exit-on-error
  tables=$(compose exec -T postgres psql -U devhq -d "$db" -Atc \
    "select count(*) from information_schema.tables where table_schema='public'")
  log "drill ok: $tables tables restored into $db (dropping it now)"
  exit 0
fi

log "LIVE restore: stopping edge and backend"
compose stop edge backend
decrypt | compose exec -T postgres pg_restore -U devhq -d devhq --clean --if-exists --no-owner --exit-on-error \
  --single-transaction
log "restore complete; starting backend and edge"
compose up -d backend edge
log "done. Verify: curl -fsS https://\$DEVHQ_DOMAIN/api/ready"
