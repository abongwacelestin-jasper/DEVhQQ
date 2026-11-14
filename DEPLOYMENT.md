# Deploying TavetaHQ

The one-page guide to putting TavetaHQ in production at `tavetahq.io`: which
services run, how they talk to each other, every Railway setting, and the steps
from an empty account to the first signed-in Owner.

This page is the overview and the checklist. The deep reference for each topic
is linked where it applies:

- [Railway reference](docs/deploy/RAILWAY.md): every decision and edge case
- [Architecture](docs/deploy/ARCHITECTURE.md) and the
  [runbook](docs/deploy/RUNBOOK.md) (Docker Compose, single host)
- [Environment variables](docs/operations/env-vars.md) and the
  [configuration reference](docs/operations/configuration.md)
- [Known limits](docs/operations/known-limits.md): read before inviting real
  users
- [Email](docs/operations/email.md), [backups](docs/operations/backups.md),
  [brand](docs/operations/brand.md)

## Status: what has and has not been proven

| Proven locally                                                       | Not yet proven                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Unit, smoke and browser test suites pass                             | Anything on a real Railway or Cloudflare account                             |
| All images build; the frontend image runs                            | `setup.sh` and `r2-setup.sh` beyond `--dry-run`                              |
| The worker and migrations against PostgreSQL 17 with the three roles | Resend delivery, R2 CORS as applied, client IP behind Cloudflare and Railway |
| Two API processes on one database for the migrated tables            | Load testing                                                                 |

So expect to fix small things on the first real run, and work through the
[go-live checklist](#12-go-live-checklist) before inviting anyone.

**Hard limit:** the backend runs as **one replica**. Most collections are still
held in process memory, and production refuses to boot with more than one. Scale
it vertically until the data layer work is finished
([Known limits](docs/operations/known-limits.md)).

## 1. Services

Seven services on Railway, three providers outside it.

| Service    | What it runs                                                                                 | Port | Public                 | Config file                           |
| ---------- | -------------------------------------------------------------------------------------------- | ---- | ---------------------- | ------------------------------------- |
| `frontend` | Caddy serving the built app; proxies `/api/*`, `/console` and `/backend.html` to the backend | 8081 | **yes**, `tavetahq.io` | `infra/railway/frontend.railway.json` |
| `backend`  | The API. One replica, volume at `/var/lib/devhq`                                             | 8080 | no                     | `infra/railway/backend.railway.json`  |
| `models`   | ML service (FastAPI)                                                                         | 8000 | no                     | `infra/railway/models.railway.json`   |
| `cron`     | Backend image; daily backup and restore drill, then exits                                    | none | no                     | `infra/railway/cron.railway.json`     |
| `worker`   | Backend image; long-running jobs. **Created but not deployed yet**                           | none | no                     | `infra/railway/worker.railway.json`   |
| `Postgres` | Railway PostgreSQL plugin                                                                    | 5432 | no                     | plugin                                |
| `Redis`    | Railway Redis plugin (7 or later)                                                            | 6379 | no                     | plugin                                |

| Outside Railway | Used for                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Cloudflare      | DNS and the proxy in front of the app; R2 object storage (four buckets); optional Turnstile on the sign-in forms |
| Resend          | Outgoing email, sent from `mail.tavetahq.io`                                                                     |
| GitHub          | Source, CI, and (optional) the GitHub App integration                                                            |
| LiveKit Cloud   | Only when Meetings ships. Railway cannot host a media server (WebRTC needs UDP)                                  |

There is no separate "deployment" service. Railway builds each service from its
Dockerfile when the deploy branch changes, and `cron` covers scheduled work.

## 2. How the services communicate

```
Browser
  │ HTTPS
  ▼
Cloudflare  (proxied, TLS Full (strict), caches /assets/*)
  │ HTTPS
  ▼
frontend ───/api/*, /console───► backend:8080 ───► Postgres  (role devhq_app)
(Caddy, the only public service)   │   │   │
                                   │   │   └─────► Redis     (rate limits, events, job leases)
                                   │   └─────────► models:8000  (bearer ML_SERVICE_TOKEN)
                                   └─────────────► R2, Resend, GitHub, Turnstile  (HTTPS out)

cron ───► Postgres (read-only role devhq_jobs) ───► R2 backups bucket
models ─► R2 models bucket
Browser ─► R2 directly, with short-lived presigned URLs (uploads and downloads)
```

- **Private networking.** Everything behind the frontend uses Railway's private
  network (`<service>.railway.internal`). Only `frontend` has a public domain.
- **One origin.** The app and the API share `https://tavetahq.io`, so the
  `__Host-` `SameSite=Strict` session cookie works and there is no CORS.
- **Client IP.** Caddy hands the backend exactly one trusted `X-Forwarded-For`
  value (it trusts only private ranges and Cloudflare's published ranges, else
  `CF-Connecting-IP`). Rate limits and sign-in history depend on this: check it
  on the first deploy (checklist item 9).
- **Database roles.** The Postgres superuser is never given to a service:

  | Role             | Used by                                 | Can                                                   |
  | ---------------- | --------------------------------------- | ----------------------------------------------------- |
  | `devhq_migrator` | the backend's pre-deploy migration only | run DDL                                               |
  | `devhq_app`      | the API (and the worker later)          | read and write rows; no DDL; cannot change audit rows |
  | `devhq_jobs`     | `cron`                                  | read rows, insert audit rows                          |

- **Internal names keep the old `devhq` prefix** (roles, buckets,
  `DEVHQ_DOMAIN`, the volume path). That is deliberate; only the product name
  changed.

## 3. Railway configuration per service

These live in the repository (config as code); `setup.sh` points each service at
its file. Root directory is `/` for every service except `models` (`/Models`).

| Setting        | `frontend`            | `backend`            | `cron`                          | `worker`             | `models`                    |
| -------------- | --------------------- | -------------------- | ------------------------------- | -------------------- | --------------------------- |
| Dockerfile     | `Frontend/Dockerfile` | `Backend/Dockerfile` | `Backend/Dockerfile`            | `Backend/Dockerfile` | `Dockerfile` (in `/Models`) |
| Start command  | image default         | image default        | `worker.ts --once backup,drill` | `worker.ts`          | image default               |
| Pre-deploy     | none                  | `node --run migrate` | none                            | none                 | none                        |
| Health check   | `/healthz` (30 s)     | `/api/ready` (120 s) | none                            | none                 | none (listens on IPv6)      |
| Schedule       | none                  | none                 | `17 3 * * *` UTC                | none                 | none                        |
| Restart policy | on failure, 10 tries  | on failure, 10 tries | never                           | on failure, 10 tries | on failure, 10 tries        |
| Replicas       | 1 (can be 2+)         | **1, do not raise**  | 1                               | 1                    | 1                           |
| Volume         | none                  | `/var/lib/devhq`     | none                            | none                 | none                        |
| Public domain  | `tavetahq.io`         | none                 | none                            | none                 | none                        |

Each file also sets watch patterns, so a service rebuilds only when its own code
changes. Turn on **Wait for CI** on every service, so Railway deploys only
commits whose GitHub checks passed.

## 4. Variables

`setup.sh` sets all of these. `${{shared.X}}` is a Railway shared variable and
`${{Service.X}}` a reference to another service. Full list:
[RAILWAY.md, section 7](docs/deploy/RAILWAY.md#7-variables-per-service).

**Shared (project level)**

| Variable                                                                         | Value                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `NODE_ENV`                                                                       | `production`                                                       |
| `APP_ORIGIN`, `PUBLIC_URL`                                                       | `https://tavetahq.io`                                              |
| `WEBAUTHN_RP_ID`                                                                 | `tavetahq.io` (decide once: passkeys are bound to it)              |
| `WEBAUTHN_RP_NAME`                                                               | `TavetaHQ`                                                         |
| `DEMO_DISABLED`                                                                  | `1`                                                                |
| `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`                                              | `https://<account>.r2.cloudflarestorage.com`                       |
| `S3_REGION`, `S3_FORCE_PATH_STYLE`                                               | `auto`, `true`                                                     |
| `S3_BUCKET_UPLOADS` / `_BACKUPS` / `_AUDIT` / `_MODELS`                          | `devhq-uploads` / `devhq-backups` / `devhq-audit` / `devhq-models` |
| `STORAGE_LOCK_MODE`, `BACKUP_RETENTION_DAYS`                                     | `R2_BUCKET_LOCK`, `35`                                             |
| `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `ML_SERVICE_TOKEN`, `MODEL_SIGNING_KEY` | generated secrets                                                  |
| `APP_DB_PASSWORD`, `MIGRATOR_DB_PASSWORD`, `JOBS_DB_PASSWORD`                    | generated secrets                                                  |
| `R2_BACKEND_ACCESS_KEY_ID`, `R2_BACKEND_SECRET_ACCESS_KEY`                       | the backend R2 token                                               |

**`frontend`**

| Variable           | Value                                                                            |
| ------------------ | -------------------------------------------------------------------------------- |
| `PORT`             | `8081`                                                                           |
| `API_MODE`         | `proxy`                                                                          |
| `API_UPSTREAM`     | `${{backend.RAILWAY_PRIVATE_DOMAIN}}:8080`                                       |
| `S3_PUBLIC_ORIGIN` | `https://<account>.r2.cloudflarestorage.com` (allowed in the security policy)    |
| `HSTS_VALUE`       | `max-age=63072000; includeSubDomains; preload` (use a short value while testing) |

**`backend`** (plus the shared settings by reference)

| Variable                                                       | Value                                                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `PORT`, `TRUST_PROXY`                                          | `8080`, `1`                                                                                                             |
| `RAILWAY_RUN_UID`                                              | `0` (the entrypoint fixes the volume's owner, then drops to uid 10001)                                                  |
| `JOBS_IN_PROCESS`                                              | `monitors,digest`                                                                                                       |
| `DATABASE_URL`                                                 | `postgresql://devhq_app:${{shared.APP_DB_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` |
| `DATABASE_MIGRATION_URL`                                       | the same with `devhq_migrator` and `MIGRATOR_DB_PASSWORD`                                                               |
| `DATABASE_SSL`                                                 | `disable` (private network)                                                                                             |
| `REDIS_URL`                                                    | `${{Redis.REDIS_URL}}`                                                                                                  |
| `ML_SERVICE_URL`                                               | `http://${{models.RAILWAY_PRIVATE_DOMAIN}}:8000`                                                                        |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                     | the shared R2 backend token                                                                                             |
| `MAIL_TRANSPORT`, `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`     | `resend`, the key, `TavetaHQ <no-reply@mail.tavetahq.io>`, `https://tavetahq.io`                                        |
| `BRAND_*`                                                      | from [`infra/brand/tavetahq.brand.env`](infra/brand/tavetahq.brand.env)                                                 |
| `TURNSTILE_MODE`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | optional bot check on the sign-in forms                                                                                 |
| `GITHUB_APP_*`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_*`     | optional, when the GitHub App exists                                                                                    |
| `EXPECT_REPLICAS`                                              | leave unset                                                                                                             |

**`cron`**: the shared settings and R2 credentials, `DATABASE_URL` with
`devhq_jobs` and `JOBS_DB_PASSWORD`, `DATABASE_POOL_MAX=3`.

**`models`**: `NODE_ENV=production`, `HOST=::`, `PORT=8000`, `ML_SERVICE_TOKEN`,
`MODEL_SIGNING_KEY`, the `S3_*` connection settings with the **models** R2 token
and `S3_BUCKET_MODELS`, and optionally `ANTHROPIC_API_KEY` for the assistant.

**`worker`**: as the backend without `PORT`, `TRUST_PROXY`, `RAILWAY_RUN_UID`
and `DATABASE_MIGRATION_URL`, plus `WORKER_JOBS=monitors,digest` and
`WORKER_LOOP_ENABLED=0`.

## 5. Before you start

- **Railway**: an account on the Pro plan, the CLI (`npm i -g @railway/cli`,
  `railway login`) and an API token (Account Settings → Tokens).
- **Cloudflare**: `tavetahq.io` on Cloudflare DNS, R2 enabled, and an API token
  with _Workers R2 Storage: Edit_.
- **Resend**: an account with `mail.tavetahq.io` verified (SPF, DKIM, DMARC).
- **Locally**: `jq`, `curl`, `openssl`, and `psql` 15 or later.
- **GitHub**: the repository connected to Railway's GitHub app, and CI green on
  the commit you deploy.
- **Decisions**: the app address (`tavetahq.io`, as this guide assumes, or
  `app.tavetahq.io`); real mailboxes for `support@`, `security@` and
  `conduct@tavetahq.io`; the registered company name and a postal address for
  email footers (`BRAND_LEGAL_NAME`, `BRAND_POSTAL_ADDRESS`).

## 6. Setup, step by step

1. **Create the R2 buckets.** The script creates the four buckets, applies CORS,
   lifecycle and lock rules, and turns off public access.

   ```bash
   export CLOUDFLARE_API_TOKEN=… R2_ACCOUNT_ID=… DEVHQ_DOMAIN=tavetahq.io
   infra/railway/r2-setup.sh --dry-run    # prints every request, changes nothing
   infra/railway/r2-setup.sh
   ```

   Then create two R2 API tokens in the Cloudflare dashboard, both _Object Read
   & Write_ and limited to their buckets: `devhq-backend` (uploads, backups,
   audit) and `devhq-models` (models). The keys are shown once.

2. **Provision Railway.** The script creates the project, both plugins, the five
   services with their settings, the backend volume, every variable and the
   custom domain, then connects the repository, which starts the first builds.
   It is safe to re-run.

   ```bash
   railway login
   export RAILWAY_API_TOKEN=… R2_ACCOUNT_ID=…
   export DEVHQ_DOMAIN=tavetahq.io GITHUB_REPO=<owner>/<repo> DEPLOY_BRANCH=main
   set -a; . infra/brand/tavetahq.brand.env; set +a    # brand values for email
   infra/railway/setup.sh --dry-run
   infra/railway/setup.sh     # prompts for the R2, Resend, Anthropic and Turnstile keys
   ```

3. **Create the database roles** as soon as Postgres is up:

   ```bash
   infra/railway/setup.sh --db-roles
   ```

   If the backend's first deploy failed because the roles did not exist yet,
   redeploy it.

4. **Run the roles step again** once the backend has deployed. The second run
   grants access on the tables the first migration created. Then remove the
   Postgres public TCP proxy (Postgres → Settings → Networking).

5. **Point DNS at Railway** (section 7).

6. **Check it is up.**

   ```bash
   curl -s https://tavetahq.io/api/ready    # "ready":true,"bootstrapRequired":true
   ```

7. **Create the first Owner.** Production never seeds accounts.

   ```bash
   railway ssh --service backend
   su-exec 10001:10001 node --run bootstrap-owner -- --email you@tavetahq.io --name "Your Name"
   exit
   railway redeploy --service backend --yes
   ```

   Open the printed invite link, set a password, enrol an authenticator and add
   a passkey. Invite everyone else from **Team & roles**.

8. **Harden.** Seal the secret shared variables (Project Settings → Shared
   Variables → ⋮ → Seal). Save `DATA_ENCRYPTION_KEY` in a password manager:
   without it no backup can be restored. Delete the `*.up.railway.app` domain
   from the frontend. Turn on Wait for CI on every service. Enable Railway
   Postgres backups and failed-deployment notifications. Run `cron` once by hand
   and check its log ends with `"worker.finished","ok":true`.

## 7. Domain, DNS and Cloudflare

1. `setup.sh` adds the custom domain to `frontend` and prints the records
   Railway needs. In Cloudflare DNS add the `CNAME` (for the root domain
   Cloudflare flattens it) and the `TXT` verification record, and set the CNAME
   to **Proxied**.
2. SSL/TLS → **Full (strict)**. Never _Flexible_.
3. Edge Certificates: _Always Use HTTPS_ on, minimum TLS 1.2.
4. One cache rule: host `tavetahq.io` and path starts with `/assets/` → eligible
   for cache, respect the origin's headers. Never _Cache Everything_ on the
   whole host.
5. Speed: Early Hints on, HTTP/2 and HTTP/3 on, 0-RTT off, Rocket Loader and
   Auto Minify off.
6. Mail: the SPF, DKIM and return-path records from Resend as **DNS only**, plus
   a DMARC record.

If Railway is slow to issue the certificate while the record is proxied, set it
to DNS only until the certificate exists, then proxy it again.

## 8. Email, bot protection and integrations

- **Email (Resend).** `MAIL_TRANSPORT=resend` with `RESEND_API_KEY` and an
  explicit `MAIL_FROM`; production refuses to boot without the sender. Without a
  key the transport is `console`: mail is logged, not sent. Preview every
  template locally with `npm run mail:preview --workspace=Backend`. Before
  inviting users, send yourself each security email and read it in Gmail,
  Outlook and Apple Mail.
- **Turnstile (optional).** Create a _Managed_ widget for the host
  `tavetahq.io`, then give `setup.sh` the site and secret keys. With the mode on
  and a key missing, production refuses to boot. Details:
  [RAILWAY.md](docs/deploy/RAILWAY.md#cloudflare-turnstile).
- **GitHub App (optional).** Set the `GITHUB_APP_*` variables on the backend by
  hand once the app exists. Until then the engineering pages show labelled
  sample data and _Install on GitHub_ answers that it is not configured.
- **Assistant (optional).** `ANTHROPIC_API_KEY` on `models`. Without it the
  assistant says it is unavailable.

## 9. Scheduled jobs

| Job                                        | Runs in                                       |
| ------------------------------------------ | --------------------------------------------- |
| Daily backup and restore drill (03:17 UTC) | `cron`                                        |
| Monitor checks, notification digests       | `backend` (`JOBS_IN_PROCESS=monitors,digest`) |
| Audit archive to R2                        | every process                                 |

Each run takes a lease in Redis first, so a job never runs twice. The
long-running `worker` stays undeployed until the data layer serves these
collections from Postgres; it refuses to start its loop in production unless
`WORKER_LOOP_ENABLED=1`.

## 10. Routine deploys, rollback and backups

**Deploying a change.** Work lands on `develop`, is verified, then merged to
`main`. Railway watches `main` and, with Wait for CI, deploys when the checks
pass. Each service rebuilds only when its watch patterns match. The backend runs
its migration first; a failed migration stops the deploy and the old version
keeps running. Because of its volume the backend is redeployed stop-then-start,
so expect a gap of 20 to 60 seconds: deploy outside working hours.

Before merging to `main`:

```bash
npm test --workspace=Backend     # unit tests and the API smoke run
npm test --workspace=Frontend
npm run lint && npm run build --workspace=Frontend
cd e2e && npm test               # browser journeys
```

**Rollback.** Service → Deployments → the previous successful one → _Redeploy_.
Roll back `backend`, `cron` and `worker` together (one image). Migrations must
stay expand/contract, because a rollback runs older code on the newer schema.

**Backups.** Three independent layers:

| Layer                      | Where                              | Schedule                                     |
| -------------------------- | ---------------------------------- | -------------------------------------------- |
| Railway PostgreSQL backups | Railway                            | daily and weekly (enable them)               |
| Encrypted app snapshots    | R2 `devhq-backups`, locked 35 days | `cron`, daily, verified by the restore drill |
| Audit archive              | R2 `devhq-audit`, locked 365 days  | continuous                                   |

A failed `cron` run shows as a failed deployment: alert on it and treat it as an
incident. Restore steps: [Backups](docs/operations/backups.md).

## 11. Scaling and cost

- `backend`: **one replica**, scale CPU and memory. Keep 50 % memory headroom.
- `frontend`: stateless, 2+ replicas at any time.
- `models`, Postgres: vertical. Redis: small.
- The conditions for a second backend replica are in
  [RAILWAY.md, section 11](docs/deploy/RAILWAY.md#11-scaling).

Rough cost for a team of up to about 50 people: **25 to 80 USD a month**
(Railway Pro 20, backend 5–15, models 5–12, Postgres 3–12, the rest a few
dollars, R2 and Cloudflare usually free, Resend 0–20). Check current prices.

## 12. Go-live checklist

Infrastructure

- [ ] Four R2 buckets; public `r2.dev` access off; CORS on uploads only; lock
      rules on backups (35 days) and audit (365 days).
- [ ] Two bucket-scoped R2 tokens; the setup token deleted.
- [ ] Database roles applied twice; no service references the `postgres`
      superuser URL; the TCP proxy removed.
- [ ] Shared secrets sealed; `DATA_ENCRYPTION_KEY` in the password manager.
- [ ] `backend` at 1 replica with its volume; `worker` not deployed.
- [ ] Only `frontend` has a public domain; `*.up.railway.app` removed.
- [ ] Cloudflare proxied, Full (strict), Always Use HTTPS.
- [ ] Wait for CI on every service; `main` protected.
- [ ] Railway Postgres backups on; failed-deployment notifications on.
- [ ] An external uptime check on `https://tavetahq.io/api/health`.

Verification on the live site

- [ ] `curl -sI https://tavetahq.io/` shows `Cache-Control: no-cache`, HSTS and
      a `Content-Security-Policy` that names the R2 origin (not the bare
      `default-src 'self'` placeholder).
- [ ] An `/assets/*.js` file is `immutable` and Brotli-compressed.
- [ ] `/api/health` is 200 and `/api/ready` says `"ready":true`.
- [ ] **Client IP:** Security → Sign-in history shows your real public IP. Then
      `curl -H 'X-Forwarded-For: 203.0.113.9' https://tavetahq.io/api/auth/session`
      and confirm the request log does not show `203.0.113.9`.
- [ ] First Owner created with an authenticator and a passkey.
- [ ] Upload an avatar and view it (R2 through the security policy and CORS).
- [ ] `GET /api/storage/status` says `"driver":"s3"`,
      `"lockMode":"R2_BUCKET_LOCK"`, and audit batches above 0 after a few
      minutes.
- [ ] `cron` _Run now_ succeeds; `GET /api/backups` lists the backup; a dry-run
      restore works.
- [ ] An invite email arrives and passes SPF and DKIM; the logo and artwork
      load.
- [ ] With Turnstile on: the sign-in page shows the check, and a request without
      a token answers `400 turnstile_required`.
- [ ] Insights answer from the models service (or `heuristic`).

People

- [ ] The [UAT checklist](docs/qa/UAT_CHECKLIST.md) done on the live site.
- [ ] The mailboxes `support@`, `security@` and `conduct@tavetahq.io` exist and
      are read.
- [ ] The legal name and postal address are set for email footers.

## 13. Troubleshooting

| Symptom                                                                                             | Likely cause                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend deploy fails in pre-deploy with a permission error                                          | The database roles were not created yet. Run `setup.sh --db-roles`, redeploy.                                                                                    |
| Backend exits at boot with `Missing required environment variable …`                                | That variable is not set on the service. Production fails closed on missing secrets, a missing `MAIL_FROM`, incomplete Turnstile keys, or more than one replica. |
| `/api/ready` never turns ready                                                                      | Postgres or Redis unreachable on the private network; read the backend log.                                                                                      |
| The app loads unstyled or animations are frozen, with security-policy errors in the browser console | The page was built without its security policy filled in. The build now fails when that happens; rebuild the frontend.                                           |
| Sign-in works but uploads fail                                                                      | `S3_PUBLIC_ORIGIN` on the frontend, or the R2 CORS origin, does not match the app's address.                                                                     |
| Every sign-in shows the same IP, or people are rate-limited together                                | The client IP is not reaching the backend; see checklist item on client IP.                                                                                      |
| No email arrives                                                                                    | `MAIL_TRANSPORT` is `console` (no Resend key), or the sending domain is not verified.                                                                            |
| Passkeys stop working after a domain change                                                         | They are bound to `WEBAUTHN_RP_ID`; members must add a new passkey.                                                                                              |
| The models service looks unhealthy on Railway                                                       | It listens on IPv6 only there and has no health check by design; test it through `GET /api/insights/…`.                                                          |

## 14. Running the production stack on one machine

The same images run under Docker Compose, with Caddy as the edge, PostgreSQL,
Redis and MinIO in place of R2. Use it to rehearse a release or to host on a
single server.

```bash
make secrets    # generates infra/secrets/* and .env (idempotent)
make up         # builds and starts the stack at https://$DEVHQ_DOMAIN
make smoke      # end-to-end smoke test through the edge
make down
```

Details: [RUNBOOK.md](docs/deploy/RUNBOOK.md).
