# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Wave 4 — in progress

> Placeholder. Wave 4 lanes (INFRA, B-DATA, SEC, STORAGE, B-DOMAIN, B-COLLAB,
> ML, F-SEC, F-ENG, F-COLLAB, then TEST, QA, CYBER, DOCS) add their entries
> here as they merge into `wave4/integration`. Scope: PostgreSQL persistence
> behind the `Collection` seam, S3-compatible object storage, a Python ML
> service and assistant, Docker Compose with an edge proxy, a GitHub App,
> messaging/workspaces/notifications backends, personal access tokens and
> real WebAuthn (`docs/agents/WAVE4.md`).

#### Added

- Persistence seam `Backend/store/collection.ts` (`Collection`, `setDriver`,
  `hydrateAll`), in-memory driver by default.
- Documentation set under `docs/`: architecture overview and ADRs 0001–0008,
  getting started and troubleshooting, concepts, API guides, a user guide per
  role, operations, ML overview and glossary; `Backend/README.md` and
  `Frontend/README.md`.
- Generated docs that cannot drift: API reference from the live route table,
  permission matrix from `Backend/auth/rbac.ts` and the frontend capability
  mapping, error-code catalogue from every `HttpError` call site
  (`cd docs && npm run gen`), plus a link and file-path checker
  (`npm run check`).

#### Changed

- `CONTRIBUTING.md` rewritten to match the actual scripts, hard rules and
  checks.

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

[Unreleased]: https://github.com/devhq/devhq/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/devhq/devhq/releases/tag/v1.0.0
