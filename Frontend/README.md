# DevHQ web app (`@devhq/frontend`)

A Vite + React 18 + TypeScript single-page app, styled with Tailwind. It talks
to the DevHQ API through one client and derives every permission decision from
the server.

- Running it: [docs/getting-started/local-development.md](../docs/getting-started/local-development.md)
- What each role sees: [docs/user-guide/index.md](../docs/user-guide/index.md)

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite on `http://127.0.0.1:5173` (`strictPort`), proxying `/api` to `DEVHQ_API_URL` (default `http://127.0.0.1:8080`). Open it as `http://localhost:5173` — see the getting-started guide. |
| `npm run build` | production bundle in `dist/` |
| `npm run preview` | serve the built bundle |
| `npm run typecheck` | `tsc --noEmit` — 0 errors expected |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm test` | currently runs `typecheck` |
| `npm run format` / `format:check` | Prettier over `src/` |
| `npm run validate` | typecheck + lint |

## Layout

```text
Frontend/src/
├── index.tsx           mounts <App/>
├── App.tsx             providers and the route table (sign-in stages, AppShell routes, product routes, /console/*)
├── api/
│   ├── client.ts       the only fetch wrapper: ApiError, 401 → sign-out, step-up → re-verify
│   ├── capabilities.ts maps UI areas/actions to server areas/levels (canVisit, canPerform)
│   ├── adapters.ts     API rows → UI types
│   └── types.ts        API response types
├── contexts/           app state providers (Auth, Reauth, Work, Docs, Incident, ProductFilter, Messaging, Workspace, …)
├── hooks/              data and UI hooks (useDeployments, useTeamData, useOverviewData, useIdleLock, …)
├── pages/              one component per route; auth/ (sign-in stages), product/ (per-product tabs), console/ (web console)
├── components/         grouped by feature (team, work, delivery, operations, docs, messaging, layout, ui, …)
├── data/               navigation, role presentation, and seed data for pages without a backend yet
├── types/              UI domain types
└── utils/              pure helpers (dates, fuzzy search, webauthn encoding, console client, …)
```

## How it talks to the API

- Every request goes through `api<T>(path, opts)` in `src/api/client.ts`.
  Never call `fetch` for `/api` elsewhere.
- Same origin: requests go to `/api/...` (or `VITE_API_BASE`, which should stay
  empty), with `credentials: 'include'` so the `__Host-devhq_session` cookie is
  sent.
- Errors are thrown as `ApiError {status, code, message, requestId,
  details}`. The client handles two cases centrally: a dead session
  (`unauthenticated`, `session_revoked`, `session_expired`, `mfa_required`)
  signs the user out; `step_up_required` opens the re-verification dialog
  (`ReauthContext`).
- The client also keeps a bearer-token copy in `sessionStorage`; that is being
  removed in Wave 4
  ([ADR 0006](../docs/architecture/adr/0006-cookie-only-browser-sessions.md)).

## Conventions

1. **The server decides permissions.** Use `can(area)` / `canDo(action)` from
   `useAuth()`; they come from `GET /api/me/capabilities` through
   `api/capabilities.ts`. Never hard-code a role check in a page. Hiding a
   button is presentation; the API is the control.
2. **No seed data presented as live.** A page either reads the API or shows
   clearly that it is sample data. Do not add new reads from `src/data/` for
   domain data (Wave 4 rule).
3. **Treat `404` as "no access or not found"** — the API does not distinguish,
   and the UI should not guess.
4. **Sensitive actions ask first**: call `requestReauth({ title, description,
   actionLabel, onConfirm })` from `useReauth()` before approving deploys,
   changing roles or revoking access.
5. **Render text, not HTML.** No `dangerouslySetInnerHTML` with user content;
   docs markdown is rendered by a line-based renderer without raw HTML.
6. **No `any`, no `@ts-ignore`** (BOARD hard rules); `eslint-disable` only with
   a one-line justification.
7. In `App.tsx`, add routes only; do not reorder providers (Wave 4 hotspot
   rule).

## Adding a page

1. Create `src/pages/Widgets.tsx` and load data with `api()` (directly or in a
   context or hook), handling loading, empty and `ApiError` states.
2. Add the route in `src/App.tsx` inside the `<AppShell>` route group:
   `<Route path="widgets" element={<Widgets />} />`.
3. If it needs its own navigation entry and access rule:
   - add the area name to `Area` (and `allAreas`) in `src/data/roles.ts`,
   - map it to a server area in `AREA_TO_SERVER` in `src/api/capabilities.ts`
     (or `null` for a personal page),
   - add it to the `areas` of each role that should see it in
     `src/data/roles.ts`,
   - add a `NavEntry` in `src/data/navigation.ts`.
   `AppShell` renders `NoAccess` for a path whose area the user cannot visit;
   the first URL segment is the area (`areaForPath`).
4. Run `npm run typecheck && npm run lint && npm run build`, then
   `cd ../docs && npm run gen` (the generated permission matrix includes the
   UI mapping) and update the [user guide](../docs/user-guide/index.md).
