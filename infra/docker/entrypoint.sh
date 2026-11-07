#!/bin/sh
# DevHQ container entrypoint: load file-based secrets into the environment.
#
# Docker Compose mounts secrets as files under /run/secrets. The backend reads
# configuration from environment variables only, so for every name in
# SECRET_VARS this script reads `${NAME}_FILE` (when set) and exports `NAME`.
#
#   - `${NAME}_FILE` set but unreadable  -> exit 1 (fail closed).
#   - both `NAME` and `${NAME}_FILE` set -> exit 1 (ambiguous configuration).
#   - file present but empty              -> `NAME` stays unset, so optional
#     integrations degrade to `503 integration_unconfigured` instead of
#     running with an empty credential.
#
# The list is explicit on purpose: a generic `*_FILE` sweep would also catch
# ordinary path settings such as AUDIT_LOG_FILE.
#
# Once the app reads `*_FILE` itself (requested from the coordinator) this
# script becomes a no-op and can be removed.
set -eu

SECRET_VARS="
SESSION_SECRET
SESSION_SECRET_PREVIOUS
DATA_ENCRYPTION_KEY
DATABASE_URL
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
ML_SERVICE_TOKEN
ANTHROPIC_API_KEY
SMTP_PASSWORD
GITHUB_APP_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
GITHUB_CLIENT_SECRET
GITHUB_TOKEN
DEMO_PASSWORD
DEMO_TOTP_SECRET
"

for name in $SECRET_VARS; do
  file_var="${name}_FILE"
  eval "file=\${$file_var:-}"
  [ -n "$file" ] || continue

  eval "direct=\${$name:-}"
  if [ -n "$direct" ]; then
    echo "entrypoint: both $name and $file_var are set; refusing to guess" >&2
    exit 1
  fi
  if [ ! -r "$file" ]; then
    echo "entrypoint: $file_var points at unreadable file $file" >&2
    exit 1
  fi

  # $(...) strips trailing newlines; interior newlines (PEM keys) are kept.
  value=$(cat "$file")
  unset "$file_var"
  if [ -n "$value" ]; then
    export "$name=$value"
  fi
done
unset name file_var file direct value SECRET_VARS

exec "$@"
