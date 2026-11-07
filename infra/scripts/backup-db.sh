#!/usr/bin/env bash
# Encrypted PostgreSQL backup to the MinIO backups bucket.
#
#   infra/scripts/backup-db.sh            # or: make backup
#
# Pipeline (the plaintext dump never touches disk):
#   pg_dump -Fc (inside the postgres container)
#     | openssl enc AES-256-CBC, PBKDF2-SHA256 600k, key = infra/secrets/backup_encryption_key
#     > tmp file  ->  HMAC-SHA256 over the ciphertext (encrypt-then-MAC)
#   upload  s3://$S3_BUCKET_BACKUPS/postgres/devhq-<UTC>.dump.enc  (+ .hmac)
#
# Schedule it from the deploy user's crontab (see docs/deploy/RUNBOOK.md):
#   17 2 * * *  cd /opt/devhq && infra/scripts/backup-db.sh >> /var/log/devhq-backup.log 2>&1
#
# Keep an off-host copy of backup_encryption_key: without it the backups are
# unrecoverable. Retention / object lock on the bucket is configured by
# STORAGE's MinIO bootstrap.
set -euo pipefail
umask 077
# shellcheck source=infra/scripts/lib.sh
source "$(dirname "$0")/lib.sh"

require_secret backup_encryption_key
command -v openssl >/dev/null || die "openssl is required"
command -v python3 >/dev/null || die "python3 is required"

ts=$(date -u +%Y%m%dT%H%M%SZ)
object="$PREFIX/devhq-$ts.dump.enc"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

log "dumping database"
compose exec -T postgres pg_dump -U devhq -d devhq --format=custom --compress=6 --no-owner \
  | "${OPENSSL_ENC[@]}" -pass "file:$SECRETS/backup_encryption_key" -out "$work/db.enc"

size=$(wc -c < "$work/db.enc" | tr -d ' ')
[[ "$size" -gt 64 ]] || die "encrypted dump is suspiciously small ($size bytes)"
hmac_file "$work/db.enc" > "$work/db.enc.hmac"

log "uploading $object ($size bytes)"
mc_run pipe "devhq/$BUCKET/$object" < "$work/db.enc"
mc_run pipe "devhq/$BUCKET/$object.hmac" < "$work/db.enc.hmac"
mc_run stat "devhq/$BUCKET/$object" >/dev/null

# Optional local copy (still encrypted), e.g. BACKUP_LOCAL_DIR=/var/backups/devhq
if [[ -n "${BACKUP_LOCAL_DIR:-}" ]]; then
  mkdir -p "$BACKUP_LOCAL_DIR"
  cp "$work/db.enc" "$BACKUP_LOCAL_DIR/devhq-$ts.dump.enc"
  cp "$work/db.enc.hmac" "$BACKUP_LOCAL_DIR/devhq-$ts.dump.enc.hmac"
  find "$BACKUP_LOCAL_DIR" -name 'devhq-*.dump.enc*' -mtime +"${BACKUP_LOCAL_RETENTION_DAYS:-14}" -delete
fi

log "backup ok: s3://$BUCKET/$object"
