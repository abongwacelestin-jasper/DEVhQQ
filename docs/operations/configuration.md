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
  `S3_ALLOW_HTTP=1`),
- `EXPECT_REPLICAS` is above 1 without `REDIS_URL` (any environment refuses
  when `REDIS_URL` is set but unreachable with `EXPECT_REPLICAS` above 1),
- `MAIL_TRANSPORT=resend` without `RESEND_API_KEY` (or `RESEND_API_KEY_FILE`)
  or without `MAIL_FROM`, an unknown `MAIL_TRANSPORT`, or a non-`https://`
  `APP_URL` / `BRAND_LOGO_URL` / `BRAND_WEBSITE_URL` (see [Email](email.md)),
- `TURNSTILE_MODE=on` without `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`
  (or `TURNSTILE_SECRET_KEY_FILE`), or with a Cloudflare test key; an unknown
  `TURNSTILE_MODE` refuses to boot in every environment.

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
| Database | `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `DATABASE_SSL`, `DATABASE_SSL_CA`, `DATABASE_POOL_MAX`, `DATABASE_CONNECT_TIMEOUT_MS`, `DATABASE_STATEMENT_TIMEOUT_MS`, `DATA_DUAL_WRITE` (default on; `0` stops the JSONB copy of the relational tables, [ADR 0011](../architecture/adr/0011-relational-data-layer.md)) | Without `DATABASE_URL` everything is in memory. See [Storage](storage.md). In the container image, `DATABASE_MIGRATION_URL` is passed only to the migration command (`node --run migrate`); the entrypoint unsets it for everything else, so the API never holds the DDL credential. |
| Object storage | `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_ALLOW_HTTP`, `S3_BUCKET_UPLOADS`, `S3_BUCKET_BACKUPS`, `S3_BUCKET_AUDIT`, `S3_BUCKET_MODELS`, `STORAGE_LOCK_MODE`, `STORAGE_LOCAL_DIR`, `STORAGE_LOCAL_PORT` | Without `S3_ENDPOINT` a local driver is used. `STORAGE_LOCK_MODE` is the WORM mechanism the status endpoints report: `GOVERNANCE` / `COMPLIANCE` (S3 Object Lock; default `COMPLIANCE` in production) or `R2_BUCKET_LOCK` (Cloudflare R2 bucket locks, see [WORM on R2](../deploy/RAILWAY.md#worm-on-r2)). The same variable also sets the MinIO bootstrap's retention mode. |
| Backups and audit | `BACKUP_DIR`, `BACKUP_RETENTION_DAYS` (35), `AUDIT_LOG_FILE` | [Backups](backups.md), [Audit verification](audit-verification.md). |
| Redis | `REDIS_URL`, `REDIS_KEY_PREFIX` (`devhq:`), `REDIS_COMMAND_TIMEOUT_MS` (500), `EXPECT_REPLICAS` (1) | Unset `REDIS_URL` = every process keeps its own rate limits, event bus and job leases (development, tests, one replica). With it: shared rate limits, cross-replica `/api/_events` and `/api/stream` delivery, and job leases ([ADR 0009](../architecture/adr/0009-redis-for-shared-runtime-state.md)). `rediss://` turns on TLS (certificate verified). The prefix namespaces every key and channel, so environments can share one Redis. A command slower than the timeout counts as Redis being down: the API rate limiter falls back to a local bucket, auth limiters answer `503`, job runs are skipped ([Rate limiting](../security/CONTROLS.md#when-redis-is-down)). `EXPECT_REPLICAS` above 1 makes Redis mandatory: production refuses to boot without `REDIS_URL`, any environment refuses to boot when it is unreachable, and `GET /api/ready` fails while it is down. Redis 7 or later. |
| Periodic jobs | `JOBS_IN_PROCESS` (all), `WORKER_JOBS` (all), `WORKER_LOOP_ENABLED` | Which process runs the daily backup, the monitor checks and the digest, so each runs exactly once. `JOBS_IN_PROCESS` on the API: `1`/unset = all, `0` = none, or a list of `backup`, `monitors`, `digest`; an unknown name refuses to boot. `Backend/worker.ts` runs `--once backup,drill` (one-shot, e.g. a cron service) or, long-running, the jobs in `WORKER_JOBS`; each run takes a lease (Redis-backed with `REDIS_URL`), so it happens in exactly one process; in production the long-running mode needs `WORKER_LOOP_ENABLED=1` and is not safe until the data layer has cross-instance invalidation ([Railway: Jobs](../deploy/RAILWAY.md#10-jobs-where-each-periodic-job-runs)). |
| Limits | `MAX_BODY_BYTES` (256 KB) | Rate-limit numbers are constants; see [Rate limits](../api/rate-limits.md). |
| ML bridge | `ML_SERVICE_URL`, `ML_SERVICE_TOKEN` | Without the URL every insight is `source: "heuristic"` and the assistant answers `503 integration_unconfigured`. |
| Mail | `MAIL_TRANSPORT` (`resend` \| `smtp` \| `console`), `MAIL_FROM`, `MAIL_REPLY_TO`, `RESEND_API_KEY`, `RESEND_TIMEOUT_MS`, `RESEND_BASE_URL`, `APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_REQUIRE_TLS`, `MAIL_DIGEST_MINUTES` | `console` logs mail instead of sending it; production uses `resend`. Setup, DNS records and the email catalogue: [Email](email.md). |
| Bot protection | `TURNSTILE_MODE` (`off` \| `on`; default `off`), `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_FAIL_OPEN` (`0`), `TURNSTILE_EXEMPT_CLI` (`0`; `1` in production also needs `TURNSTILE_EXEMPT_CLI_ACK=bots-can-claim-cli`) | Cloudflare Turnstile on password sign-in, demo sign-in, the reset request and accept-invite. The site key is public (served by `GET /api/auth/config`); the secret supports `_FILE`. Tokens must come from `APP_ORIGIN`'s host with the form's action, and are single-use. Cloudflare unreachable → `503 turnstile_unavailable` unless `TURNSTILE_FAIL_OPEN=1` (incident switch, each pass audited). `TURNSTILE_EXEMPT_CLI=1` exempts clients that claim to be the CLI. Setup: [Railway: Cloudflare Turnstile](../deploy/RAILWAY.md#cloudflare-turnstile); design: [Security controls, C-26](../security/CONTROLS.md). |
| Brand | `BRAND_NAME`, `BRAND_LEGAL_NAME`, `BRAND_LOGO_URL`, `BRAND_LOGO_WIDTH`, `BRAND_PRIMARY_COLOR`, `BRAND_ACCENT_COLOR`, `BRAND_SUPPORT_EMAIL`, `BRAND_POSTAL_ADDRESS`, `BRAND_WEBSITE_URL` | Branding of every email. Colours are `#rrggbb`; URLs must be `https://` in production. See [Email](email.md#brand-variables). |
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

## Frontend server (Caddy)

Read by `infra/frontend/Caddyfile`, not by the SPA: `PORT` (8081),
`API_MODE` (`none`: API paths answer `404`, the Compose edge routes them;
`proxy`: same-origin reverse proxy to `API_UPSTREAM`, used on Railway),
`API_UPSTREAM` (`backend.railway.internal:8080`), `S3_PUBLIC_ORIGIN` (added to
the CSP `connect-src` and `img-src` for presigned uploads), `HSTS_VALUE` and
`MAX_BODY_SIZE` (2MB). The SPA CSP allows `https://challenges.cloudflare.com`
in `script-src` and `frame-src` for the Turnstile widget. Railway values: [RAILWAY.md §7](../deploy/RAILWAY.md#7-variables-per-service).
