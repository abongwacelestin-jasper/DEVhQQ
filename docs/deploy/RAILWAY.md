# DevHQ on Railway, with Cloudflare R2

Production hosting on [Railway](https://railway.com), object storage on
Cloudflare R2, DNS and the public edge on Cloudflare. The Compose stack in
[RUNBOOK.md](RUNBOOK.md) stays the local and single-host option; both use the
same images.

Everything here was built and checked locally (images built, the frontend
image smoke-run, the worker run against PostgreSQL 17 with the roles below,
`setup.sh --dry-run`). Nothing was run against a real Railway or Cloudflare
account. Steps that depend on Railway or Cloudflare behaviour that could not
be tested offline are marked **verify** and are on the
[go-live checklist](#15-go-live-checklist).

Contents: [1 Topology](#1-topology) · [2 Decisions](#2-decisions) ·
[3 Prerequisites](#3-prerequisites) · [4 Object storage on R2](#4-object-storage-on-r2) ·
[5 Provision](#5-provision-the-project) · [6 Database roles](#6-database-roles) ·
[7 Variables](#7-variables-per-service) · [8 Domain and DNS](#8-custom-domain-and-dns-on-cloudflare) ·
[9 First deploy](#9-first-deploy-and-the-first-owner) · [10 Jobs](#10-jobs-where-each-periodic-job-runs) ·
[11 Scaling](#11-scaling) · [12 Backups](#12-backups-and-restore) ·
[13 Rollback](#13-rollback) · [14 Cost](#14-cost-estimate) ·
[15 Go-live checklist](#15-go-live-checklist) · [16 CI changes](#16-ci-changes-to-make-on-github)

## 1. Topology

Seven services. The diagram is in
[ARCHITECTURE.md](ARCHITECTURE.md#railway-topology).

| # | Service | Image / source | Public | Config |
|---|---|---|---|---|
| 1 | `frontend` | `Frontend/Dockerfile` (Caddy 2.11, static SPA) | yes: the custom domain | [`frontend.railway.json`](../../infra/railway/frontend.railway.json) |
| 2 | `backend` | `Backend/Dockerfile` (API, default command) | no | [`backend.railway.json`](../../infra/railway/backend.railway.json) |
| 3 | `worker` | same image, `worker.ts` | no | [`worker.railway.json`](../../infra/railway/worker.railway.json) (phase 2) |
| 4 | `cron` | same image, `worker.ts --once backup,drill` | no | [`cron.railway.json`](../../infra/railway/cron.railway.json) |
| 5 | `models` | `Models/Dockerfile` (FastAPI) | no | [`models.railway.json`](../../infra/railway/models.railway.json) |
| 6 | `Postgres` | Railway PostgreSQL | no (remove the TCP proxy after setup) | plugin |
| 7 | `Redis` | Railway Redis | no | plugin |

Request path: browser → Cloudflare (proxied, TLS Full (strict)) → Railway
edge (TLS) → `frontend` → for `/api/*`, `/console`, `/backend.html`:
`backend.railway.internal:8080` over private networking. The SPA and the API
share one origin, so the `__Host-` `SameSite=Strict` session cookie works and
there is no CORS. Browsers upload and download files directly to R2 with
presigned URLs.

## 2. Decisions

**No separate edge (Caddy) service.** On Compose the edge terminates TLS,
sets HSTS, caps bodies and routes `/api`. On Railway, Railway and Cloudflare
terminate TLS, and the frontend's Caddy does the rest:
[`infra/frontend/Caddyfile`](../../infra/frontend/Caddyfile) with
`API_MODE=proxy` reverse-proxies the API paths, overwrites
`X-Forwarded-For`, caps request bodies at 2 MB, flushes server-sent events
immediately and sets HSTS and the SPA's CSP. An extra hop would add latency,
cost and a second public service for nothing. No eighth service is needed:
seven are enough.

**One frontend image for both deployments.** The frontend runtime moved from
nginx to Caddy so the same image serves Compose (behind the edge, API paths
answer `404`) and Railway (`API_MODE=proxy`). Caddy serves pre-compressed
Brotli and gzip files built by
[`precompress.mjs`](../../infra/frontend/precompress.mjs), reads `PORT`, and
runs as uid 10003 with its file capability stripped (so Compose's
`cap_drop: [ALL]` still works). `infra/nginx/` is gone.

**Client IP.** The backend (`TRUST_PROXY=1`) takes the first
`X-Forwarded-For` entry, so the frontend must hand it exactly one trusted
value. Caddy walks `X-Forwarded-For` right to left and skips only trusted
hops (private, carrier-grade NAT and Cloudflare's published ranges); when
every hop is trusted it uses Cloudflare's `CF-Connecting-IP`. A
client-supplied `X-Forwarded-For` or a forged `CF-Connecting-IP` sent straight
to Railway is never taken as the client IP, provided Railway's edge records
the real sender in `X-Forwarded-For` (**verify**, checklist item 9). The
Cloudflare ranges are in the Caddyfile; refresh them from
<https://www.cloudflare.com/ips/> when Cloudflare changes them.

**Cron instead of an in-process timer for backups.** The API's daily backup
is a `setInterval` that restarts with the process, and production skips the
boot-time backup, so a service deployed more often than once a day would
never back up. The cron service runs `worker.ts --once backup,drill` at
03:17 UTC: a fresh process hydrates from PostgreSQL (a consistent snapshot as
of the last flush), takes the encrypted backup, verifies and decrypts it
(restore drill), flushes its audit entries and exits. Railway bills only the
minute it runs, a failed run is a failed deployment you can alert on, and it
connects as a read-only database role, so it cannot write collections even by
accident. Digests are **not** moved to cron: they write `emailedAt` on
notifications, see [section 10](#10-jobs-where-each-periodic-job-runs).

**The long-running worker is phase 2.** It exists, is tested and is
provisioned, but is not deployed yet: see section 10.

**Backend volume.** `/var/lib/devhq` is a Railway volume (the local audit
JSONL copy). A service with a volume is redeployed stop-then-start, never two
copies at once, which is what the in-memory data layer needs (section 11).
Railway mounts volumes as root, so the backend sets `RAILWAY_RUN_UID=0`; the
entrypoint fixes the volume's ownership and drops to uid 10001 with `su-exec`
before anything else runs. Only `tini` (PID 1) stays root.

## 3. Prerequisites

- **Railway** account on the **Pro** plan (needed for outbound SMTP, volume
  backups and more than the Hobby resource limits), and the CLI:
  `npm i -g @railway/cli` (v4), `railway login`. A Railway API token
  (Account Settings → Tokens) for `setup.sh`.
- **Cloudflare** account with **R2** enabled (a payment method is required
  even inside the free tier) and the domain's zone on Cloudflare DNS. An API
  token with *Workers R2 Storage: Edit* for `r2-setup.sh`.
- **Resend** account with the sending domain verified (SPF, DKIM, and a DMARC
  record on Cloudflare DNS). See [Mail](#mail-resend).
- A **domain**, e.g. `app.example.com` for the app.
- Locally: `jq`, `curl`, `openssl`, `psql` ≥ 15 (for the roles script).
- The repository connected to Railway's GitHub app (Railway → Account →
  GitHub).

## 4. Object storage on R2

### Buckets

| Bucket | Used by | Lock (WORM) | Lifecycle |
|---|---|---|---|
| `devhq-uploads` | user files (`pending/` while uploading, `files/` once verified) | none | `pending/` deleted after 1 day; incomplete multipart aborted after 1 day |
| `devhq-backups` | encrypted app snapshots and manifests | 35 days (`BACKUP_RETENTION_DAYS`) | deleted after 36 days |
| `devhq-audit` | audit chain batches | 365 days (`AUDIT_RETENTION_DAYS`) | kept (no expiry) |
| `devhq-models` | the ML model registry | none | incomplete multipart aborted after 1 day |

[`infra/railway/r2-setup.sh`](../../infra/railway/r2-setup.sh) creates them
and applies CORS, lifecycle and lock rules through the Cloudflare API
(`--dry-run` prints every request body first). It also turns off each
bucket's public `r2.dev` URL: objects are only ever reached with presigned
URLs. For an EU-jurisdiction account set `R2_JURISDICTION=eu`; the S3
endpoint becomes `https://<account>.eu.r2.cloudflarestorage.com`.

```bash
CLOUDFLARE_API_TOKEN=… R2_ACCOUNT_ID=… DEVHQ_DOMAIN=app.example.com \
  infra/railway/r2-setup.sh --dry-run
infra/railway/r2-setup.sh            # same variables
```

### Credentials

Create two R2 API tokens in the dashboard (R2 → Manage API tokens), both
*Object Read & Write*, each limited to specific buckets. Copy the Access Key
ID and Secret Access Key (shown once):

| Token | Buckets | Given to |
|---|---|---|
| `devhq-backend` | uploads, backups, audit | backend, cron, worker (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`) |
| `devhq-models` | models | models |

R2 tokens cannot express MinIO's "put but never delete" policy
(`infra/minio/bootstrap.sh`): within its buckets the backend token can delete.
The bucket locks below are what keeps backups and audit batches.

### Connection settings

`S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` are both
`https://<account>.r2.cloudflarestorage.com`, `S3_REGION=auto`,
`S3_FORCE_PATH_STYLE=true`. They are the same host because R2 presigned URLs
only work on the S3 API host, not on custom domains, and the SigV4 signature
covers the host. The in-house signer (`Backend/storage/sigv4.ts`) works with
R2 unchanged; the app never sends Object Lock or SSE headers, which R2 does
not implement.

### CORS for presigned browser uploads

On `devhq-uploads` only (the other buckets are never used from a browser):

```json
{ "rules": [ {
  "id": "devhq-presigned",
  "allowed": { "origins": ["https://app.example.com"], "methods": ["PUT", "GET", "HEAD"], "headers": ["content-type"] },
  "exposeHeaders": ["ETag"],
  "maxAgeSeconds": 600
} ] }
```

The browser sends only `Content-Type` (signed) and the body; its
`Content-Length` is signed too, so a body of any other size is refused. The
frontend adds the R2 origin to its CSP `connect-src` and `img-src`
(`S3_PUBLIC_ORIGIN`); without that the browser blocks the upload before CORS
is even consulted.

### WORM on R2

The code was written for S3 Object Lock. R2 does not implement the Object
Lock API; it has **bucket lock rules** instead. What that means, honestly:

| | S3 Object Lock, COMPLIANCE | R2 bucket lock rule |
|---|---|---|
| Delete or overwrite a locked object with any API token | refused | refused |
| Shorten or remove the retention | impossible, even for the account root | **possible** for an account member with R2 admin rights (dashboard or an admin token): remove the rule, then delete |
| Per-object retention dates, legal hold | yes | no: rules apply by prefix and object age |
| Versioning (an overwrite keeps the old version) | yes | no (the lock prevents the overwrite instead) |

So R2 bucket locks protect backups and the audit archive against the
application's own credential and anyone who steals it, which is the threat
the design is built around. They do **not** protect against a compromised or
malicious Cloudflare account administrator: that is closer to S3's
GOVERNANCE mode than to COMPLIANCE. To stop the status endpoints from claiming
COMPLIANCE, the backend now reports the real mechanism:
`STORAGE_LOCK_MODE=R2_BUCKET_LOCK` makes `GET /api/storage/status` and
`GET /api/backups/status` say `"lockMode": "R2_BUCKET_LOCK"`
(`Backend/storage/index.ts`; any other value than `GOVERNANCE`,
`COMPLIANCE`, `R2_BUCKET_LOCK` refuses to boot).

Compensating controls:

- Keep the Cloudflare account small: only named people, hardware-key 2FA,
  no shared logins. Do not create R2 *Admin* tokens for automation; the
  `r2-setup.sh` token can be deleted after setup.
- Cloudflare's account audit log records lock-rule changes. Review it
  monthly, or stream it to an external log store.
- The audit chain is tamper-evident on its own: each batch carries the hash
  it chains from, so a deleted or altered batch shows up when verifying
  ([Audit verification](../operations/audit-verification.md)). The
  append-only `audit_entries` table in PostgreSQL is a second copy.
- Railway's PostgreSQL backups ([section 12](#12-backups-and-restore)) are an
  independent recovery point that a Cloudflare account compromise cannot
  touch.
- For COMPLIANCE-grade immutability, point `S3_BUCKET_BACKUPS` and
  `S3_BUCKET_AUDIT` at AWS S3 buckets with Object Lock in a separate AWS
  account ([infra/minio/README.md](../../infra/minio/README.md#aws-s3-equivalents));
  the code already supports it. That needs a second credential pair, which
  the app does not support yet (one `S3_*` set for all buckets).

### Encryption at rest

R2 encrypts every object at rest (AES-256) with Cloudflare-managed keys.
There are no customer-managed keys (no SSE-KMS); SSE-C exists but the app
does not use it. Backups are encrypted by the app with `DATA_ENCRYPTION_KEY`
(AES-256-GCM) before upload, and TOTP seeds and integration credentials are
sealed in the database. User uploads rely on R2's encryption only. Keep
`DATA_ENCRYPTION_KEY` in a password manager: without it no backup can be
restored.

## 5. Provision the project

[`infra/railway/setup.sh`](../../infra/railway/setup.sh) creates the project,
the Postgres and Redis plugins, the five application services, their
settings (config-as-code file, root directory), the backend volume, shared
and per-service variables (with `${{…}}` references), the custom domain, and
finally connects the repository, which triggers the first deploys. It is safe
to re-run: what exists is kept, and generated secrets are only created when
missing, never rotated.

```bash
railway login
export RAILWAY_API_TOKEN=…            # or let the script prompt (hidden input)
export DEVHQ_DOMAIN=app.example.com GITHUB_REPO=owner/devhq DEPLOY_BRANCH=main
export R2_ACCOUNT_ID=…
infra/railway/setup.sh --dry-run      # prints every step, changes nothing
infra/railway/setup.sh                # prompts for the R2 keys, Anthropic and Resend keys
```

Secrets come from the environment or hidden prompts, are sent to Railway's
API on stdin (never on a command line), and are generated with
`openssl rand -hex 32`: `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`,
`ML_SERVICE_TOKEN`, `MODEL_SIGNING_KEY` and the three database passwords.
After the first run, mark the secret shared variables as **sealed** in the
dashboard (Project Settings → Shared Variables → ⋮ → Seal), and copy
`DATA_ENCRYPTION_KEY` to your password manager.

What the script does through the CLI versus the GraphQL API is listed at its
top. The CLI flags and API fields match Railway's CLI v4 and public API as
documented; they were exercised in `--dry-run` only (**verify** on the first
real run; if a step fails, the dashboard equivalent is in the same section of
this page).

Dashboard equivalent, per service (Settings): *Source* → the repository and
branch; *Config-as-code* → `/infra/railway/<service>.railway.json` (an
absolute path from the repository root); *Root directory* → `/` except
`models` → `/Models`; *Networking* → no public domain except `frontend`.
Turn on **Wait for CI** for every service so Railway deploys only commits
whose GitHub checks passed.

## 6. Database roles

The plugin's `postgres` superuser and its `DATABASE_URL` are never given to
an application service. [`infra/railway/postgres-roles.sql`](../../infra/railway/postgres-roles.sql)
creates three roles (passwords from the shared variables `APP_DB_PASSWORD`,
`MIGRATOR_DB_PASSWORD`, `JOBS_DB_PASSWORD`):

| Role | Used by | Can |
|---|---|---|
| `devhq_migrator` | the backend's pre-deploy `node --run migrate` (`DATABASE_MIGRATION_URL`) | own the `public` schema, run DDL |
| `devhq_app` | the API, and the worker in phase 2 (`DATABASE_URL`) | read and write rows; no DDL; no `UPDATE`/`DELETE` on `audit_entries`, no writes to `schema_migrations` |
| `devhq_jobs` | the cron service (`DATABASE_URL`) | read rows, insert audit rows; nothing else |

Run it **before the first deploy** and **again after it** (the second run
grants on the tables the first migration created):

```bash
infra/railway/setup.sh --db-roles     # reads the passwords from Railway, runs the script via `railway connect Postgres`
# or by hand:
railway connect Postgres              # psql as postgres
\i infra/railway/postgres-roles.sql   # with DEVHQ_APP_DB_PASSWORD, DEVHQ_MIGRATOR_DB_PASSWORD, DEVHQ_JOBS_DB_PASSWORD exported
```

`railway connect` uses the plugin's public TCP proxy. When the roles are in
place, remove the proxy (Postgres → Settings → Networking) and add it back
only for maintenance. Checked locally against PostgreSQL 17: the migrator
applies both migrations, `devhq_app` gets `permission denied for schema
public` on `CREATE TABLE` and `permission denied` on `DELETE FROM
audit_entries`, and `devhq_jobs` cannot `UPDATE documents` but the cron run
succeeds.

Migrations run as `deploy.preDeployCommand` (`node --run migrate`) before
each new backend deployment starts; a failed migration stops the deploy and
the old one keeps running. The runtime never holds the migrator credential:
`infra/docker/entrypoint.sh` unsets `DATABASE_MIGRATION_URL` for every
command except the migration itself. Migrations must stay expand/contract
([RUNBOOK §2](RUNBOOK.md#2-routine-deploys)) because a rollback runs older
code against the migrated schema.

Private networking (`postgres.railway.internal`) is encrypted by Railway, so
`DATABASE_SSL=disable` is set and the backend logs one `db.tls_disabled`
warning at boot. If you prefer TLS on top, set `DATABASE_SSL=require`
(**verify** that the plugin accepts TLS on the private address first).

## 7. Variables per service

Every variable the code reads is listed in
[Environment variables](../operations/env-vars.md) and explained in the
[Configuration reference](../operations/configuration.md). On Railway the
values are plain variables (no `*_FILE` secrets). `setup.sh` sets all of
these; `${{shared.X}}` is a shared variable, `${{Service.X}}` a reference.

### Shared variables

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_ORIGIN`, `PUBLIC_URL` | `https://app.example.com` |
| `WEBAUTHN_RP_ID` | `app.example.com` (or the registrable parent domain, decided once: passkeys are bound to it) |
| `WEBAUTHN_RP_NAME` | `DevHQ` |
| `LOG_LEVEL` | `info` |
| `DEMO_DISABLED` | `1` |
| `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_FORCE_PATH_STYLE` | `true` |
| `S3_BUCKET_UPLOADS` / `_BACKUPS` / `_AUDIT` / `_MODELS` | `devhq-uploads` / `devhq-backups` / `devhq-audit` / `devhq-models` |
| `STORAGE_LOCK_MODE` | `R2_BUCKET_LOCK` |
| `BACKUP_RETENTION_DAYS` | `35` (keep equal to the backups bucket lock) |
| `R2_BACKEND_ACCESS_KEY_ID`, `R2_BACKEND_SECRET_ACCESS_KEY` | the `devhq-backend` R2 token (secret) |
| `SESSION_SECRET`, `DATA_ENCRYPTION_KEY` | generated, 64 hex (secret) |
| `ML_SERVICE_TOKEN`, `MODEL_SIGNING_KEY` | generated (secret) |
| `APP_DB_PASSWORD`, `MIGRATOR_DB_PASSWORD`, `JOBS_DB_PASSWORD` | generated (secret) |

### `backend`

All of the shared runtime settings by reference (`NODE_ENV`, `APP_ORIGIN`,
`PUBLIC_URL`, `WEBAUTHN_*`, `LOG_LEVEL`, `DEMO_DISABLED`, `SESSION_SECRET`,
`DATA_ENCRYPTION_KEY`, `S3_*`, `STORAGE_LOCK_MODE`, `BACKUP_RETENTION_DAYS`),
`APP_VERSION=${{RAILWAY_GIT_COMMIT_SHA}}`, and:

| Variable | Value |
|---|---|
| `PORT` | `8080` |
| `TRUST_PROXY` | `1` (the frontend overwrites `X-Forwarded-For`) |
| `RAILWAY_RUN_UID` | `0` (volume ownership; the entrypoint drops to 10001) |
| `JOBS_IN_PROCESS` | `monitors,digest` (backups run in cron) |
| `DATABASE_URL` | `postgresql://devhq_app:${{shared.APP_DB_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` |
| `DATABASE_MIGRATION_URL` | same with `devhq_migrator:${{shared.MIGRATOR_DB_PASSWORD}}` (pre-deploy only) |
| `DATABASE_SSL` | `disable` (private network) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `${{shared.R2_BACKEND_ACCESS_KEY_ID}}`, `${{shared.R2_BACKEND_SECRET_ACCESS_KEY}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}`: shared rate limits, event fan-out and job leases ([Scaling](#11-scaling)). Plain `redis://` on the private network; use `rediss://` for an external Redis |
| `EXPECT_REPLICAS` | unset (1). Set it to the replica count *before* raising replicas: above 1, the backend refuses to boot without Redis and fails readiness while Redis is down |
| `ML_SERVICE_URL` | `http://${{models.RAILWAY_PRIVATE_DOMAIN}}:8000` |
| `ML_SERVICE_TOKEN` | `${{shared.ML_SERVICE_TOKEN}}` |
| `MAIL_TRANSPORT`, `SMTP_*`, `MAIL_DIGEST_MINUTES` | see [Mail](#mail-resend) |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_TOKEN` | optional, set by hand when the GitHub App exists |

### `cron`

The shared runtime settings and R2 credentials as for the backend, plus
`DATABASE_URL` as `devhq_jobs:${{shared.JOBS_DB_PASSWORD}}` and
`DATABASE_POOL_MAX=3`. Schedule `17 3 * * *` (UTC) and restart policy
*never* are in `cron.railway.json`. No `PORT`, no domain, no volume.

### `worker` (phase 2)

As the backend without `PORT`, `TRUST_PROXY`, `RAILWAY_RUN_UID` and
`DATABASE_MIGRATION_URL`, plus `WORKER_JOBS=monitors,digest` and
`WORKER_LOOP_ENABLED=0` (set to `1` only in phase 2, section 10).

### `frontend`

| Variable | Value |
|---|---|
| `PORT` | `8081` |
| `API_MODE` | `proxy` |
| `API_UPSTREAM` | `${{backend.RAILWAY_PRIVATE_DOMAIN}}:8080` |
| `S3_PUBLIC_ORIGIN` | `https://<account>.r2.cloudflarestorage.com` (CSP) |
| `HSTS_VALUE` | `max-age=63072000; includeSubDomains; preload` (lower it while testing; `includeSubDomains` covers every subdomain of the app host) |
| `MAX_BODY_SIZE` | optional, default `2MB` |

### `models`

`NODE_ENV=production`, `HOST=::` (Railway's private network is reachable over
IPv6; uvicorn then listens on IPv6 only, so the Dockerfile's IPv4
`HEALTHCHECK` does not apply on Railway and `models.railway.json` has no
health check), `PORT=8000`, `ML_SERVICE_TOKEN` and `MODEL_SIGNING_KEY` by
reference, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`,
`S3_BUCKET_MODELS`, the `devhq-models` token as `S3_ACCESS_KEY_ID` /
`S3_SECRET_ACCESS_KEY`, and optionally `ANTHROPIC_API_KEY`,
`ASSISTANT_MODEL`. The service has no public domain.

### Mail (Resend)

DevHQ sends through Resend's HTTP API (`MAIL_TRANSPORT=resend`), so it works
on every Railway plan (no outbound SMTP needed). Give `setup.sh` a
`RESEND_API_KEY` and it sets, on backend and worker:

| Variable | Value |
|---|---|
| `MAIL_TRANSPORT` | `resend` (without a key: `console`, mail is logged, not sent) |
| `RESEND_API_KEY` | the Resend API key (secret; seal it in the dashboard) |
| `MAIL_FROM` | e.g. `DevHQ <no-reply@mail.example.com>`; required, production refuses to boot without it |
| `APP_URL` | `https://<your domain>`, used for every link in emails |
| `MAIL_REPLY_TO` | optional |
| `BRAND_*` | optional: `BRAND_NAME`, `BRAND_LEGAL_NAME`, `BRAND_LOGO_URL`, `BRAND_PRIMARY_COLOR`, `BRAND_ACCENT_COLOR`, `BRAND_SUPPORT_EMAIL`, `BRAND_POSTAL_ADDRESS`, `BRAND_WEBSITE_URL`; export them before running `setup.sh` |
| `MAIL_DIGEST_MINUTES` | optional, `1440` daily or `10080` weekly |

Domain verification (SPF, DKIM, DMARC), the brand variables, previews
(`npm run mail:preview`) and troubleshooting are in
[Email](../operations/email.md).

### Cloudflare Turnstile

Optional bot protection on the public auth forms: password sign-in,
the password reset request and invite acceptance (and demo sign-in, which
production never has). Off by default (`TURNSTILE_MODE=off`). How it works
and what is exempt: [Security controls, C-26](../security/CONTROLS.md).

1. **Create the widget.** Cloudflare dashboard → Turnstile → *Add widget*.
   Name it `DevHQ`, choose **Managed** as the widget mode, and leave
   *pre-clearance* off.
2. **Hostnames.** Add the app's host exactly as in `APP_ORIGIN`, e.g.
   `app.example.com`. The backend refuses a token whose `hostname` is not
   `APP_ORIGIN`'s host, so a widget used on another site cannot sign in
   here. Add a staging host as a separate widget (or hostname) if you have
   one.
3. **Keys as Railway variables**, on `backend` only (the frontend reads the
   site key from `GET /api/auth/config`, so it needs no variable):

   | Variable | Value |
   |---|---|
   | `TURNSTILE_MODE` | `on` |
   | `TURNSTILE_SITE_KEY` | the widget's *Site key* (public) |
   | `TURNSTILE_SECRET_KEY` | the widget's *Secret key* (secret; seal it in the dashboard) |
   | `TURNSTILE_FAIL_OPEN` | leave unset. `1` only during a Cloudflare incident (see below) |
   | `TURNSTILE_EXEMPT_CLI` | leave unset (`1`), or `0` if nobody signs in with a password from the CLI |

   With `TURNSTILE_MODE=on` and either key missing, or with one of
   Cloudflare's test keys, production refuses to boot, so a typo shows up as
   a failed deploy, not as an open form.
4. **CSP.** Nothing to change: the frontend's Caddyfile already allows
   `https://challenges.cloudflare.com` in `script-src` and `frame-src`. The
   script is loaded only when the backend says the mode is on.
5. **Check it.** Open `/sign-in`: a "Security check" box appears under the
   password field and turns into "Security check complete." Then
   `curl -s -XPOST https://app.example.com/api/auth/sign-in -H 'Origin: https://app.example.com' -H 'Content-Type: application/json' -d '{"email":"x@example.com","password":"x"}'`
   must answer `400 turnstile_required`.

**When Cloudflare is down.** The backend fails closed: sign-in, recovery and
invite acceptance answer `503 turnstile_unavailable` (siteverify times out
after 5 s). Already signed-in sessions, MFA and passkeys keep working. For a
long incident, set `TURNSTILE_FAIL_OPEN=1` and redeploy: requests that
cannot be verified then go through, each one audited as
`security.turnstile_fail_open`. Tokens that Cloudflare *rejects* are still
refused. Remove the variable when Cloudflare recovers.

**Rotating the secret.** Cloudflare → Turnstile → the widget → *Rotate secret
key*, then update `TURNSTILE_SECRET_KEY` and redeploy. Cloudflare keeps the
old secret valid for a short overlap.

## 8. Custom domain and DNS on Cloudflare

1. `setup.sh` runs `railway domain --service frontend app.example.com`, which
   prints the records Railway needs (or add the domain in frontend → Settings
   → Networking → Custom domain).
2. In Cloudflare DNS add the `CNAME app → <something>.up.railway.app` and the
   `TXT` verification record Railway shows. Set the CNAME to **Proxied**
   (orange cloud).
3. SSL/TLS → Overview → **Full (strict)**. Railway serves a valid certificate
   for the custom domain, so strict validation works. Never use *Flexible*:
   it would send traffic from Cloudflare to Railway in clear text.
4. SSL/TLS → Edge Certificates: *Always Use HTTPS* on, minimum TLS 1.2 (1.3
   preferred), HSTS can stay off at Cloudflare (the frontend sets it).
5. Rules → no caching rule for `/api/*` is needed (the API sends
   `Cache-Control: no-store`); hashed `/assets/*` are cached at Cloudflare's
   edge because they are `immutable`.
6. Delete the generated `*.up.railway.app` domain from the frontend once the
   custom domain works, so the app has a single origin (WebAuthn and the
   cookie are bound to it).
7. Mail DNS for Resend: the SPF, DKIM and MX/return-path records from the
   Resend dashboard, **DNS only** (grey cloud), plus a DMARC record.

Railway may take a few minutes to issue the certificate when the record is
proxied; if it does not, set the record to DNS only until the certificate is
issued, then proxy it again (**verify**).

## 9. First deploy and the first Owner

1. `infra/railway/r2-setup.sh`, then create the two R2 tokens (section 4).
2. `infra/railway/setup.sh --dry-run`, then `infra/railway/setup.sh`. The
   repository connection at the end starts the first builds.
3. As soon as Postgres is up: `infra/railway/setup.sh --db-roles` (step 1 of
   the roles). If the backend's first pre-deploy ran before the roles
   existed, it failed; redeploy the backend.
4. When the backend is deployed: `infra/railway/setup.sh --db-roles` again
   (step 2: grants on the new tables).
5. Check: `curl -s https://app.example.com/api/ready` →
   `"ready":true,"bootstrapRequired":true`.
6. Create the first Owner. Production never seeds accounts. Run the
   existing bootstrap command inside the backend container, as the app user,
   then restart the backend so it loads the new member:

   ```bash
   railway ssh --service backend
   su-exec 10001:10001 node --run bootstrap-owner -- --email you@your-org.example --name "Your Name"
   exit
   railway redeploy --service backend --yes
   ```

   On an empty database it is safe to run this next to the live process:
   nobody can sign in yet, so the running backend writes no member rows that
   could collide, and the restart loads the new Owner. The command refuses to
   run when an Owner exists.
7. Open the printed invite link, set a password, enrol an authenticator, add
   a passkey, then invite everyone else from **Team & roles**
   ([First-run production setup](../operations/deployment.md#first-run-production-setup)).
8. Trigger the cron service once by hand (cron → ⋮ → *Run now*) and check
   its log ends with `"worker.finished","ok":true`.

## 10. Jobs: where each periodic job runs

Each periodic job runs in exactly one process. The switch is
`JOBS_IN_PROCESS` on the API (`Backend/lib/jobs.ts`): `1` or unset = every
job (the Compose default), `0` = none, or a list of `backup`, `monitors`,
`digest`. An unknown name refuses to boot.

| Job | Writes collections | Phase 1 (now) | Phase 2 (after the data-layer wave) |
|---|---|---|---|
| Backups, daily | no (reads a snapshot, writes R2) | `cron`, `worker.ts --once backup` | `cron` |
| Restore drill | no | `cron`, `worker.ts --once drill` | `cron` |
| Monitor checks | yes (monitor state, incidents, events) | `backend` | `worker` |
| Notification digests | yes (`emailedAt`) | `backend` | `worker` |
| Audit archive to R2 | no (its own process's chain) | every process | every process |
| Webhook delivery, session/JIT/token sweeps, upload cleanup | yes, or per-process memory | `backend` (not switchable) | moved by the queue wave |

Why the worker is not deployed yet: every process loads all collections into
memory at boot and does not see another process's later writes
([Known limits](../operations/known-limits.md#run-exactly-one-backend-replica)).
A worker running monitors next to the API would update monitor rows the API
never sees, and each would overwrite the other's copy. So `worker.ts` refuses
its long-running mode in production unless `WORKER_LOOP_ENABLED=1`, and
`setup.sh` creates and configures the worker service without connecting its
source. One-shot tasks are safe beside the API because they only read.
Module-level sweeps (JIT expiry every 15 s, token sweeps every 30 s) also
load with the modules, which is one more reason the long-running worker waits;
the one-shot run finishes in seconds, before they first fire, and its
database role could not write anyway.

Every periodic run now takes a lease first (`Backend/lib/scheduler.ts`,
`SET <prefix>lock:<job>:<slot> NX PX` in Redis): the daily backup, each
digest interval and each monitor check runs in exactly one process, whichever
of the API replicas and workers with that job enabled wins. If Redis cannot
answer, the run is skipped and retried within the same slot; a missed run is
preferred to a double run. The daily API backup is aligned to UTC days, so a
redeploy no longer resets its timer.

Leases stop double *runs*, not stale *caches*. Switch to phase 2 only when
the data layer serves the collections these jobs read and write from Postgres
on demand (monitors, monitor history, incidents, notifications, members and
the module-level sweeps listed above, see
[Known limits](../operations/known-limits.md#periodic-jobs-run-where-jobs_in_process-says-and-the-worker-waits)).
Then set `JOBS_IN_PROCESS=0` on the backend (optional with Redis: the lease
already prevents double runs), `WORKER_LOOP_ENABLED=1` on the worker, connect
the worker's source (or `setup.sh --with-worker`), and deploy both.

## 11. Scaling

**Keep `backend` at one replica until the data layer is shared.** With
`REDIS_URL` set, the stateless parts are already replica-safe: rate-limit
buckets, the `/api/_events` bus, the `/api/stream` realtime hub (messages and
notifications) and job leases are shared through Redis. What is not: each
process still serves reads from its own in-memory copy of the collections, so
users would see different data depending on which replica answers, and writes
would overwrite each other. Sessions are part of that: one created on replica
A is unknown to replica B. `numReplicas: 1` is in `backend.railway.json`; do
not raise it in the dashboard.

Raise replicas above 1 only when **all** of these hold:

1. The data layer serves members, sessions, tasks, notifications and every
   other collection that changes at runtime from Postgres on demand (or
   invalidates across processes), so no replica serves a stale copy. Sessions
   use `Backend/auth/sessionStore.ts` (Postgres or the Redis implementation).
2. The backend volume is gone. A Railway volume attaches to one replica only
   and forces stop-then-start deploys. It holds the local audit JSONL copy,
   which is redundant once `audit_entries` and the R2 archive are the record.
3. `REDIS_URL` is set and `GET /api/ready` reports `"redis": "up"`.
4. `EXPECT_REPLICAS` is set to the new count on the backend, so a replica
   without Redis refuses to boot and a Redis outage fails readiness.

Then raise `numReplicas` in `backend.railway.json` (config as code) and
deploy. With more than one replica, a Redis outage refuses sign-in, recovery
and second-factor checks (`503 rate_limit_unavailable`) and skips periodic
jobs. Everything else keeps working: the general API limiter falls back to
per-replica buckets, and events reach clients on the publishing replica only.
See [Rate limiting](../security/CONTROLS.md#when-redis-is-down).

- **Deploys are stop-then-start** for the backend because of its volume, so
  there is a short gap (typically 20–60 s: the new process hydrates, then
  passes `/api/ready`) on each deploy. That is deliberate: it guarantees only
  one writer at a time. Deploy outside working hours or accept the blip.
- **Scale vertically.** Raise the backend's CPU/RAM limit (Settings →
  Resources). Memory grows with the data set because everything is in RAM;
  watch the service's memory graph and keep 50 % headroom.
- `frontend` is stateless and can run 2+ replicas at any time.
- `models` can be scaled vertically; it has no shared state besides R2.
- `cron`: one run at a time (Railway skips a run if the previous one is
  still going).
- Postgres: vertical (plan limits). Redis: small; keys expire (rate-limit
  buckets after a full refill, job leases after two intervals), pub/sub holds
  nothing. Redis 7 or later.

## 12. Backups and restore

Three independent layers:

| Layer | What | Where | Schedule |
|---|---|---|---|
| Railway PostgreSQL backups | the whole database (documents, audit_entries, schema) | Railway (volume snapshots) | Postgres → Backups: enable daily (keep 7) and weekly (keep 4); Pro plan |
| App snapshots | every collection, gzip + AES-256-GCM with `DATA_ENCRYPTION_KEY`, checksummed | R2 `devhq-backups`, locked 35 days | `cron`, daily 03:17 UTC, verified by the restore drill in the same run |
| Audit archive | the hash-chained audit log in batches | R2 `devhq-audit`, locked 365 days | continuous (every 200 entries or 60 s) |

Restore:

- **App snapshot** (rows only, through the API): `GET /api/backups` lists
  them; a dry run diffs against live data; a real restore takes a safety
  backup first. See [Backups and restore](../operations/backups.md). After a
  real restore, redeploy the backend so it re-hydrates.
- **Whole database**: Postgres → Backups → *Restore*. Railway restores into
  the volume (**verify** whether it creates a new volume you then switch to).
  Stop the backend first (backend → ⋮ → *Remove* the active deployment),
  restore, then redeploy the backend. Re-run `postgres-roles.sql` if roles
  changed.
- A restore drill that fails (cron run not `ok`) is a Sev-2 incident, as in
  the [runbook](RUNBOOK.md#restore-drill-monthly-and-after-any-backup-change).

Set up a Railway notification (Project Settings → Notifications, or a
webhook) for failed deployments: a failed cron run shows up as one.

## 13. Rollback

- **Code:** service → Deployments → pick the previous successful deployment →
  *Redeploy* (or *Rollback*). Roll back `backend`, `cron` and `worker`
  together; they are the same image. The pre-deploy migration runs again with
  the older code: migrations it does not know are logged
  (`db.migration_unknown`) and skipped, which is why migrations must be
  expand/contract.
- **Configuration:** variables are versioned per deployment; a change shows
  as a staged diff before deploy. Undo it and redeploy.
- **Data:** section 12.
- **Frontend:** stateless, roll back freely. Hashed assets from the newer
  build stay cached in browsers but are not referenced by the older shell.

## 14. Cost estimate

Rough monthly ranges for a team of up to about 50 people, at list prices as
of late 2026 (check the current Railway and Cloudflare pricing pages):

| Item | Assumption | Range (USD / month) |
|---|---|---|
| Railway Pro plan | one seat; includes usage credit | 20 |
| backend | 0.5–1 GB RAM, low CPU, 1 GB volume | 5–15 |
| frontend | ~50 MB RAM | 1–2 |
| models | 0.5–1 GB RAM | 5–12 |
| Postgres | 0.25–1 GB RAM, 1–5 GB disk | 3–12 |
| Redis | idle until used | 1–3 |
| cron | about 1 minute a day | < 1 |
| Railway egress | the app's pages and API responses | 0–5 |
| Cloudflare R2 | < 10 GB, few operations (free tier), no egress fees | 0–2 |
| Cloudflare DNS / proxy | Free plan | 0 |
| Resend | free tier (3,000 mails) or Pro | 0–20 |
| **Total** | usage is partly covered by the plan credit | **≈ 25–80** |

The worker in phase 2 adds about the backend's idle cost (5–10).

## 15. Go-live checklist

1. R2: four buckets, public `r2.dev` access off, CORS on uploads only, lock
   rules on backups (35 d) and audit (365 d) read back by `r2-setup.sh`,
   lifecycle on uploads and backups.
2. Two R2 tokens, bucket-scoped, Object Read & Write; the setup token deleted.
3. Postgres roles applied twice; `postgres` superuser URL not referenced by
   any app service; TCP proxy removed.
4. Shared secrets sealed; `DATA_ENCRYPTION_KEY` in the password manager.
5. `backend` replicas = 1, volume at `/var/lib/devhq`, `RAILWAY_RUN_UID=0`,
   `JOBS_IN_PROCESS=monitors,digest`; worker not deployed.
6. Only `frontend` has a public domain; the `*.up.railway.app` domain removed.
7. Cloudflare: proxied, **Full (strict)**, Always Use HTTPS.
8. `curl -sI https://app.example.com/` shows `Cache-Control: no-cache`,
   the CSP with the R2 origin, HSTS; an `/assets/*.js` file shows
   `immutable` and `Content-Encoding: br`; `/api/health` is `200`;
   `/api/ready` is `"ready":true`.
9. **Client IP:** sign in, then check Security → Sign-in history shows your
   real public IP, not a Cloudflare or Railway address. Then
   `curl -H 'X-Forwarded-For: 203.0.113.9' https://app.example.com/api/auth/session`
   and confirm the request log (`"ip"`) does **not** show `203.0.113.9`.
10. First Owner created, MFA enrolled, passkey added.
11. Upload an avatar (presigned PUT to R2 works through CSP and CORS), then
    view it (presigned GET).
12. `GET /api/storage/status`: `"driver":"s3"`, `"lockMode":"R2_BUCKET_LOCK"`,
    audit archive `batches` > 0 after a few minutes, `failures` 0.
13. Cron *Run now* succeeds; `GET /api/backups` lists the backup; a dry-run
    restore works.
14. Railway Postgres backups enabled; deployment-failure notifications on.
15. Mail: an invite email arrives (Resend), SPF/DKIM pass.
    If Turnstile is on: the sign-in page shows the security check, and a
    request without a token answers `400 turnstile_required`
    ([Cloudflare Turnstile](#cloudflare-turnstile)).
16. `models`: `GET /api/insights/…` answers with `source` from the models
    service (or `heuristic` until models are promoted); the assistant works if
    `ANTHROPIC_API_KEY` is set.
17. **Wait for CI** on for every service; the deploy branch protected.
18. External uptime check on `https://app.example.com/api/health` (Railway's
    health check only gates deploys; it does not restart a hung process).

## 16. CI changes to make on GitHub

The workflows are edited on GitHub by the owner; this change does not touch
`.github/workflows/`. Suggested edits:

1. `ci.yml`, job *Infra*, step *Shellcheck infra scripts*: add
   `infra/railway/*.sh` to the file list.
2. `ci.yml`, job *Infra*: add a step that validates the Railway configs, e.g.
   `for f in infra/railway/*.railway.json; do jq -e .build.dockerfilePath "$f" >/dev/null; done`.
3. `deploy.yml`: it deploys to a Compose host over SSH. With Railway
   deploying from the branch (and *Wait for CI*), disable its production job,
   or keep it for a staging VM only.
4. `images.yml`: unchanged. Railway builds from the Dockerfiles itself, so
   the GHCR images, cosign signatures and SBOMs are not what runs on Railway.
   If signed images must be what runs, switch each Railway service's source
   to the GHCR image (`ghcr.io/…:sha-<sha>`) instead of the repository, and
   have the workflow redeploy with `railway redeploy` using a project token.
