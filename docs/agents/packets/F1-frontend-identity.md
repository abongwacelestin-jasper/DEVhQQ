# Packet F1 — Frontend lane A: shell, transport, identity

**You own:** `Frontend/src/api/**` (new),
`Frontend/src/contexts/AuthContext.tsx`, `Frontend/src/components/auth/**`,
`Frontend/vite.config.ts`, `Frontend/package.json`. **You may not edit:**
`Frontend/src/pages/**`, `Frontend/src/contexts/WorkContext.tsx`,
`IncidentContext.tsx`, `DocsContext.tsx` (those belong to `F2`), `Backend/`, the
repo root. **Never** hardcode credentials, tokens or API base URLs into
components.

## Context you need

- Client-side auth today: `AuthContext.tsx` compares against literal
  `demoPassword`/`demoMfaCode` from `data/roles.ts` and stores the session in
  `sessionStorage`. Stages: `signed-out → mfa → nda → profile → ready`
  (`stageOf`, `utils/authRoutes.ts`).
- Permission checks: `can(area)` / `canDo(action)` read `role.areas` /
  `role.actions` from `data/roles.ts`. 44 files import `data/team.ts` for
  `members` / `memberById` / `currentUserId`.
- Backend contract (already implemented, do not change):
  - `POST /api/auth/demo {role}` → sets HttpOnly cookie, returns `{ok, member}`
  - `POST /api/auth/sign-in {email,password}` → `{next, methods, risk?}` (stage
    = password only)
  - `POST /api/auth/mfa/totp {code}` → verified session
  - `GET /api/auth/session` →
    `{member, stepUpRequired, elevations, sessions, location}`
  - `POST /api/auth/step-up {code}` → fresh verification for 5 minutes
  - `POST /api/auth/sign-out`
  - Errors: `{error:{code,message,requestId}}`; `401` codes include
    `unauthenticated`, `mfa_required`, `session_revoked`, `session_expired`,
    `step_up_required`.
- The cookie is `__Host-devhq_session; HttpOnly; Secure; SameSite=Strict`, so
  the browser only keeps it on a secure context: always go through the Vite
  proxy (same origin), never call the API cross-origin.

## Wave 0

### T0.4 — Install fails

`Frontend/package.json` lists six Node built-ins as dependencies
(`"node:http": "latest"`, `node:crypto`, `node:fs/promises`, `node:path`,
`node:events`, `node:net`). npm rejects the whole install:
`EINVALIDPACKAGENAME`.

- Remove those six entries. Change nothing else in `package.json` (no version
  bumps, no new packages).
- Add the scripts the gate needs: `"typecheck": "tsc --noEmit"` (keep `dev`,
  `build`, `lint`, `preview` as they are).

**Acceptance:** `npm install` exits 0; `npm run build` exits 0 and emits
`dist/`.

### T0.5 — Repo hygiene

Create `.gitignore` at the **repo root** covering `node_modules/`, `dist/`,
`.audit/`, `.backups/`, `*.log`, `.DS_Store`, `.env*` (keep `!.env.example`).

**Acceptance:** after `npm install && npm run build`, `git status --porcelain`
lists no artifact.

## Wave 1

### T1.1 — Same-origin dev transport

Add to `Frontend/vite.config.ts`:

```ts
server: { proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } } },
```

Rationale: one origin means no CORS, no `SameSite=Strict` blocks, and
`originGuard` on the backend sees the allowed `APP_ORIGIN`.

**Acceptance:** with the backend on 8080 and Vite on 5173,
`fetch('/api/health')` from the app returns 200 and no preflight is issued.

### T1.2 — API client

Create `src/api/types.ts` (mirrors `Backend/types.ts` and the response shapes
above) and `src/api/client.ts`:

- `api<T>(path, {method, body, signal})` → typed JSON, always
  `credentials: 'include'`.
- Non-2xx → throw `ApiError { status, code, message, requestId }` built from the
  error envelope; network failure → `ApiError` with `status: 0`,
  `code: 'network'`.
- `401` with `unauthenticated | session_revoked | session_expired` → call the
  registered `onSignedOut` handler once (no loops).
- Response header `X-Step-Up-Required: 1`, or a `401 step_up_required` → call
  the registered `onStepUpRequired` handler.
- No retries, no silent catch: callers must see failures.

**Acceptance:** a temporary script or test proves 200 → data, 401 → `ApiError` +
sign-out callback fired once, 422 → `ApiError` with field message, dead server →
`status: 0`.

### T1.4 — `AuthContext` on the real API

Replace the local password/MFA/demo logic. **Keep the public `AuthValue` shape**
so 40+ consumer files do not change, except `can`/`canDo` internals (T1.5).

- On mount: `GET /api/auth/session`. 200 → hydrate `session` (`memberId`,
  `roleKey` derived from role, `mfaVerified: true`, `stepUpRequired` →
  `locked`-style reauth prompt); 401 → `signed-out`. Show a loading state; never
  flash the sign-in page.
- `signInDemo(key)` → `POST /api/auth/demo`. `signInPassword(email, pw)` →
  `POST /api/auth/sign-in` (returns `{ok, error}`; surface the backend's
  message + lockout `retryAfterSec`). `verifyMfa(code)` →
  `POST /api/auth/mfa/totp`. `signOut` → `POST /api/auth/sign-out` then clear
  local state.
- `unlock(code)` → `POST /api/auth/step-up` (this is what makes approvals real).
- **Keep NDA and profile as local onboarding** (`ndaSignedAt`, `profile`,
  `profileComplete` persisted per member in `localStorage`); they have no
  backend counterpart. `stageOf` must still return `nda` / `profile` / `ready`
  exactly as today.
- Keep `authEvents`, `sessions` (session history) and idle-lock behaviour
  working; they are UI features, not auth.

**Acceptance:** all six demo roles sign in against a live API; wrong password
shows the API's error and increments nothing locally; API down → clear "backend
unreachable" message, app does not white-screen; a backend restart signs you out
cleanly rather than crashing.

### T1.5 — Capabilities from the backend

- `GET /api/me/capabilities` (backend lane B1 delivers it; until it exists, code
  against the contract in `BOARD.md`).
- Map page area → backend area:
  `projects|tasks|assignments|activity|docs → Project`; `products → Product`;
  `code|repositories|pull-requests|code-security|dev-tools → Repository`;
  `deployments → Deployment`; `incidents|monitors → Infrastructure`;
  `team → Organization`; `security|audit|integrations → Administration`;
  `messages|workspaces|sessions|settings|inbox → always allowed`.
- `can(area)` = level ≥ `view`; add `canAt(area, level)` for `manage`/`admin`
  checks. `canDo(action)` maps the 17 existing actions to `(area, level)` pairs
  — keep the action strings identical.
- Replace `members` / `memberById` reads with data from `GET /api/team` (fetch
  once, cache in AuthContext, expose a `member`/`members` field). Keep
  `data/team.ts` exporting a `memberById()` with the **same signature** that
  reads that cache so the 44 importers keep compiling; `currentUserId` must stop
  being a mutable module binding used as state.

**Acceptance:** `developer` cannot reach `/security` or `/audit` (redirected to
`NoAccess`), `operations` can; sign-in as each role produces the expected nav.

## Verification you must run before handoff

```bash
cd Frontend
npm install                # exit 0
npm run typecheck          # zero errors in files you touched
npm run build              # exit 0
# with Backend on :8080 and Vite on :5173
# sign in as each of the 6 demo roles, reload the tab (session must survive), sign out
```

## Escalate instead of improvising when

- the `AuthValue` shape would have to change for a consumer outside your file
  list,
- the backend returns a shape that contradicts `BOARD.md`,
- a fix needs a new npm dependency,
- you are tempted to keep the client-side password check as a fallback (do not —
  that defeats the point).
