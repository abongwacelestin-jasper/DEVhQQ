# TavetaHQ beta test plan

Lane **QA**, wave 4. Owner of this file: QA. Results are in [`BETA_REPORT.md`](./BETA_REPORT.md);
the manual pass is in [`UAT_CHECKLIST.md`](./UAT_CHECKLIST.md).

## 1. Scope

In scope: the React SPA (`Frontend/`) served through Vite's `/api` proxy against the Node API
(`Backend/`) in demo mode, end to end, as real users click through it.

| Area | Covered by |
|---|---|
| Sign-in (password + MFA, demo buttons), MFA enrolment, onboarding (NDA, profile) | `owner`, `cross-cutting`, `wave4` specs |
| Role-based journeys for the six personas | `owner`, `project-manager`, `developer`, `designer-tester-operations` |
| Permissions: UI gating, no-access page, API refusal, product scope (out of scope = 404) | `developer`, `cross-cutting` |
| Session lifetime: idle lock, unlock, server-ended session, reload, sign out everywhere | `cross-cutting`, `wave4` |
| Routing: 404, deep links, deep link through sign-in | `cross-cutting` |
| Preferences: language, theme | `cross-cutting` |
| Responsive: 375 / 768 / 1280 px, bottom nav, More sheet | `cross-cutting`, exploratory crawler |
| Keyboard: sign-in, focus visibility, ⌘K command menu | `cross-cutting` |
| Accessibility: axe-core WCAG 2.1 A/AA on every main route, light + dark | `accessibility` |
| Resilience: API down (refused / 502), slow API, failed write | `resilience` |
| Wave-4 features: messaging, doc comments/versions, notifications, repos/PRs/monitors, assistant, ML badges, tokens, recovery, server-side onboarding | `wave4` (`@wave4`) |

Out of scope: load and performance, penetration testing (the CYBER lane), the Docker Compose
stack and edge (INFRA; the suite can target it through `E2E_BASE_URL`), the Python ML service
with a trained model, real GitHub / SMTP / S3 integrations. These were unconfigured on purpose,
to check that each degrades to labelled demo or heuristic data.

## 2. Personas

| Persona | Demo member | Role (rbac.ts) | Products | Home |
|---|---|---|---|---|
| Owner | Amara Okafor `m1` | Owner | all | `/` |
| Project manager | Daniel Reyes `m2` | Project manager | renewberry | `/` |
| Developer | Kofi Mensah `m4` | Developer | renewberry | `/my-work` |
| Designer | Inès Moreau `m9` | Designer | renewberry, mirror | `/my-work` |
| Tester | Ravi Patel `m10` | Tester | renewberry, mirror | `/test-queue` |
| Operations | Grace Liu `m11` | Operations | all | `/incidents` |

Credentials (non-production only): demo buttons, or `<email>` + `devhq-demo` + code `246810`.

## 3. Environments

| Name | How | Used for |
|---|---|---|
| **Fresh stack** (default) | `cd e2e && npm test`. Playwright starts the backend (in-memory store, new temp audit/backup dirs) and a production build served by `vite preview` on random free ports | gate runs, flake hunting |
| **Dev mode** | backend `npm run dev` + `vite` with `DEVHQ_API_URL`; then `E2E_BASE_URL=http://127.0.0.1:<vite> npm test` | phase 2 (coordinator's request) |
| **Compose stack** | `E2E_BASE_URL=https://localhost npm test` | once INFRA's stack is up |

Browsers: Chromium (full suite), Firefox and WebKit (`@smoke` subset, `npm run test:cross-browser`).
Viewports: 1280×800 by default, 768×1024 and 375×812 (mobile + touch) where stated.
Locale `en-GB`, timezone UTC.

Evidence: traces, screenshots and video are kept for failed tests (`e2e/test-results/`),
HTML report in `e2e/playwright-report/`, exploratory output in `docs/qa/evidence/` and
`docs/qa/screenshots/`.

## 4. Approach

1. **Scripted journeys** written as user stories, one spec per persona. Selectors are roles and
   accessible names only. Where none exists, the gap is listed as a UI request in the report,
   and the app is never edited.
2. **Known defects are explicit.** A journey that cannot pass because of a logged defect is
   marked `test.fail(true, 'QA-0xx: …')`. It shows as *known defect* and turns into an
   "unexpected pass" the moment the defect is fixed, so the marker has to be removed and
   the journey becomes a real gate.
3. **Server is the authority.** Every UI write is checked again through the API, so "the toast
   said saved" is never taken as proof.
4. **Exploratory crawl** (`npm run explore`): every persona × every main route × three viewports,
   recording console errors, uncaught exceptions, 4xx/5xx calls, horizontal overflow, unnamed
   buttons, dead links and "demo/sample/mock" copy. Then a manual read of the code and screens
   to find mock data presented as real.
5. **Twice on fresh processes.** Every gate run is repeated on new server processes with new
   state. A test that differs between runs is a **flake**, which counts as a defect in the test
   or the app. It is investigated, not retried (`retries: 0`).

## 5. Entry criteria

- `wave4/integration` merged into the QA worktree. Backend `npm run smoke` and frontend
  `npm run build` pass.
- `GET /api/health` is 200 through the frontend origin.
- Demo mode is enabled (`DEMO_DISABLED` unset, `NODE_ENV` ≠ production).

## 6. Exit criteria (release candidate)

- No open **S1**. No open **S2** without an owner-approved waiver.
- Every persona journey passes, or fails only on an S3/S4 with a waiver.
- No axe **critical** violations on any main route. Each **serious** violation is triaged.
- Two consecutive fresh runs produce identical results (0 flakes).
- No uncaught page exceptions on any route for any persona.
- No page presents seed or mock data as live without a visible "Sample data" / "demo" label
  (owner decision, WAVE4 preamble).

## 7. Severity definitions

| Sev | Meaning | Examples |
|---|---|---|
| **S1 Blocker** | A core journey cannot be completed, or a security / data-integrity control is broken or bypassable. No workaround for a real user | password + MFA sign-in impossible; lock bypassed by reload |
| **S2 Major** | A feature is wrong or misleading in a way users or auditors will act on. A workaround exists but is not obvious | permission change appears saved but isn't; audit log mixes client-made rows with the server trail |
| **S3 Minor** | Works, with friction, inconsistency or a misleading label | "CI passing" hard-coded; 404 redirects home |
| **S4 Trivial** | Cosmetic or copy | version string mismatch, contract shape nit |

The owning lane for each defect follows WAVE4 §1 file ownership.
