# Configuration reference

The application reads its settings from environment variables at start-up; a
running process does not pick up changes. **The complete, generated list of
every variable the code reads is [Environment variables](env-vars.md)**; this
page explains the ones that matter. `.env.example` (maintained with the
Compose stack) has production-shaped defaults, and `make secrets` writes the
secret files.

In containers, secrets are passed as files: set `NAME_FILE=/run/secrets/…`
instead of `NAME` (backend: the list in `infra/docker/entrypoint.sh`; models:
`_secret()` in `Models/devhq_models/config.py`). Setting both is refused; an
empty file means "not configured". `GET /api/_config` (signed in) shows the
effective backend settings with secrets reported only as set / not set.

## Production fails closed

With `NODE_ENV=production` the backend refuses to start when:

- `SESSION_SECRET` is missing or shorter than 64 characters,
- `APP_ORIGIN`, `WEBAUTHN_RP_ID` or `DATA_ENCRYPTION_KEY` is missing,
- any `DEMO_*` variable other than `DEMO_DISABLED` is set,
- `S3_ENDPOINT` is set without both S3 keys, or is not `https://` (unless
  `S3_ALLOW_HTTP=1`).

The models service refuses authenticated routes without an `ML_SERVICE_TOKEN`
of at least 32 characters.

## Backend

| Group | Variables | Notes |
|---|---|---|
| Runtime | `NODE_ENV`, `PORT` (8080), `LOG_LEVEL`, `APP_VERSION` | `production` turns on HSTS, tight rate limits and required secrets, disables demo mode, and (with a database) never seeds demo data. Production without `DATABASE_URL` is not a supported set-up: it still loads the demo dataset into memory, with unusable passwords. |
| Origins | `APP_ORIGIN`, `PUBLIC_URL`, `CORS_ORIGINS`, `TRUST_PROXY` | `APP_ORIGIN` is the web app's public origin; it is allowed for CORS/CSRF, its host is the default WebAuthn RP ID, and invite and recovery links are built from it. Set `TRUST_PROXY=1` only behind an edge that overwrites `X-Forwarded-For` (the Compose edge does). |
| Sessions | `SESSION_SECRET`, `SESSION_SECRET_PREVIOUS`, `SESSION_IDLE_MS` (15 min), `SESSION_ABSOLUTE_MS` (12 h) | Rotation without sign-out: [rotate-session-secret.md](../../infra/scripts/rotate-session-secret.md). |
| WebAuthn | `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ALGORITHMS` | RP ID is the registrable domain (no IP addresses). Supported algorithms: ES256, EdDSA, RS256. |
| Encryption | `DATA_ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEYS_PREVIOUS` | 32-byte hex AES-256-GCM key for TOTP secrets, integration credentials and backups. Outside production a key is derived from the session secret. |
| Database | `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `DATABASE_SSL`, `DATABASE_SSL_CA`, `DATABASE_POOL_MAX`, `DATABASE_CONNECT_TIMEOUT_MS`, `DATABASE_STATEMENT_TIMEOUT_MS` | Without `DATABASE_URL` everything is in memory. See [Storage](storage.md). |
| Object storage | `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_ALLOW_HTTP`, `S3_BUCKET_UPLOADS`, `S3_BUCKET_BACKUPS`, `S3_BUCKET_AUDIT`, `S3_BUCKET_MODELS`, `STORAGE_LOCAL_DIR`, `STORAGE_LOCAL_PORT` | Without `S3_ENDPOINT` a local driver is used. |
| Backups and audit | `BACKUP_DIR`, `BACKUP_RETENTION_DAYS` (35), `AUDIT_LOG_FILE` | [Backups](backups.md), [Audit verification](audit-verification.md). |
| Limits | `MAX_BODY_BYTES` (256 KB) | Rate-limit numbers are constants; see [Rate limits](../api/rate-limits.md). |
| ML bridge | `ML_SERVICE_URL`, `ML_SERVICE_TOKEN` | Without the URL every insight is `source: "heuristic"` and the assistant answers `503 integration_unconfigured`. |
| Mail | `MAIL_TRANSPORT` (`smtp` \| `console`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_REQUIRE_TLS`, `MAIL_DIGEST_MINUTES` | `console` logs mail instead of sending it. |
| GitHub | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_TOKEN` | App credentials → live data; webhook secret only → webhook-only; nothing set → demo data outside production, `503 integration_unconfigured` in production. |
| Realtime | `STREAM_HEARTBEAT_MS` | Heartbeat of `GET /api/stream`. |
| Demo (non-production only) | `DEMO_DISABLED`, `DEMO_PASSWORD` (`devhq-demo`), `DEMO_MFA_CODE` (`246810`), `DEMO_TOTP_SECRET` | See [Known limits](known-limits.md#disable-demo-mode-on-anything-internet-facing). |

## Models service

`ML_SERVICE_TOKEN`, `MODEL_SIGNING_KEY`, `MODEL_DIR`, `ML_BOOTSTRAP_SYNTHETIC`,
`BACKEND_URL`, `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL` (`claude-sonnet-5-5`),
`ASSISTANT_MAX_TOKENS`, `ASSISTANT_TIMEOUT_SECONDS`, `ASSISTANT_FALLBACKS`,
`ML_TRAIN_THREADS`, `ML_MAX_SKEW_SECONDS`, `ML_MAX_BODY_BYTES`, the `S3_*`
connection variables and `S3_BUCKET_MODELS`. Meanings and defaults:
[Models/README.md](../../Models/README.md#configuration).

## Frontend

| Variable | Where | Notes |
|---|---|---|
| `VITE_API_BASE` | build time | Leave empty. The session cookie is host-only and `SameSite=Strict`, so the API must be on the app's origin. |
| `DEVHQ_API_URL` | Vite dev server | Target of the `/api` dev proxy (default `http://127.0.0.1:8080`). |

## Compose and edge

`DEVHQ_DOMAIN`, `ACME_EMAIL`, `DEVHQ_IMAGE_PREFIX`, `DEVHQ_TAG`,
`DEVHQ_SECRETS_GID`, `EDGE_*` and similar are read by Compose and the edge, not
by the application. They are listed at the end of [env-vars.md](env-vars.md) and
explained in the [runbook](../deploy/RUNBOOK.md).
