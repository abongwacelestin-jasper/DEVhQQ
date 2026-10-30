# Packet B1 — Backend lane

**You own:** `Backend/` only. **You may edit:** `Backend/types.ts`,
`Backend/backend.html` (new), `Backend/scripts/smoke.ts`,
`Backend/package.json`, the specific route files named below,
`Backend/store/db.ts` (Wave 2 only). **You may not edit:** anything under
`Frontend/`, `docs/`, or the repo root. **Do not add npm dependencies** — the
backend is deliberately dependency-free and must stay that way.

## Context you need

- Entry: `node --experimental-strip-types server.ts`, 78 routes, `buildApp()` in
  `Backend/server.ts`.
- Data: `Backend/store/db.ts` (in-memory Maps, seeded, `seed()` is idempotent).
- Auth: HMAC-signed session ids (`security/crypto.ts`), `auth/sessions.ts`,
  `middleware/authenticate.ts`.
- Authorization: `auth/rbac.ts` (`permissionMatrix`, `can`, `canSeeProduct`,
  `requireArea`, `requireStepUp`, `requireElevation`, `assertProduct`).
- Input: allow-list validation only, via `lib/validate.ts` `v.object` + `parse`.
  Unknown fields must 422.
- Every state change must `audit.append(...)`. Never return 403 for an
  out-of-scope resource — 404.

## Wave 0 tasks

### T0.1 — API cannot boot

`Backend/types.ts:140` uses constructor parameter properties
(`constructor(public readonly status: number, …)`), which Node's strip-only type
stripping rejects: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Boot dies before any
route is registered.

- Rewrite `HttpError` with explicit field declarations + assignments. Keep the
  public shape identical (`status`, `code`, `details`, `message`).
- Do not switch the npm scripts to `--experimental-transform-types` as the fix;
  strip-only compatibility is the requirement.
- Touch no other file.

**Acceptance:** `npm run dev` stays up; `GET /api/health` → 200 `{ok:true}`,
`GET /api/ready` → 200 `{ready:true,auditChain:"intact"}`.

### T0.2 — Console is a dead route

`routes/system.routes.ts` serves
`new URL('../../backend.html', import.meta.url)` → `<root>/backend.html`, which
does not exist, so `GET /console` and `/backend.html` return 404 while
`server.ts` advertises them on boot.

- Add `Backend/backend.html`: one small, self-contained page (no external
  assets, no framework) that shows live `GET /api/health`, `/api/ready`,
  `/api/version` values, links to `/api/openapi.json`, and explains how to reach
  the React console at the frontend origin.
- The page is served with `consoleCsp(nonce)`, so its inline script **must** be
  a plain `<script>` tag that the route rewrites with the nonce (see
  `serveConsole`). No inline event handlers, no `eval`, no external
  fonts/scripts.
- Fetch only public endpoints so the page works signed-out.

**Acceptance:** `curl -s -o /dev/null -w '%{http_code}' localhost:PORT/console`
→ 200; `/backend.html` → 200; the HTML contains no external `src=`/`href=` to a
third-party origin.

### T0.3 — Smoke test cannot run

`scripts/smoke.ts` imports `../src/server.ts` (no `src/` directory exists) and
`package.json` has no scripts for it. It is the only behavioural test the
project has.

- Fix the import to the real location.
- Add scripts: `"smoke": "node --experimental-strip-types scripts/smoke.ts"`,
  `"typecheck": "tsc --noEmit"`, `"start"` unchanged.
- Keep every existing assertion; you may add assertions but may not remove or
  relax any.
- If the audit chain check fails because a previous run wrote to `./.audit`,
  append a unique suffix per run via `AUDIT_LOG_FILE` in the script itself, do
  not disable the check.

**Acceptance:** `npm run smoke` exits 0 and prints `N checks passed` with N ≥
20; running it twice in a row also exits 0.

## Wave 1 task

### T1.3 — `GET /api/me/capabilities`

The frontend needs the caller's real capability set so `can()`/`canDo()` stop
living in `data/roles.ts`.

- Route: `GET /api/me/capabilities`, `authenticate`, tag `auth`.
- Returns `{ role, products, matrix }` where `matrix` is `permissionMatrix`
  keyed by area → level for **the caller's role only**, plus `levels` describing
  rank order (`none < view < contribute < manage < admin`).
- No secrets, no other members' data.

**Acceptance:** demo `developer` → `Repository: "contribute"`, no
`Administration: admin`; `Owner` → `admin` everywhere.

## Wave 2 tasks

### T2.6 — Missing write routes

The UI models task comments, subtasks and time logs; the API does not.

- `POST /api/tasks/:key/comments` `{text}` (1–2000),
  `POST /api/tasks/:key/subtasks` `{title}` (1–160),
  `POST /api/tasks/:key/subtasks/:id/toggle`, `POST /api/tasks/:key/time`
  `{minutes (1–1440), note?}`.
- All require `authenticate` + `requireArea('Project','contribute')` + in-scope
  task (404 otherwise) + audit append + `publish()` event.
- `GET /api/products` — products derived from the seeded projects, scoped with
  `canSeeProduct`.
- Store models live in `store/db.ts`; project the same shape the frontend types
  already use (`types/work.ts` in the frontend is the reference — mirror field
  names, do not import from `Frontend/`).

**Acceptance:** each route returns 201/200, appears in `/api/_inventory`, is in
`/api/openapi.json`, rejects unknown fields with 422, rejects out-of-scope task
keys with 404, and writes an audit entry.

## Verification you must run before handoff

```bash
cd Backend
npm run typecheck          # zero errors
(PORT=8099 npm run dev &) ; sleep 3
curl -fsS localhost:8099/api/health ; curl -fsS localhost:8099/api/ready
curl -s -o /dev/null -w '%{http_code}\n' localhost:8099/console
npm run smoke              # run it twice, both exit 0
```

## Escalate instead of improvising when

- a fix needs a new dependency,
- an acceptance criterion conflicts with `auth/rbac.ts` semantics,
- a route would expose another member's data,
- the requested change would require weakening validation, audit, or scope
  filtering.
