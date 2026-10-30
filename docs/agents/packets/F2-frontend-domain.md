# Packet F2 — Frontend lane B: domain pages over the API

**You own:** `Frontend/src/contexts/WorkContext.tsx`, `IncidentContext.tsx`,
`DocsContext.tsx`, `ProductFilterContext.tsx`, `Frontend/src/pages/**`,
`Frontend/src/components/**`, `Frontend/src/data/*` (deletions only, after
migration). **You may not edit:** `Frontend/src/api/**`, `AuthContext.tsx`,
`vite.config.ts` (F1), `Backend/` (B1). **Starts after:** the Wave 1 gate
passes. `F2` consumes `F1`'s `api()` client — do not build a second one.

## Context you need

The UI's state layer is already the right seam. Pages read data from contexts,
and contexts re-export seeds:

| Context                | Seeds today                                                                   | API today                                                                 |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `WorkContext`          | `data/work.ts` (18 tasks, 7 projects), `data/taskActivity.ts`, `data/team.ts` | `GET/POST/PATCH/DELETE /api/tasks`, `GET /api/projects`, `GET /api/scope` |
| `DocsContext`          | `data/docs.ts` (6 docs)                                                       | `GET/POST/PATCH/DELETE /api/docs`                                         |
| `IncidentContext`      | `data/operations.ts`, `data/incidentHistory.ts`                               | `GET/POST/PATCH /api/incidents`, `GET /api/incidents/_stats`              |
| `ProductFilterContext` | `data/portfolio.ts`, `data/work.ts`                                           | `GET /api/scope`                                                          |

Allowed not to migrate (Wave 3, no backend counterpart — leave the imports
alone): pull requests, repositories, monitors, messaging, workspaces,
integrations, assistant, code-security.

## Adapters you must write (one file: `src/api/adapters.ts`, ask F1 to place it under `src/api/`)

- `due`: API returns ISO `YYYY-MM-DD`; UI renders `Oct 28`. Parse with
  `utils/date.ts` `parseWhen`, render with the existing formatters. Never store
  a display string in state that came from the API.
- `tasks`: API list is `{ total, limit, offset, items }` → `Task[]`. Keep
  `overdue` client-computed via the existing `isOverdue`.
- `id drift`: the API is canonical. Render whatever ids it returns (`d-…` /
  `INC-…`); do not remap to the old `dp-207` fixtures. Route params
  (`/deployments/:deployId`) must accept the API ids.
- `project→task`: keep `projectId`; the UI's `p1…p7` still exist server-side.

## Tasks

### T2.1 — Tasks through the API

`WorkContext` keeps its public shape
(`tasks, events, comments, subtasks, timeLogs, createTask, updateTask, addComment, addSubtask, toggleSubtask, logTime, lastActivity`)
but loads from `GET /api/tasks` and mutates through the API.

- Optimistic update, roll back the row and toast the API's message on failure.
- `403 self_close` must surface as "a reviewer or manager must close your own
  task".
- 404 on an out-of-scope key renders the existing "not found" state, not an
  error page.
- Events/comments/subtasks/time logs come from the new `T2.6` routes; if they
  are not deployed yet, keep them local **and** leave a single
  `// LOCAL-ONLY until T2.6` marker (one place, not scattered).

**Acceptance:** as `developer`, RB-212 loads, a status change persists across
reload, `BL-17` is a 404/not-found, self-close is refused with the correct
message.

### T2.2 — Scope picker from `/api/scope`

`ProductFilterContext` uses `{products, projects}` from the API; a role with one
product sees exactly one. Stored scope in `localStorage` must be validated
against the API list on hydrate (an old scope for a revoked product must reset
to `all`).

**Acceptance:** sign in as `developer` → scope shows only RenewBerry; as `Owner`
→ three products.

### T2.3 — Docs

List/meta (no body in the list response), detail, create, patch. Restricted docs
stay invisible to non-editors (backend already enforces; the UI must not imply
otherwise).

**Acceptance:** `m4` cannot open `doc-api-runbook`; creating a doc as `m2` lands
it under project `p1` and it survives reload.

### T2.4 — Deployments + incidents

Request a deployment, approve a pending production deploy, roll back; declare an
incident, change status/severity, add a timeline note.

- Approval **must** go through `useReauth().requestReauth` →
  `POST /api/auth/step-up`.
- Requester cannot approve their own deploy (backend refuses; show its message).
- Keep the existing "waiting on your approval" UI; the list now comes from the
  API.

**Acceptance:** as `operations`, approve `d-1044`-style pending deploy after
entering `246810`; as the requester, approval is refused; incident status change
appends a timeline entry that survives reload.

### T2.5 — Team + audit

`/team`, `/team/:memberId` read `GET /api/team`; role/product/status change →
`PATCH /api/team/:memberId` behind `requestReauth`. `/audit` reads
`GET /api/audit` and shows `GET /api/audit/verify` as a real chain status, not a
decorative badge.

**Acceptance:** role change without step-up shows the reauth dialog and calls
`step-up`; after the change the target's sessions are revoked (visible in the
sessions list); audit page shows `intact` from the API.

## Rules

- No page may import a seed file after its domain is migrated. Delete the seed
  only when `grep -r "data/<name>'"` is empty — report the count before
  deleting.
- No optimistic write without rollback. No `catch {}` that hides an API failure.
- Loading and error states are part of acceptance, not polish: a dead backend
  must render a retry affordance, never a blank page.

## Verification you must run before handoff

```bash
cd Frontend
npm run typecheck     # zero errors in files you touched
npm run build         # exit 0
# end-to-end, backend on :8080, Vite on :5173, for each of the 6 roles:
#   sign in → land on home → open the migrated pages → perform one write → reload → confirm persisted
```

## Escalate instead of improvising when

- an endpoint you need does not exist (send it to `B1` through the coordinator
  rather than inventing a mock),
- a page needs a field the API does not return,
- migrating a page would require changing a component outside your file list,
- you are tempted to keep a seed as a fallback for a migrated domain (do not —
  it re-creates two sources of truth).
