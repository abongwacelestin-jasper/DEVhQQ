# Configuration reference

Every environment variable the code reads today, found by searching
`process.env` across `Backend/` and `import.meta.env` / `process.env` across
`Frontend/`. Most backend settings are loaded once at start-up by
`Backend/config/env.ts`; a running process does not pick up changes.
`GET /api/_config` (signed in) shows the effective values with secrets reported
only as set / not set.

The repository's `.env.example` is out of date and is being rewritten by the
INFRA lane; the API does not read a `.env` file itself — export the variables
in the shell or the container.

## Backend

| Variable | Default (non-production) | Production | Read in | Notes |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `production` | `config/env.ts`, `store/db.ts` | `production` turns on HSTS and `upgrade-insecure-requests`, tight rate limits, required secrets, and disables demo mode. |
| `PORT` | `8080` | — | `config/env.ts` | positive integer |
| `APP_ORIGIN` | `http://localhost:5173` | **required** | `config/env.ts` | Public origin of the web app. Allowed for CORS/CSRF; its hostname is the default WebAuthn RP ID. |
| `PUBLIC_URL` | `http://localhost:<PORT>` | — | `config/env.ts`, `routes/codespaces.routes.ts` | Public URL of the API; in the allow-list, OpenAPI `servers` and the Codespaces OAuth redirect. |
| `CORS_ORIGINS` | empty | — | `config/env.ts` | Comma-separated extra allowed origins. Outside production `http://localhost:<PORT>` and `http://127.0.0.1:<PORT>` are always allowed. |
| `TRUST_PROXY` | unset | set to `1` behind your edge | `lib/http.ts` | When `1`, the client IP is the first `X-Forwarded-For` entry. Only set it if a proxy you control overwrites that header. |
| `SESSION_SECRET` | built-in dev key | **required**, ≥ 64 characters | `config/env.ts` | HMAC key for session tokens. Generate with `openssl rand -hex 32`. |
| `SESSION_SECRET_PREVIOUS` | unset | during rotation | `config/env.ts` | Accepted for verification only, so tokens signed with the old key keep working while you rotate. |
| `SESSION_IDLE_MS` | `900000` (15 min) | — | `config/env.ts` | After this much inactivity a session needs step-up. |
| `SESSION_ABSOLUTE_MS` | `43200000` (12 h) | — | `config/env.ts` | Hard session lifetime; also the cookie `Max-Age`. |
| `MAX_BODY_BYTES` | `262144` (256 KB) | — | `config/env.ts` | Larger bodies get `413`. |
| `WEBAUTHN_RP_ID` | hostname of `APP_ORIGIN` | **required** | `config/env.ts` | Registrable domain for passkeys, e.g. `devhq.example`. Cannot be an IP address. |
| `WEBAUTHN_RP_NAME` | `DevHQ` | — | `config/env.ts` | |
| `APP_VERSION` | `1.4.0` | set by the build | `config/env.ts` | Reported by `/api/version` and OpenAPI. |
| `BACKUP_DIR` | `./.backups` | WORM storage | `config/env.ts` | Relative to the working directory. |
| `BACKUP_RETENTION_DAYS` | `35` | — | `config/env.ts` | Older snapshots are pruned after each daily backup. |
| `AUDIT_LOG_FILE` | `./.audit/audit.jsonl` | durable, append-only volume | `audit/auditLog.ts` | Directory is created if missing. |
| `LOG_LEVEL` | `info` | — | `lib/logger.ts` | `debug`, `info`, `warn`, `error`. |
| `DEMO_DISABLED` | unset | — | `store/db.ts` | `1` disables demo mode outside production. Demo mode is always off in production. |
| `DEMO_PASSWORD` | `devhq-demo` | ignored | `store/db.ts` | Password of every seeded member in demo mode. |
| `DEMO_MFA_CODE` | `246810` | ignored | `store/db.ts` | Shared TOTP code accepted in demo mode. |
| `DEMO_TOTP_SECRET` | unset | — | `store/db.ts` | Base32 TOTP secret given to every seeded member, so a real authenticator app can be used. |
| `GITHUB_TOKEN` | unset | — | `routes/codespaces.routes.ts` | Server-side GitHub user token with the `codespace` permission. Without it Codespaces routes answer `401 github_auth`. |
| `GITHUB_CLIENT_ID` | unset | — | `routes/codespaces.routes.ts` | Without it `GET /api/codespaces/oauth/url` answers `501 not_configured`. |

Production start fails fast with a clear message if `SESSION_SECRET`,
`APP_ORIGIN` or `WEBAUTHN_RP_ID` is missing, or if `SESSION_SECRET` is too
short ([Troubleshooting](../getting-started/troubleshooting.md#missing-required-environment-variable-)).

Not configurable: rate-limit numbers, lockout (5 failures / 15 min), JIT
maximum (8 h), invite lifetime (7 days), step-up window (5 min). They are
constants in the code.

## Frontend

| Variable | Where | Default | Notes |
|---|---|---|---|
| `VITE_API_BASE` | `Frontend/src/api/client.ts` (build time) | empty — same origin | Prefix for API calls. Leave empty: the session cookie is host-only and `SameSite=Strict`, so the API must be on the app's origin. |
| `DEVHQ_API_URL` | `Frontend/vite.config.ts` (dev server only) | `http://127.0.0.1:8080` | Target of the `/api` dev proxy. |

## Planned variables

> [!NOTE]
> **Planned: Wave 4.** From `docs/agents/WAVE4.md` §4 — not read by any code
> yet. INFRA writes the new `.env.example`.
>
> | Variables | Lane | Purpose |
> |---|---|---|
> | `DATA_ENCRYPTION_KEY` | SEC | 32-byte hex, AES-256-GCM for TOTP secrets and tokens at rest |
> | `DATABASE_URL`, `DATABASE_SSL` | B-DATA | PostgreSQL; without it everything stays in memory |
> | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_BUCKET_UPLOADS`, `S3_BUCKET_BACKUPS`, `S3_BUCKET_AUDIT`, `S3_BUCKET_MODELS` | STORAGE, ML | object storage (MinIO at `http://minio:9000` locally) |
> | `ML_SERVICE_URL`, `ML_SERVICE_TOKEN` | ML | Python service (`http://models:8000`) and its HMAC secret |
> | `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL` | ML (Python only) | assistant answers; never exposed to the browser |
> | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `MAIL_TRANSPORT` | B-COLLAB | email; `console` transport in development |
> | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_SECRET` | B-DOMAIN | GitHub App; demo fallback when unset |
>
> Every optional integration must degrade gracefully when its variables are
> missing.
