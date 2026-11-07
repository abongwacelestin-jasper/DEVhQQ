#!/bin/sh
# One-shot MinIO bootstrap, run by the `minio-init` compose service.
#
# STORAGE owns the real bootstrap at infra/minio/bootstrap.sh (buckets, object
# lock / WORM, lifecycle, least-privilege app policy). When that file exists it
# is executed instead of the fallback below, with the same environment:
#
#   MINIO_URL                    http://minio:9000
#   MINIO_ROOT_USER_FILE         /run/secrets/minio_root_user
#   MINIO_ROOT_PASSWORD_FILE     /run/secrets/minio_root_password
#   S3_ACCESS_KEY_ID_FILE        /run/secrets/s3_access_key_id      (app user)
#   S3_SECRET_ACCESS_KEY_FILE    /run/secrets/s3_secret_access_key  (app user)
#   S3_BUCKET_UPLOADS / _BACKUPS / _AUDIT / _MODELS
#
# The fallback is intentionally minimal and idempotent: create the buckets and
# an application user restricted to them. It is safe to run on every `up`.
set -eu

if [ -f /bootstrap/bootstrap.sh ]; then
  echo "minio-init: running STORAGE bootstrap (infra/minio/bootstrap.sh)"
  exec sh /bootstrap/bootstrap.sh
fi

echo "minio-init: infra/minio/bootstrap.sh not found; using INFRA fallback"

read_secret() { tr -d '\r\n' < "$1"; }

MC_CONFIG_DIR=${MC_CONFIG_DIR:-/tmp/.mc}
export MC_CONFIG_DIR
root_user=$(read_secret "$MINIO_ROOT_USER_FILE")
root_pass=$(read_secret "$MINIO_ROOT_PASSWORD_FILE")
app_key=$(read_secret "$S3_ACCESS_KEY_ID_FILE")
app_secret=$(read_secret "$S3_SECRET_ACCESS_KEY_FILE")

i=0
until mc alias set devhq "$MINIO_URL" "$root_user" "$root_pass" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "minio-init: MinIO not reachable at $MINIO_URL" >&2
    exit 1
  fi
  sleep 2
done

buckets="$S3_BUCKET_UPLOADS $S3_BUCKET_BACKUPS $S3_BUCKET_AUDIT $S3_BUCKET_MODELS"
for b in $buckets; do
  mc mb --ignore-existing "devhq/$b"
  mc anonymous set none "devhq/$b" >/dev/null
done
mc version enable "devhq/$S3_BUCKET_BACKUPS" >/dev/null
mc version enable "devhq/$S3_BUCKET_AUDIT" >/dev/null

policy=/tmp/devhq-app-policy.json
{
  printf '{"Version":"2012-10-17","Statement":['
  printf '{"Effect":"Allow","Action":["s3:ListBucket","s3:GetBucketLocation"],"Resource":['
  sep=''
  for b in $buckets; do printf '%s"arn:aws:s3:::%s"' "$sep" "$b"; sep=','; done
  printf ']},{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:AbortMultipartUpload","s3:ListMultipartUploadParts"],"Resource":['
  sep=''
  for b in $buckets; do printf '%s"arn:aws:s3:::%s/*"' "$sep" "$b"; sep=','; done
  printf ']}]}\n'
} > "$policy"

mc admin policy create devhq devhq-app "$policy" >/dev/null
if ! mc admin user info devhq "$app_key" >/dev/null 2>&1; then
  mc admin user add devhq "$app_key" "$app_secret" >/dev/null
fi
if ! out=$(mc admin policy attach devhq devhq-app --user "$app_key" 2>&1); then
  case "$out" in
    *already*) ;;  # idempotent re-run
    *) echo "minio-init: policy attach failed: $out" >&2; exit 1 ;;
  esac
fi
rm -f "$policy"

echo "minio-init: buckets ready: $buckets"
