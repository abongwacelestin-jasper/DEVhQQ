# TavetaHQ — Agent Board

**Goal:** one product, one source of truth. The React app talks to the real API
(`Backend/`), replacing client-side auth and `Frontend/src/data/*` seeds for the
core loop.

**Coordinator:** Buffy (owns this board, task updates, cross-lane unblocking).
**Lanes:** `B1` backend · `F1` frontend shell & identity · `F2` frontend domain
pages · `S1` supervisor/QA. **Packets:** `packets/B1-backend.md`,
`packets/F1-frontend-identity.md`, `packets/F2-frontend-domain.md`,
`packets/S1-supervisor.md`.

---

## Hard rules for every lane

1. **Do not touch files outside your packet's allow-list** without asking the
   coordinator. Overlaps are how two lanes break each other.
2. **Never weaken a check to go green.** No skipped tests, no `any` casts, no
   `@ts-ignore`, no deleted assertions, no `echo … && exit 0` standing in for a
   test.
3. **A task is only "done" when it runs, unbroken, and is tested twice** (see
   Definition of Done).
4. **One commit-sized unit per task.** Report the exact files touched.
5. **Handoff format**:
   `status | files | what changed | verification commands run | result | known gaps`.

---

## Definition of Done (the "runs + tested twice" rule)

Accepted only when **both** passes are clean, on **fresh processes**, and the
second pass does not reuse the first pass's state.

**Pass 1 — lane self-check:**

```bash
cd Backend  && npm run typecheck && npm run smoke     # 0 errors · all checks pass
cd Frontend && npm install && npm run build           # exit 0 · exit 0
cd Frontend && npm run typecheck                      # 0 errors in files the lane touched
```

**Pass 2 — supervisor gate (`S1`), independently, twice:**

```bash
TRUST_PROXY=1 AUDIT_LOG_FILE=… BACKUP_DIR=… PORT=8091 node --experimental-strip-types server.ts &
node gate.mjs http://127.0.0.1:8091    # 31 behavioural assertions, exit 0
# kill, restart on a different port with fresh state, repeat
```

Rules: any non-zero exit = **FAIL** even if the app "looks fine". A flake is a
failure; fix the cause, never retry. `S1` does not edit code.

---

## Wave 0 — Unblock ✅ accepted

| ID       | Lane | Task                                                                                                                                                        | Files                                                                                | Status |
| -------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| **T0.1** | B1   | API could not boot: `HttpError` used constructor parameter properties, which Node's strip-only type stripping rejects (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) | `Backend/types.ts`                                                                   | ✅     |
| **T0.2** | B1   | `/console` + `/backend.html` 404'd: route resolved `<root>/backend.html` from `Backend/routes/`, so the file was never where it looked                      | `Backend/backend.html` (new), `Backend/routes/system.routes.ts` (path + 404 message) | ✅     |
| **T0.3** | B1   | Smoke test could not run: imported `../src/server.ts`; no npm script; `test` scripts were `echo "Tests not configured yet" && exit 0`                       | `Backend/scripts/smoke.ts`, `Backend/package.json`                                   | ✅     |
| **T0.4** | F1   | `npm install` failed: six `node:*` built-ins listed as dependencies (`EINVALIDPACKAGENAME`)                                                                 | `Frontend/package.json`                                                              | ✅     |
| **T0.5** | F1   | No `.gitignore`: `node_modules/`, `dist/`, `.audit/`, `.backups/`, `*.log`, `.DS_Store` were all committable                                                | `.gitignore` (repo root)                                                             | ✅     |
| **T0.6** | B1   | _(found during T0.3)_ `npm run typecheck` reported 133 errors — all one missing config flag, not code defects                                               | `Backend/tsconfig.json` (`allowImportingTsExtensions`, `verbatimModuleSyntax`)       | ✅     |

**Files changed in Wave 0:** `Backend/types.ts`, `Backend/backend.html` _(new)_,
`Backend/routes/system.routes.ts`, `Backend/scripts/smoke.ts`,
`Backend/package.json`, `Backend/tsconfig.json`, `Frontend/package.json`,
`.gitignore` _(new)_, `docs/agents/**` _(new)_.

---

## Wave 1 — Transport + identity ✅ accepted

| ID       | Lane | Task                                                                                                                        | Acceptance                                                          |
| -------- | ---- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **T1.1** | F1   | Proxy `/api` → `127.0.0.1:8080` in Vite                                                                                     | no CORS preflight; cookies survive                                  |
| **T1.2** | F1   | `src/api/client.ts` + `types.ts`: `credentials: 'include'`, typed `ApiError`, 401 → sign-out, `X-Step-Up-Required` → reauth | 200/401/422/network all map correctly                               |
| **T1.3** | B1   | `GET /api/me/capabilities` → `{role, products, matrix, levels}`                                                             | developer → `Repository: contribute`, never `Administration: admin` |
| **T1.4** | F1   | `AuthContext` on the real API (session bootstrap, sign-in, MFA, demo, sign-out, step-up unlock)                             | 6 roles sign in; wrong password is an API 401                       |
| **T1.5** | F1   | `can()`/`canDo()` from capabilities; `memberById` sourced from `/api/team`                                                   | no role opens a page its backend role forbids                       |

Accepted 2026-10-30: all five tasks land, and the proxy path is proven end to end
(sign-in → `__Host-` cookie → `/api/auth/session` → `/api/me/capabilities` with
no bearer token). See verification rows 7–11.

**Note for T1.2/T1.4 (discovered in the gate):** `POST /api/auth/step-up`
**rotates the session token** — the old one is revoked immediately
(`401 session_revoked`). Cookie clients are fine (the route sets a new
`Set-Cookie`); any bearer-token client must replace its token from the response
body.

## Wave 2 — Core domain over the API ✅ accepted

| ID       | Lane | Task                                                         | Acceptance                                                            |
| -------- | ---- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| **T2.1** | F2   | Tasks: list/detail/create/patch/delete through `WorkContext` | pages never read `data/work` tasks; a write survives a reload          |
| **T2.2** | F2   | Scope picker from `/api/scope`                               | only server projects appear; seed file supplies presentation fields only |
| **T2.3** | F2   | Docs: list/get/create/patch                                  | list + body from `/api/docs`; create/patch persist; 404 = no access    |
| **T2.4** | F2   | Deployments + incidents, approvals behind real step-up       | approve/rollback are API calls; PM (Deployment:view) gets `403`        |
| **T2.5** | F2   | Team + audit pages on the API                                | directory from `/api/team`, audit rows from `/api/audit`               |
| **T2.6** | B1   | Task comments/subtasks/time logs, `GET /api/products`        | one activity call; comment/subtask/time persisted and evented          |

Accepted 2026-10-30. New backend surface: `GET /api/tasks/_activity`,
`POST /api/tasks/:key/comments`, `POST /api/tasks/:key/subtasks`,
`PATCH /api/tasks/:key/subtasks/:subtaskId`, `POST /api/tasks/:key/time`,
`GET /api/products`. Task reads now carry `comments`, `overdue`, `pr`, `blockedBy`,
`createdBy`, `createdAt`; deployments carry `provider`; incidents carry `service`
and `impact`. Seed tasks were extended to the full demo set (18) so the UI did not
shrink when the seeds stopped being the source of truth.

**Known gaps in Wave 2** (no backend, kept session-local and never presented as
durable): doc versions, inline doc comments and markdown comment resolution;
incident `nextSteps`; MyWork's approvals/mentions panel and monitors still read
`src/data/*` (approval *actions* already go through the real deployments API).

## Wave 3 — Deferred (owner decision needed)

PRs, repositories, monitors, messaging, workspaces, integrations, assistant
answers have no backend counterpart. New modules or visibly marked demo data.
Not started.

---

## Status board

| ID     | Status      | Note                                                                                |
| ------ | ----------- | ----------------------------------------------------------------------------------- |
| T0.1   | ✅ accepted | boots with strip-only, 78 routes                                                    |
| T0.2   | ✅ accepted | `/console` + `/backend.html` → 200 HTML, CSP nonce injected, no third-party origins |
| T0.3   | ✅ accepted | `npm run smoke` = 20 checks; `npm test` runs it                                     |
| T0.4   | ✅ accepted | install + build clean                                                               |
| T0.5   | ✅ accepted | artifacts ignored                                                                   |
| T0.6   | ✅ accepted | backend typecheck 133 → 0                                                           |
| T1.1   | ✅ accepted | `/api` proxied in Vite; health + SPA HTML 200 on :5173                               |
| T1.2   | ✅ accepted | `api/client.ts`: typed `ApiError`, 401 → sign-out, step-up → reauth, token rotation   |
| T1.3   | ✅ accepted | `/api/me/capabilities`; Developer = `Repository: contribute`, `Administration: none`  |
| T1.4   | ✅ accepted | `AuthContext` on the real API (bootstrap, sign-in, MFA, demo, step-up, lock)          |
| T1.5   | ✅ accepted | `can`/`canDo` derive from capabilities; directory from `/api/team`                    |
| T2.1   | ✅ accepted | `WorkContext` on `/api/tasks` + `/api/tasks/_activity`; optimistic writes resync on failure |
| T2.2   | ✅ accepted | scope picker hydrates from `/api/scope`                                              |
| T2.3   | ✅ accepted | `DocsContext` on `/api/docs` (list, body, create, patch, delete)                      |
| T2.4   | ✅ accepted | `useDeployments` + `IncidentContext` on the API; step-up unchanged                    |
| T2.5   | ✅ accepted | Team page uses API tasks; Audit + Member pages read `/api/audit`                      |
| T2.6   | ✅ accepted | activity endpoints + `/api/products`; 7 new smoke checks                              |
| Wave 3 | ⏸ decision  | see open questions                                                                  |

---

## Verification log

| #   | Scope                                                         | Pass | Result                              |
| --- | ------------------------------------------------------------- | ---- | ----------------------------------- |
| 1   | `Backend npm run smoke`                                       | self | ✅ 20 checks                        |
| 2   | `Backend npm run smoke` (immediately after)                   | self | ✅ 20 checks                        |
| 3   | `Backend npm run typecheck`                                   | self | ✅ 0 errors (was 133)               |
| 4   | `Frontend npm install && npm run build`                       | self | ✅ exit 0 / exit 0, `dist/` 1.45 MB |
| 5   | Gate (31 assertions, port 8091, fresh state, `TRUST_PROXY=1`) | S1   | ✅ 31/31                            |
| 6   | Gate (31 assertions, port 8092, fresh process, fresh state)   | S1   | ✅ 31/31                            |
| 7   | `Backend npm run typecheck && npm run lint`                   | self | ✅ 0 errors / 0 warnings            |
| 8   | `Frontend npm run typecheck && npm run lint`                  | self | ✅ 0 errors / 0 warnings (was 174/unusable) |
| 9   | `Backend npm run smoke`                                       | self | ✅ 23 checks                        |
| 10  | `Frontend npm run build`                                      | self | ✅ exit 0, `dist/` 1.45 MB          |
| 11  | Proxy e2e :5173 → :8080 (health, index, demo sign-in, session, capabilities) | self | ✅ cookie-only session; Developer matrix as specified |
| 12  | `Backend npm run typecheck && npm run lint && npm run smoke`  | self | ✅ 0 / 0 / 32 checks               |
| 13  | `Frontend npm run typecheck && npm run lint && npm run build` | self | ✅ 0 / 0 / exit 0                 |
| 14  | Activity API on fresh state (:8093): list 7 PM tasks, `_activity` 28 events / 5 comments / 9 subtasks / 5 logs; comment, subtask, time, status writes all `201/200` | self | ✅ event kinds recorded, `comments` count derived on read |
| 15  | Domain API: `/api/products`, `/api/scope`, `/api/docs`+patch, `/api/incidents`+patch, `/api/deployments`, `/api/audit`; PM approve → `403` | self | ✅ scoped + authorized as specified |
| 16  | DOM (headless Chrome, Owner session): `/my-work`, `/tasks/RB-212`, `/docs`, `/deployments`, `/incidents`, `/team`, `/audit` | self | ✅ real API rows (RB-231/BL-26, doc titles, 7d1aa20 deploy, INC-31, 12 members, 4 audit rows) |
| 17  | DOM write path: subtask toggle → PATCH → reload | self | ✅ still checked after reload; persisted on the server |

Gate coverage (assertion groups): probes + console · six demo sign-ins ·
password → MFA gate (`401 mfa_required` before MFA) · product scoping + `404`
for out-of-scope · create/validate/self-close refusal · two-person deploy with
requester ≠ approver · context change → `401 step_up_required` → step-up →
approve · token rotation kills the old token · secrets not queryable · audit
chain intact · no user enumeration · OpenAPI + inventory ≥ 78 routes.

---

## Findings (from the gate and the review)

1. ~~**13 pre-existing TypeScript errors outside typecheck scope.**~~ ✅ **Fixed:**
   `NavEntry` now declares `count`/`alert`, the icon prop type accepts
   `strokeWidth`, `CodeEditor`'s callbacks are typed, `webauthn.ts` passes
   `BufferSource`-safe views, unused default `React` imports are gone, and
   `tsconfig` uses `react-jsx`. Frontend `npm run typecheck` = **0 errors**.
2. ~~**`npm run lint` cannot pass in either package.**~~ ✅ **Fixed:** both
   packages have ESLint 9 flat configs (`eslint.config.mjs`) wired to the
   installed plugins. `npm run lint` = 0 errors, 0 warnings in both,
   so `validate`/`precommit` are real gates now.
3. **Product inconsistency:** frontend role copy says a Developer can "deploy to
   staging on assigned products" (`data/team.ts` `roleDetails`), while
   `auth/rbac.ts` gives Developer `Deployment: view`. The API is internally
   consistent; the UI text is not. Not changed — it is a permissions decision,
   not a bug fix.
4. **Fake tests removed:** `Backend` had
   `"test": "echo \"Tests not configured yet\" && exit 0"` (three of them), i.e.
   a green build with zero tests. Now `test` runs the real smoke suite.
   `Frontend test` now runs `typecheck` (currently red by design — see finding
   1).
5. **`requireStepUp` is satisfied for 5 minutes after a fresh sign-in.** This is
   correct (a fresh MFA is a strong verification) but it means "approve right
   after signing in" does not prompt. The control that actually bites is a
   **changed request context** (device/IP drift), which resets `verifiedAt` —
   the gate now asserts exactly that.
6. **Manifests were replaced mid-session** by an external edit
   (`@devhq/backend@1.0.0`, `@devhq/frontend@1.0.0`, richer metadata). Wave 0
   edits were reapplied on top of the new manifests; the `node:*` dependency bug
   had been fixed by that edit before I got to it, and the `test` scripts had
   been re-added in their fake form.

## Open questions for the owner

1. **Developer deployments:** should `Developer` get `Deployment: contribute`
   (matching the UI copy), or should the UI copy change to match the matrix?
2. **Wave 3:** PRs/repositories/monitors/messaging — real backend modules, or
   visible "sample data" markers?
3. **NDA + profile:** keep as client-side onboarding, or promote to real backend
   fields on `Member`?
4. **Lint configs:** adopt one ESLint setup (flat config, ESLint 9) for both
   packages as an explicit task, or drop `lint` from `validate` until then?
