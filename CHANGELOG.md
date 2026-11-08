# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Relational data layer, phase 1** ([ADR 0011](docs/architecture/adr/0011-relational-data-layer.md)).
  Members (with their sealed credentials), sessions, tasks, task events,
  task comments and notifications move from in-memory JSONB collections to
  typed, org-keyed PostgreSQL tables with foreign keys, monthly partitions for
  task events and notifications, and keyset paging. They are read on demand
  through async repositories (`Backend/data/`, with in-memory implementations
  for tests and development), so every replica sees every write. Writes are
  field-level, failed-sign-in counters and backup-code burns are atomic, and
  task keys come from an atomic counter. Sessions implement the shared
  `auth/sessionStore.ts` contract on Postgres. Migration `003`, plus a
  boot-time and `npm run backfill` copy of existing rows (idempotent, counts
  verified); a JSONB copy is dual-written (`DATA_DUAL_WRITE`) so rollback is
  lossless. `npm run smoke:pg` now runs two API replicas on one database and
  checks every migrated collection across them; `npm run test:pg` runs the
  repository contract against Postgres. Wire shapes are unchanged. Replicas
  stay at 1 until the remaining collections move (see Known limits).

- **Cloudflare Turnstile (optional):** `TURNSTILE_MODE=on` puts a bot check on
  password sign-in, demo sign-in, the password reset request and invite
  acceptance. Tokens are verified server-side (hostname, per-form action,
  single use), the check fails closed (`503 turnstile_unavailable`) with an
  audited `TURNSTILE_FAIL_OPEN=1` incident switch, and production refuses to
  boot without both keys. New public `GET /api/auth/config`. Explicit CLI
  clients are exempt (`TURNSTILE_EXEMPT_CLI=0` turns that off). Setup:
  [Railway: Cloudflare Turnstile](docs/deploy/RAILWAY.md#cloudflare-turnstile).
- **Redis for shared runtime state** ([ADR 0009](docs/architecture/adr/0009-redis-for-shared-runtime-state.md)).
  With `REDIS_URL` set, every replica draws from the same rate-limit buckets
  (an atomic Lua token bucket), `/api/_events` and `/api/stream` deliver
  events published on any replica with the per-subscriber filtering
  unchanged and no double delivery, and periodic jobs (backup, digest, each
  monitor check) take a `SET NX PX` lease, so each runs once across
  processes. When Redis is down, the API limiter falls back to a local
  bucket and the auth and second-factor limiters answer
  `503 rate_limit_unavailable`. `GET /api/ready` reports `redis`.
  `EXPECT_REPLICAS` above 1 makes Redis mandatory. Without `REDIS_URL`,
  behaviour is unchanged. New `auth/sessionStore.ts` interface with memory
  and Redis implementations, for the data layer to adopt. New dependency:
  `@redis/client` 5.12.1. Tests: `npm run test:redis` (real Redis in Docker,
  two API processes) and the security check "Rate limits shared across two
  replicas". The API's daily backup now runs once per UTC day instead of 24 h
  after each boot.

- **Incident recovery steps:** the incident page's Recovery panel lists
  mitigation steps and follow-ups recorded by the API
  (`GET|POST /api/incidents/:id/actions`,
  `PATCH|DELETE /api/incidents/:id/actions/:actionId`). Each step has an owner,
  an optional due date (overdue steps are highlighted) and a status; ticking it
  done, reassigning or deleting writes a timeline entry and an audit entry, and
  the owner is notified. Writes need Infrastructure ≥ `contribute` (delete:
  `manage`); incidents outside your products are `404`. `GET /api/incidents`
  returns `openActions` per incident.
- **One audit chain across restarts.** Each boot verifies the durable store
  (`audit_entries` with `DATABASE_URL`, else `AUDIT_LOG_FILE`) and continues it.
  `seq` carries on and `prevHash` is the last stored hash, behind an
  `audit.chain_resumed` marker. An unreadable or broken store is recorded as a
  sensitive `audit.chain_discontinuity`; a boot never starts a fresh genesis
  silently. `GET /api/audit/verify` now also re-reads the store across every
  boot and returns `live`, `store` and `continuity` alongside `ok` and
  `brokenAt`. Data written by v2.0.0 still verifies. See the ADR 0008 addendum.
- `Backend/scripts/verify-audit.ts`: offline end-to-end verifier for the audit
  file, a `row_to_json` export of `audit_entries`, archived batches, or the
  database (`--database`); reports the first break.

### Fixed

- An audit entry appended by an event-bus subscriber could be stored before the
  entry that triggered it (file, `audit_entries`, archive). Writes and bus
  events now follow chain order.
- `npm run smoke:pg` signs in as a `cli` client again (it got no body token
  since v2.0.0's cookie-only sessions).
- **Production email through Resend** (`MAIL_TRANSPORT=resend`): native `fetch`
  to the Resend API with a per-attempt timeout, one retry on `429`/`5xx`
  honouring `Retry-After`, an `Idempotency-Key` per message, a `category` tag
  and masked recipients in logs. Production refuses to boot without
  `RESEND_API_KEY` (or `RESEND_API_KEY_FILE`) and `MAIL_FROM`.
- **Branded email layout:** one table-based, 600 px, dark-mode-aware layout
  with Outlook (MSO/VML) support, preheaders, bulletproof buttons, a plain-text
  part for every email and a compliance footer, configured by `BRAND_*` and
  `APP_URL`.
- **New emails:** invitation, sign-in from a new device or IP, authenticator or
  passkey added/replaced, backup codes generated, backup code used, account
  locked, access request, task assigned or review requested, incident declared
  (owner), deployment awaiting approval, offboarding started; the reset,
  password-changed, offboarding-completed and digest emails use the new layout
  (`MAIL_DIGEST_MINUTES=1440` / `10080` for a daily or weekly summary).
  Security notices are always sent; work notifications respect each member's
  alert choices.
- `npm run mail:preview` (Backend) writes every email as `.html` and `.txt`
  for review. See `docs/operations/email.md`.
- **Settings** (`/settings`) and **Sessions & devices** (`/sessions`) for every role, in the
  account menu. Settings edits the profile, availability, skills and notification choices
  (server-backed), theme and language, and holds password change, authenticator and backup
  codes. Sessions lists your sessions and revokes one or all others.
- `POST /api/auth/password`: change password with the current one (session only, step-up,
  password policy, rate limited, audited); revokes your other sessions and rotates this one.
- `POST /api/auth/sign-out-others`: revoke every session except the current one.
- The onboarding profile stores title, pronouns, bio, working days and email delivery
  (previously kept only in the browser's localStorage).
### Security

- **Just-in-time production access is enforced.** Approving a production deploy,
  rolling back a production deploy that was approved or ran, changing an
  incident's severity and resolving a SEV1 now need an approved, unexpired grant
  for `production:<product>`; otherwise `403 elevation_required` with
  `details.scope`. The Owner is exempt; personal access tokens never carry an
  elevation (`403 elevation_unavailable`). Expiry and revocation apply on the
  next request. Each use is audited as `jit.used`. Staging is unaffected.
- `GET /api/access/grants/mine` lists the caller's own grants; approvers are
  notified of new requests.
- Web app: a refused production action opens **Request production access**;
  deployment and incident detail show pending and active grants with time left;
  Security → Production access lets Owner and Operations approve, deny and
  revoke. The Team access review's **Deny** now calls the existing revoke route.
- Resolving an incident only announces success after the API accepts it.
- **Railway deployment with Cloudflare R2** (`docs/deploy/RAILWAY.md`,
  `infra/railway/`): config as code for frontend, backend, worker, cron and
  models; `setup.sh` (Railway CLI + API, idempotent, `--dry-run`) and
  `r2-setup.sh` (buckets, CORS, lifecycle, bucket locks); least-privilege
  Postgres roles (`postgres-roles.sql`: migrator, app, read-only jobs role);
  a Railway topology diagram in `docs/deploy/ARCHITECTURE.md`.
- **`Backend/worker.ts`**: runs periodic jobs outside the API. `--once
  backup,drill` (the Railway cron service) hydrates, backs up, verifies the
  backup, flushes and exits; the long-running mode is fenced in production
  (`WORKER_LOOP_ENABLED`) until the data layer supports a second writer.
- **`JOBS_IN_PROCESS`** (`Backend/lib/jobs.ts`): which of `backup`,
  `monitors`, `digest` the API runs (default: all); unknown names refuse to boot.
- **`STORAGE_LOCK_MODE=R2_BUCKET_LOCK`**: the status endpoints report R2
  bucket locks as what they are instead of `COMPLIANCE`.

### Changed

- **Faster web app loads** ([performance](docs/operations/performance.md)):
  every page is a lazily loaded, prefetched chunk (entry JavaScript 333 kB to
  173 kB brotli), the 420 ms route skeleton timer is gone, fonts and the
  Monaco editor are self-hosted (Google Fonts and jsDelivr leave the CSP),
  illustrations are WebP (1.57 MB to 0.28 MB), and the shell sends a `Link`
  preload header for Cloudflare Early Hints. Lighthouse (desktop): `/sign-in`
  95 to 96, `/` signed in 58 to 95, `/my-work` 53 to 96. A build-time chunk
  budget fails any chunk over 500 kB except Monaco's.
- **Frontend image runs Caddy instead of nginx** (`infra/frontend/`): Brotli
  and gzip pre-compressed assets, `PORT`, optional same-origin `/api` proxy
  (`API_MODE=proxy`) with a client-IP computation that ignores spoofed
  `X-Forwarded-For`, CSP gains `S3_PUBLIC_ORIGIN`. Compose behaviour is
  unchanged (API paths still answer `404` behind the edge). The nginx config directory is
  removed.
- **Container entrypoint**: unsets `DATABASE_MIGRATION_URL` for everything but
  the migration command, and when started as root (Railway volumes) fixes the
  state directory's ownership and drops to uid 10001 with `su-exec`.
- **Models image**: no `VOLUME` instruction (Railway rejects it); Compose
  mounts a named volume at `MODEL_DIR`.

## [2.0.0] - 2026-11-07

Major version: browser sessions are cookie-only, so clients that read the session
token from the sign-in response must switch to the cookie or to a personal access token.

### Release hardening (beta-verified 2026-11-07)

#### Added

- **One-time backup codes:** 10 random codes, stored only as SHA-256 hashes and shown
  once at onboarding or from Security → Backup codes (step-up). They are accepted
  once each as the second factor on the verify screen (`POST /api/auth/mfa/backup`).
- **Access requests:** "Request access" on the no-access page calls
  `POST /api/access/requests`, which is audited and notifies members with
  Administration:manage.
- 404 page inside the app shell; a deep link opened while signed out is replayed
  after sign-in.
- Page headings follow the selected language.
- Playwright beta suite (`e2e/`), beta report and UAT checklist (`docs/qa/`).

#### Fixed

- Assistant panel sends the scope the API accepts (it was refused with 422).
- Tester **Pass** moves the task to Done; queue actions announce only what the
  server accepted.
- Query `nin` on array fields; malformed URL escapes return 400 instead of 500;
  NUL in object keys no longer poisons jsonb rows; the Messages filter is
  accessible.
- Frontend: deployment ages from relative labels, Python/PowerShell request
  snippets, code input keeps digits in place, email addresses are not mentions.

#### Security

- Audit trail, logs, metrics, config, posture, rate limits and backup status
  require Administration:view; the query runner's `audit` collection is empty
  for everyone else.
- An Owner's narrowly scoped token no longer sees every product or restricted docs.
- The last active Owner cannot be deactivated, and nobody can change their own status.
- Text uploads refuse every WHATWG HTML sniffing pattern; audit CSV export
  neutralises spreadsheet formulas; the post-sign-in return path refuses
  cross-origin and backslash forms.
- Dependencies: Vite 8, Vitest 5, React Router 7; the production dependency
  audit is clean.

### Wave 4 — finalise the platform (build lanes merged into `wave4/integration`)

Owner decisions: PostgreSQL, S3-compatible object storage (MinIO locally), a
Python ML service, Docker Compose behind a Caddy edge; every domain gets a
real backend module (`docs/agents/WAVE4.md`). The API grew from 90 to 181
routes; the backend smoke suite from 32 to 157 checks.

#### Added

- **Persistence (B-DATA):** PostgreSQL behind the `Collection` seam — generic
  JSONB `documents` table, ordered write queue, migrations, `hydrateAll()` at
  boot, seeding only outside production on an empty database, append-only
  `audit_entries` mirror; sessions, sign-ins, JIT grants and TOTP counters
  persisted; DB-aware `/api/ready`.
- **Security (SEC):** personal access tokens (`/api/tokens`; scoped, hashed,
  expiring, never step-up); real WebAuthn for sign-in, step-up and unlock;
  TOTP enrolment (`/api/auth/totp/*`) and first-factor enrolment during sign-in
  (`/api/auth/mfa/enroll`, `/confirm`); secrets sealed with
  `DATA_ENCRYPTION_KEY`; per-account rate limiting; per-subscriber filtering of
  `/api/_events`; production refuses demo settings; `bootstrap-owner` command.
- **Storage (STORAGE):** S3 client with SigV4, presigned uploads with
  size/type/magic-byte checks (`/api/files/*`), encrypted application
  backups in an Object-Lock bucket with dry-run restore
  (`POST /api/backups/:id/restore`), audit archive to a WORM bucket, MinIO
  bootstrap with least-privilege users.
- **Engineering (B-DOMAIN):** GitHub App (webhook with HMAC and replay
  protection, install status), repositories, pull requests with reviews, CI
  runs, code findings, SSRF-safe uptime monitors that open incidents,
  integrations (Slack, generic webhook, PagerDuty) with signed, retried
  outbound webhooks.
- **Collaboration (B-COLLAB):** channels, DMs, messages, threads, reactions,
  pins and polls; authenticated realtime stream `/api/stream`; workspaces;
  notifications with mail digests; server-side onboarding (NDA, profile);
  account recovery without enumeration; offboarding; doc versions, diffs and
  comments; SMTP/console mail.
- **ML (ML):** Python FastAPI service with task ETA, overdue, deploy-risk and
  sign-in anomaly models, signed model registry, promotion gate, assistant on
  the Anthropic API; backend bridge `/api/insights/*`, `/api/assistant/ask`
  with heuristic fallbacks.
- **Infrastructure (INFRA):** Dockerfiles, `docker-compose.yml` (+ dev
  override), Caddy edge, nginx, secrets generation, database backup/restore
  scripts, deploy script with health gate and automatic rollback, CI with
  image signing, SBOM and provenance; `docs/deploy/` runbook and architecture.
- **Frontend (F-SEC, F-ENG, F-COLLAB):** cookie-only API client, real WebAuthn
  and lock screen, server-driven onboarding, sandboxed code runner, CSP;
  engineering pages on the new APIs with demo badges; messaging, workspaces,
  docs collaboration, team and offboarding on the new APIs.
- **Docs (DOCS):** documentation set under `docs/` (architecture and ADRs
  0001–0008, getting started, concepts, API guides including realtime and
  webhooks, a user guide per role, operations including deployment and first
  run, storage, backups, known limits, ML, glossary), `Backend/README.md`,
  `Frontend/README.md`; generated API reference, permission matrix, error-code
  catalogue and environment-variable list (`cd docs && npm run gen`), and a
  link and file-path checker (`npm run check`).

#### Changed

- Browsers no longer receive or store the session token; the body token is
  returned only to CLI clients (`X-DevHQ-Client: cli`, no `Origin`).
- The demo MFA code is accepted only for seeded demo accounts without a factor.
- `CONTRIBUTING.md` rewritten to match the actual scripts, hard rules and
  checks.

#### Security

- Addressed in code after the phase-1 assessment
  (`docs/security/assessment/REPORT.md`): unscoped `/api/_events` broadcast
  (CYBER-001, `Backend/security/eventPolicy.ts`), universal demo MFA code
  (CYBER-002, `demoCodeAllowed` in `Backend/routes/auth.routes.ts`), bearer
  token in response bodies and `sessionStorage` (CYBER-003, cookie-only client
  and `wantsBodyToken`). The assessment's second pass will confirm.

#### Known limits

- One backend replica; synthetic ML models until real history passes the
  promotion gate; demo mode must be off on internet-facing staging; MinIO SSE
  needs a KMS key in production; French and Spanish cover navigation and page headings only; see
  `docs/operations/known-limits.md`.

### Wave 2 — core domain over the API (accepted 2026-10-30)

#### Added

- Task activity endpoints: `GET /api/tasks/_activity`,
  `POST /api/tasks/:key/comments`, `POST /api/tasks/:key/subtasks`,
  `PATCH /api/tasks/:key/subtasks/:subtaskId`, `POST /api/tasks/:key/time`;
  and `GET /api/products`.
- Task reads carry `comments`, `overdue`, `pr`, `blockedBy`, `createdBy`,
  `createdAt`; deployments carry `provider`; incidents carry `service` and
  `impact`. Seed tasks extended to the full demo set (18).
- Seven new smoke checks.

#### Changed

- Web app reads tasks (`WorkContext`), the scope picker (`/api/scope`), docs
  (`DocsContext`), deployments and incidents (with approvals behind real
  step-up), the team directory and the audit trail from the API instead of
  `Frontend/src/data/*`.

#### Known gaps

- Doc versions, inline doc comments, incident next steps, and My work's
  approvals/mentions panel and monitors remain session-local or seed data.

### Wave 1 — transport and identity (accepted 2026-10-30)

#### Added

- Vite dev proxy `/api` → `127.0.0.1:8080`, so the app and API share an origin.
- `Frontend/src/api/client.ts`: typed `ApiError`, `401` → sign-out, step-up
  challenge → re-verification, token rotation handling.
- `GET /api/me/capabilities` → `{role, products, matrix, levels}`.
- `AuthContext` on the real API: session bootstrap, sign-in, MFA, demo,
  sign-out, step-up unlock. `can()` / `canDo()` derive from capabilities; the
  member directory comes from `/api/team`.
- ESLint 9 flat configs for both packages; `lint` passes with 0 warnings.

#### Fixed

- Frontend typecheck errors (nav entry types, icon props, editor callbacks,
  WebAuthn buffer types, `react-jsx`): 0 errors.

### Wave 0 — unblock (accepted)

#### Fixed

- The API could not boot: `HttpError` used constructor parameter properties,
  which strip-only type stripping rejects.
- `/console` and `/backend.html` returned 404; the console file now lives at
  `Backend/backend.html`.
- The smoke test imported a non-existent path and `test` scripts were
  `echo … && exit 0`; `npm run smoke` now runs real checks and `npm test` runs
  it.
- Frontend `npm install` failed on `node:*` built-ins listed as dependencies.
- Backend `typecheck` reported 133 errors from two missing compiler flags
  (`allowImportingTsExtensions`, `verbatimModuleSyntax`): now 0.

#### Added

- Root `.gitignore` for dependencies, build output, `.audit/`, `.backups/`
  and logs.

### Repository setup

#### Added

- Root npm workspace configuration covering `Backend`, `Frontend`, and `Models`.
- Shared tooling configuration: ESLint flat config, Prettier, EditorConfig.
- Security policy (`SECURITY.md`), contribution guide, and code of conduct.
- GitHub Actions workflows for continuous integration and linting.
- Security automation: CodeQL, Gitleaks, Trivy, dependency review, and
  Dependabot version updates.
- Environment variable template (`.env.example`).
- npm security hardening via `.npmrc`: strict SSL, `ignore-scripts=true`
  (blocks dependency lifecycle-script attacks), `audit=true` at high severity,
  and exact version recording.

#### Changed

- `Backend`, `Frontend`, and `Models` are now scoped packages
  (`@devhq/backend`, `@devhq/frontend`, `@devhq/models`) with full package
  metadata: description, author, contributors, repository, bugs, homepage,
  keywords, and engine constraints.
- Workspace scripts standardised on `dev`, `build`, `lint`, `typecheck`,
  `format`, `test`, and `validate`.

#### Security

- Enabled automated dependency and secret scanning in CI.

## [1.0.0] - 2026-10-30

### Added

- Initial repository structure with three independent workspaces:
  - **Backend** — Node.js HTTP API in TypeScript, run directly via Node's
    native type stripping (no build step). Includes authentication, rate
    limiting, security middleware, resilience helpers, and audit logging.
  - **Frontend** — React single-page application built with Vite, TypeScript,
    and Tailwind CSS.
  - **Models** — machine learning workspace for code analysis, anomaly
    detection, task prediction, and productivity insights.
- MIT licence.

[Unreleased]: https://github.com/kelvintawe13/DevHQ/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/kelvintawe13/DevHQ/releases/tag/v2.0.0
[1.0.0]: https://github.com/kelvintawe13/DevHQ/tree/625b26e36432
