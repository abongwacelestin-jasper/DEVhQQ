# Wave 4 — Finalise the platform (10 parallel lanes)

**Owner decisions (2026-11-07):** PostgreSQL · S3-compatible object storage
(MinIO locally) · Python ML service · Docker Compose + generic edge.
Wave 3 is approved: **every domain gets a real backend module**; no page may
present seed data as if it were live. Developer keeps `Deployment: view`
(least privilege) — UI copy changes to match the matrix, not the other way.

**Integration branch:** `wave4/integration`. Every lane works in its own git
worktree/branch cut from it. The coordinator merges lanes in this order:
`INFRA → B-DATA → SEC → STORAGE → B-DOMAIN → B-COLLAB → ML → F-SEC → F-ENG → F-COLLAB`.

Read `docs/agents/BOARD.md` (history, hard rules, definition of done) first.
Its hard rules still apply: never weaken a check, no `any`, no `@ts-ignore`,
no fake tests, every state change audited, out-of-scope = 404.

---

## 1. Lanes and file ownership

You may **create** any new file inside your owned paths. You may **edit**
only the files listed for you. Shared hotspot files (§2) allow *additive,
minimal* edits only.

| Lane | Owns (create + edit) | Edits allowed elsewhere |
|---|---|---|
| **B-DATA** Postgres persistence | `Backend/store/**`, `Backend/db/**` (new: migrations, driver, migrate script), `Backend/auth/sessions.ts`, `Backend/auth/jit.ts` (storage only) | `.save(key)` calls after in-place mutations in existing `Backend/routes/*.ts`; `Backend/package.json` (add `pg` + `@types/pg`, scripts `migrate`, `smoke:pg`); `Backend/scripts/smoke.ts` (additive) |
| **SEC** Backend + platform security | `Backend/security/**`, `Backend/middleware/**`, `Backend/auth/{rbac,totp,webauthn}.ts`, `Backend/routes/auth.routes.ts`, `Backend/routes/security.routes.ts`, new `Backend/routes/tokens.routes.ts`, `docs/security/**`, root `SECURITY.md` | `Backend/config/env.ts` (additive), `Backend/scripts/smoke.ts` (additive) |
| **STORAGE** Object storage | `Backend/storage/**`, new `Backend/routes/files.routes.ts`, `Backend/resilience/**`, `infra/minio/**`, new `Frontend/src/components/ui/FileUpload.tsx`, new `Frontend/src/hooks/useUpload.ts` | `Backend/audit/auditLog.ts` (archive sink only), `Backend/config/env.ts` (additive) |
| **B-DOMAIN** Engineering domains | new `Backend/routes/{github,repos,pulls,ci,monitors,integrations,webhooks}.routes.ts`, `Backend/integrations/github/**`, `Backend/monitors/**`, `Backend/integrations/webhooks/**`, `Backend/domain/engineering/**` | — |
| **B-COLLAB** Collaboration domains | new `Backend/routes/{messaging,workspaces,notifications,onboarding,recovery,offboarding,doc-collab}.routes.ts`, `Backend/domain/collab/**`, `Backend/mail/**` | `Backend/types.ts` (add optional `Member` fields only: `ndaSignedAt`, `ndaVersion`, `profile`, `offboarding`) |
| **ML** Python ML service + backend bridge | `Models/**` (whole tree, may replace `package.json`/`index.ts`), new `Backend/integrations/ml/**`, new `Backend/routes/{insights,assistant}.routes.ts` | — |
| **INFRA** Containers, CI/CD, edge | `infra/**` (except `infra/minio/**`), `**/Dockerfile`, `**/.dockerignore`, `docker-compose*.yml`, `.github/**`, `.env.example`, `Makefile`, `docs/deploy/**`, root `package.json`, root `README.md` | — |
| **F-SEC** Frontend identity & security | `Frontend/src/api/**`, `contexts/{AuthContext,ReauthContext}.tsx`, `components/{auth,security}/**`, `pages/auth/**`, `pages/SecurityCenter.tsx`, `utils/{webauthn,codeRunner,consoleClient,codespacesApi,authRoutes}.ts`, `hooks/{useIdleLock,useContinuousVerification,useCodeRunner}.ts`, `data/{roles,sessions,security,securityFramework,nda}.ts`, `Frontend/vite.config.ts`, `Frontend/index.html` (CSP meta only) | — |
| **F-ENG** Frontend engineering pages | `pages/{Repositories,RepositoryDetail,PullRequests,PullRequestDetail,Monitors,Integrations,IntegrationDetail,Deployments,DeploymentDetail,CodeSecurity,TestQueue,DevTools,Incidents,IncidentDetail}.tsx`, `pages/product/**`, `components/{engineering,delivery,integrations,operations}/**`, `hooks/{useGitHubApp,useDeployments,useOverviewData}.ts`, `data/{engineering,operations,incidentHistory,deployTopology,codeSecurity,devtools}.ts`, `contexts/IncidentContext.tsx` | — |
| **F-COLLAB** Frontend collaboration pages | `pages/{Messages,Workspaces,Docs,MyWork,AssignedToMe,Assignments,WorkActivity,Team,MemberDetail}.tsx`, `components/{messaging,docs,assistant,workspace,assignments,team,work}/**`, `contexts/{Messaging,Docs,Workspace,Offboarding,WorkspaceUI,Work}Context.tsx`, `hooks/{useWorkspaceAssistant,useAssignmentEmails,usePresence,useStarredDocs,useTeamData}.ts`, `data/{messaging,workspaces,assistant,docs,team,work,taskActivity}.ts` | — |

Anything not listed (e.g. `components/layout/**`, `components/ui/**` other
than STORAGE's two files, `utils/*` not listed) is **read-only**. If you need a
change there, describe it in your handoff under *requests for coordinator*.

## 2. Shared hotspot files (additive edits only)

- `Backend/server.ts` — add exactly one `registerXRoutes(router)` line (plus
  its import) per new route module, appended after the existing ones. B-DATA
  may also add driver install + `await hydrateAll()` inside `buildApp()`.
- `Backend/types.ts` — do not edit (except B-COLLAB's Member fields). Put new
  domain types in your own module (`Backend/domain/<lane>/types.ts`).
- `Frontend/src/App.tsx` — add routes only, no reordering of providers.
- `Backend/scripts/smoke.ts` — add checks in your own clearly labelled block.
  Never remove or relax an existing check.

The coordinator resolves merge conflicts in these files.

## 3. Persistence contract (all backend lanes)

`Backend/store/collection.ts` is the seam:

```ts
import { createCollection } from '../store/collection.ts';
export const channels = createCollection<Channel>('channels'); // module scope, unique name
channels.set(id, row);         // persisted
row.archived = true; channels.save(id); // in-place mutation → MUST call save
channels.delete(id);           // persisted
```

- Handlers stay synchronous and read from memory.
- B-DATA backs it with PostgreSQL: one generic `documents(collection text,
  key text, data jsonb, updated_at timestamptz, primary key(collection,key))`
  table (or per-collection tables) so other lanes never write SQL; writes are
  queued and flushed in order; boot runs migrations then `hydrateAll()`.
  B-DATA also converts the existing `db.*` Maps to collections and persists
  sessions, sign-ins and JIT grants.
- Without `DATABASE_URL` everything runs in memory (smoke tests, local quick start).
- Seed data loads **only** when `NODE_ENV !== 'production'` **and** the
  database is empty.

## 4. Environment variables (single source of truth — INFRA writes `.env.example`)

| Var | Used by | Notes |
|---|---|---|
| `NODE_ENV`, `PORT` (8080), `APP_ORIGIN`, `PUBLIC_URL`, `CORS_ORIGINS`, `TRUST_PROXY` | backend | existing |
| `SESSION_SECRET`, `SESSION_SECRET_PREVIOUS` | backend | existing; ≥64 hex in prod |
| `DATA_ENCRYPTION_KEY` | SEC | 32-byte hex, AES-256-GCM for TOTP secrets / tokens at rest |
| `DATABASE_URL`, `DATABASE_SSL` | B-DATA | `postgres://devhq:…@postgres:5432/devhq` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_BUCKET_UPLOADS`, `S3_BUCKET_BACKUPS`, `S3_BUCKET_AUDIT`, `S3_BUCKET_MODELS` | STORAGE, ML | MinIO at `http://minio:9000` locally |
| `ML_SERVICE_URL` (`http://models:8000`), `ML_SERVICE_TOKEN` | ML (both sides) | shared secret; backend signs requests with HMAC |
| `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL` (default `claude-sonnet-5-5`) | ML (Python) | assistant answers; never exposed to the browser |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `MAIL_TRANSPORT` (`smtp`\|`console`) | B-COLLAB | console transport in dev |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_TOKEN` | B-DOMAIN | GitHub App; demo fallback when unset |
| `DEMO_DISABLED`, `DEMO_PASSWORD`, `DEMO_MFA_CODE`, `DEMO_TOTP_SECRET` | backend | existing |

Every optional integration must **degrade gracefully** when its env vars are
missing: the endpoint returns `503 {code:"integration_unconfigured"}` (or a
clearly labelled `source:"demo"` payload in non-production), never a crash.

## 5. Ports / services (docker-compose service names)

`edge` (Caddy, 80/443) → `frontend` (nginx static, 8081) and `/api` → `backend`
(8080) · `models` (8000, internal network only) · `postgres` (5432, internal) ·
`minio` (9000 API / 9001 console, internal; console only in dev profile).

## 6. API contracts (backend lanes implement, frontend lanes consume)

All responses JSON, errors `{error:{code,message,requestId,details?}}`.
Lists return `{items:[…], nextCursor?}` unless noted. Every route is registered
through `Router.add` with a summary + tag (it feeds OpenAPI and the console).
Product scoping + RBAC per BOARD rules.

**B-DOMAIN**
- `GET /api/repos` · `GET /api/repos/:repoId` · `POST /api/repos` (link, Repository:manage)
- `GET /api/pulls?repo=&state=&author=` · `GET /api/pulls/:repoId/:number` · `POST /api/pulls/:repoId/:number/review` `{decision:'approve'|'request-changes'|'comment', body}`
- `GET /api/ci/runs?repo=&branch=` · `GET /api/ci/runs/:runId`
- `POST /api/github/webhook` (public, HMAC `X-Hub-Signature-256` verified on raw body, replay-protected by delivery id) · `GET /api/github/app` (install status) · `GET /api/github/install-url`
- `GET/POST /api/monitors`, `PATCH/DELETE /api/monitors/:id`, `GET /api/monitors/:id/checks` — a scheduler performs HTTP checks (SSRF-safe: block private/link-local/metadata IPs, allow-list schemes, timeouts) and opens an incident after N failures
- `GET /api/integrations`, `POST /api/integrations/:kind/connect`, `DELETE /api/integrations/:id`, `GET/POST/DELETE /api/integrations/:id/webhooks` — outbound webhooks signed with HMAC, retried with backoff, delivery log
- `GET /api/security/code-findings?repo=` (secret scan / dependency findings from CI or webhook ingest)

**B-COLLAB**
- `GET/POST /api/channels`, `PATCH /api/channels/:id`, `GET/POST /api/channels/:id/messages?before=`, `PATCH/DELETE /api/messages/:id`, `POST /api/messages/:id/reactions`, `POST /api/messages/:id/pin`; realtime via existing SSE `GET /api/_events` topics `message.*` (or a new authenticated `GET /api/stream`)
- `GET/POST /api/workspaces`, `PATCH /api/workspaces/:id`
- `GET /api/notifications`, `POST /api/notifications/read` (mentions, assignments, approvals)
- `POST /api/onboarding/nda` `{version, signedName}` · `POST /api/onboarding/profile` · `GET /api/onboarding` → server is the authority for the NDA/profile stages
- `POST /api/auth/recovery/request` `{email}` (always 202, no enumeration) · `POST /api/auth/recovery/reset` `{token,password}` (revokes all sessions)
- `GET/POST /api/docs/:docId/versions`, `GET/POST /api/docs/:docId/comments`, `PATCH /api/docs/:docId/comments/:commentId` (resolve)
- `POST /api/offboarding/:memberId` (start), `PATCH /api/offboarding/:memberId` (checklist) — Administration:manage + step-up

**SEC**
- `GET/POST /api/tokens`, `DELETE /api/tokens/:id` — scoped personal access tokens (hashed at rest, shown once, expiry required)
- Real WebAuthn for sign-in, step-up and lock-screen unlock through the existing `/api/auth/webauthn/*` and `/api/auth/passkeys*` routes
- `POST /api/auth/totp/enroll` + `/api/auth/totp/confirm` (encrypted secret at rest)

**STORAGE**
- `POST /api/files/uploads` `{purpose:'doc-attachment'|'avatar'|'message-attachment', contentType, size, name, refId}` → `{fileId, uploadUrl, headers, expiresAt}` (presigned PUT, size/type allow-list)
- `POST /api/files/:fileId/complete` (verifies object, size, type, magic bytes) · `GET /api/files/:fileId` → short-lived presigned GET · `DELETE /api/files/:fileId`
- Backups and audit archive ship to their buckets (object lock / WORM in prod).

**ML (backend bridge → Python service)**
- Backend: `GET /api/insights/tasks/:key` (ETA + overdue risk), `GET /api/insights/deployments/:id` (risk), `GET /api/insights/signins/:id` (anomaly), `POST /api/assistant/ask` `{question, scope?}` → `{answer, sources[], model}` (SSE streaming variant `POST /api/assistant/ask/stream` optional)
- Python service (internal only): `GET /health`, `POST /v1/predict/task-eta`, `/v1/predict/overdue`, `/v1/predict/deploy-risk`, `/v1/score/signin-anomaly`, `/v1/assistant/answer`, `POST /v1/train/{model}`; every request authenticated with `ML_SERVICE_TOKEN` HMAC (`X-DevHQ-Signature`, timestamp, 5-min skew).
- Backend falls back to the existing rule-based risk (`lib/geo.ts`) when the service is down; responses carry `source:'model'|'heuristic'`.

## 7. Definition of done (per lane)

1. `cd Backend && npm run typecheck && npm run lint && npm run smoke` — 0 / 0 / all pass (existing 32 checks + yours).
2. `cd Frontend && npm run typecheck && npm run lint && npm run build` — 0 / 0 / exit 0 (frontend lanes; backend lanes must not break it).
3. Lane-specific tests listed in your brief pass **twice on fresh processes**.
4. No secrets committed. No new `any`, `@ts-ignore`, `eslint-disable` without a one-line justification.
5. Commit on your worktree branch with message `wave4(<LANE>): …`.
6. Handoff: `status | branch | files | what changed | verification commands + results | known gaps | requests for coordinator`.

## 8. Installing dependencies in a worktree

Worktrees have no `node_modules`. Run `npm install` in the package you work in
(`.npmrc` sets `ignore-scripts=true`; keep it). If the network is unavailable,
symlink from the main checkout:
`ln -s /Users/macbook/Downloads/DEVHQ/DevHQ/node_modules node_modules` (and
likewise for `Backend/` / `Frontend/`), and say so in your handoff.

---

## 9. Addendum (2026-11-07): assurance lanes

Four more lanes run in parallel with the ten build lanes. Build lanes merge
into `wave4/integration` over time; assurance lanes work against the current
code, then the coordinator asks for a **second pass on the merged branch**.

| Lane | Owns (create + edit) | Edits allowed elsewhere |
|---|---|---|
| **TEST** Unit & integration tests | `Backend/test/**`, `Frontend/src/**/*.test.ts(x)`, `Frontend/src/test/**`, `Frontend/vitest.config.ts`, `Models/tests/**` (additive only; ML owns existing files) | `Backend/package.json` + `Frontend/package.json` (test scripts + test devDependencies only) |
| **QA** Beta / end-to-end testing | `e2e/**` (Playwright project at repo root, own `package.json`), `docs/qa/**` | — |
| **CYBER** Independent offensive assessment | `security-tests/**` (PoC scripts and automated attack checks), `docs/security/assessment/**` | none: CYBER never fixes app code; findings go to the coordinator |
| **DOCS** Documentation | `docs/**` except `docs/agents/**`, `docs/security/**`, `docs/deploy/**`, `docs/qa/**`; `Backend/README.md`, `Frontend/README.md`, `Models/README.md` (only if ML hasn't created one; otherwise additive sections), `CONTRIBUTING.md`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md` | — |

Merge order: these four land after the ten build lanes.
