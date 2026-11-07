#!/bin/sh
# DevHQ object storage bootstrap — idempotent. Runs in the `minio/mc` image
# (see compose.snippet.yml) or anywhere `mc` is installed.
#
# Creates and hardens the four buckets, then creates least-privilege service
# users. Safe to re-run: every step either checks first or is an upsert.
#
# Required env:
#   MINIO_ENDPOINT            e.g. http://minio:9000
#   MINIO_ROOT_USER / MINIO_ROOT_PASSWORD   admin credentials (bootstrap only)
#   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY  backend service user to create
# Optional env:
#   MODELS_S3_ACCESS_KEY_ID / MODELS_S3_SECRET_ACCESS_KEY  ML service user (skipped if unset)
#   S3_BUCKET_UPLOADS|BACKUPS|AUDIT|MODELS   bucket names (devhq-*)
#   STORAGE_LOCK_MODE         GOVERNANCE (dev, default) | COMPLIANCE (prod — irreversible!)
#   BACKUP_RETENTION_DAYS     default retention on backups (default 35)
#   AUDIT_RETENTION_DAYS      default retention on audit (default 365)
#   PENDING_UPLOAD_EXPIRY_DAYS  lifecycle for abandoned uploads (default 1)
#   ENABLE_SSE                1 (default) → bucket default encryption SSE-S3;
#                             requires MINIO_KMS_SECRET_KEY (or KES) on the server.

set -eu

: "${MINIO_ENDPOINT:?MINIO_ENDPOINT is required}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID is required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY is required}"

UPLOADS="${S3_BUCKET_UPLOADS:-devhq-uploads}"
BACKUPS="${S3_BUCKET_BACKUPS:-devhq-backups}"
AUDIT="${S3_BUCKET_AUDIT:-devhq-audit}"
MODELS="${S3_BUCKET_MODELS:-devhq-models}"
LOCK_MODE="${STORAGE_LOCK_MODE:-GOVERNANCE}"
BACKUP_DAYS="${BACKUP_RETENTION_DAYS:-35}"
AUDIT_DAYS="${AUDIT_RETENTION_DAYS:-365}"
PENDING_DAYS="${PENDING_UPLOAD_EXPIRY_DAYS:-1}"
ENABLE_SSE="${ENABLE_SSE:-1}"
A=devhq
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

case "$LOCK_MODE" in GOVERNANCE|COMPLIANCE) ;; *) echo "STORAGE_LOCK_MODE must be GOVERNANCE or COMPLIANCE" >&2; exit 1 ;; esac
if [ "${#S3_SECRET_ACCESS_KEY}" -lt 16 ]; then echo "S3_SECRET_ACCESS_KEY must be at least 16 characters" >&2; exit 1; fi

log() { printf '[minio-bootstrap] %s\n' "$*"; }

# Wait for the server (compose healthcheck should already cover this).
i=0
until mc alias set "$A" "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -ge 30 ] && { echo "MinIO not reachable at $MINIO_ENDPOINT" >&2; exit 1; }
  sleep 2
done
log "connected to $MINIO_ENDPOINT"

# ---- buckets ---------------------------------------------------------------

# Object Lock can only be enabled at creation. If a WORM bucket already exists
# without it, stop rather than silently running without immutability.
make_bucket() { # name lock(0|1)
  if mc ls "$A/$1" >/dev/null 2>&1; then
    if [ "$2" = 1 ] && ! mc retention info --default "$A/$1" >/dev/null 2>&1; then
      echo "Bucket $1 exists WITHOUT object lock — recreate it (data migration required)." >&2
      exit 1
    fi
    log "bucket $1 exists"
  else
    if [ "$2" = 1 ]; then mc mb --with-lock "$A/$1" >/dev/null; else mc mb "$A/$1" >/dev/null; fi
    log "bucket $1 created$( [ "$2" = 1 ] && echo ' (object lock)')"
  fi
  mc version enable "$A/$1" >/dev/null
  # Block public access: no anonymous policy at all.
  mc anonymous set none "$A/$1" >/dev/null
  if [ "$ENABLE_SSE" = 1 ]; then
    mc encrypt set sse-s3 "$A/$1" >/dev/null
  fi
}

make_bucket "$UPLOADS" 0
make_bucket "$BACKUPS" 1
make_bucket "$AUDIT" 1
make_bucket "$MODELS" 0

# WORM default retention (GOVERNANCE in dev, COMPLIANCE in prod).
mc retention set --default "$LOCK_MODE" "${BACKUP_DAYS}d" "$A/$BACKUPS" >/dev/null
mc retention set --default "$LOCK_MODE" "${AUDIT_DAYS}d" "$A/$AUDIT" >/dev/null
log "default retention: $BACKUPS=$LOCK_MODE/${BACKUP_DAYS}d $AUDIT=$LOCK_MODE/${AUDIT_DAYS}d"

# ---- lifecycle -------------------------------------------------------------

cat >"$TMP/uploads-ilm.json" <<EOF
{
  "Rules": [
    { "ID": "expire-abandoned-pending-uploads", "Status": "Enabled", "Filter": { "Prefix": "pending/" },
      "Expiration": { "Days": $PENDING_DAYS } },
    { "ID": "expire-noncurrent-versions", "Status": "Enabled", "Filter": { "Prefix": "" },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 30 } },
    { "ID": "delete-markers-and-incomplete-multipart", "Status": "Enabled", "Filter": { "Prefix": "" },
      "Expiration": { "ExpiredObjectDeleteMarker": true },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 } }
  ]
}
EOF
mc ilm rule import "$A/$UPLOADS" <"$TMP/uploads-ilm.json" >/dev/null

# Backups expire by lifecycle once retention has passed (the backend cannot delete them).
cat >"$TMP/backups-ilm.json" <<EOF
{
  "Rules": [
    { "ID": "expire-after-retention", "Status": "Enabled", "Filter": { "Prefix": "" },
      "Expiration": { "Days": $((BACKUP_DAYS + 1)) },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 } },
    { "ID": "expire-noncurrent-versions", "Status": "Enabled", "Filter": { "Prefix": "" },
      "NoncurrentVersionExpiration": { "NoncurrentDays": $((BACKUP_DAYS + 1)) } }
  ]
}
EOF
mc ilm rule import "$A/$BACKUPS" <"$TMP/backups-ilm.json" >/dev/null
# MinIO only accepts AbortIncompleteMultipartUpload alongside an expiration
# action (AWS accepts it standalone), and also cleans stale multipart uploads
# server-wide via `api stale_uploads_expiry` — pin that explicitly.
mc admin config set "$A" api stale_uploads_expiry=24h >/dev/null 2>&1 ||
  log "note: could not set api stale_uploads_expiry (non-MinIO server?)"
log "lifecycle rules applied to $UPLOADS and $BACKUPS"

# ---- least-privilege policies ----------------------------------------------

# Backend: uploads read/write/delete; backups put + read (restore/drill) + list,
# never delete or bypass retention; audit put-only.
cat >"$TMP/devhq-backend.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "UploadsObjects", "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::$UPLOADS/*"] },
    { "Sid": "UploadsList", "Effect": "Allow",
      "Action": ["s3:ListBucket"], "Resource": ["arn:aws:s3:::$UPLOADS"] },
    { "Sid": "BackupsWriteRead", "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:GetObjectRetention"],
      "Resource": ["arn:aws:s3:::$BACKUPS/*"] },
    { "Sid": "BackupsList", "Effect": "Allow",
      "Action": ["s3:ListBucket"], "Resource": ["arn:aws:s3:::$BACKUPS"] },
    { "Sid": "AuditWriteOnly", "Effect": "Allow",
      "Action": ["s3:PutObject"], "Resource": ["arn:aws:s3:::$AUDIT/*"] },
    { "Sid": "NeverWeakenWorm", "Effect": "Deny",
      "Action": ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:BypassGovernanceRetention",
                 "s3:PutObjectRetention", "s3:PutObjectLegalHold", "s3:PutBucketObjectLockConfiguration",
                 "s3:PutLifecycleConfiguration", "s3:PutBucketPolicy", "s3:DeleteBucket"],
      "Resource": ["arn:aws:s3:::$BACKUPS", "arn:aws:s3:::$BACKUPS/*",
                   "arn:aws:s3:::$AUDIT", "arn:aws:s3:::$AUDIT/*"] }
  ]
}
EOF

# ML service: models bucket only.
cat >"$TMP/devhq-models.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ModelsObjects", "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::$MODELS/*"] },
    { "Sid": "ModelsList", "Effect": "Allow",
      "Action": ["s3:ListBucket"], "Resource": ["arn:aws:s3:::$MODELS"] }
  ]
}
EOF

mc admin policy create "$A" devhq-backend "$TMP/devhq-backend.json" >/dev/null
mc admin policy create "$A" devhq-models "$TMP/devhq-models.json" >/dev/null
log "policies devhq-backend, devhq-models upserted"

ensure_user() { # access secret policy
  mc admin user add "$A" "$1" "$2" >/dev/null # upsert (also rotates the secret)
  # Attach; an "already attached" answer is success. (Don't grep `user info`
  # for the policy name: it also matches an access key of the same name.)
  if ! out="$(mc admin policy attach "$A" "$3" --user "$1" 2>&1)"; then
    case "$out" in
      *already*) ;;
      *) echo "$out" >&2; exit 1 ;;
    esac
  fi
  # Verify the effective policy rather than trusting the call.
  mc admin user info "$A" "$1" --json | grep -q "\"policyName\":\"[^\"]*$3" ||
    { echo "policy $3 is not attached to $1" >&2; exit 1; }
  log "user $1 → $3"
}

ensure_user "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" devhq-backend
if [ -n "${MODELS_S3_ACCESS_KEY_ID:-}" ] && [ -n "${MODELS_S3_SECRET_ACCESS_KEY:-}" ]; then
  ensure_user "$MODELS_S3_ACCESS_KEY_ID" "$MODELS_S3_SECRET_ACCESS_KEY" devhq-models
else
  log "MODELS_S3_ACCESS_KEY_ID unset — models service user skipped"
fi

log "done"
