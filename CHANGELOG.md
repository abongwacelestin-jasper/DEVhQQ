# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
