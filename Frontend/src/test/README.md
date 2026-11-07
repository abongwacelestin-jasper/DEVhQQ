# Frontend tests

Unit and component tests for the web app use **Vitest** (jsdom) with
**Testing Library** and **user-event**. Type checking is a separate step.

```bash
cd Frontend
npm test               # vitest run: every *.test.ts(x) under src/, once
npm run test:watch     # re-run on change
npm run test:coverage  # run with v8 coverage and enforce thresholds
npm run typecheck      # tsc --noEmit (test files are type-checked too)
```

Run one file or one test by name:

```bash
npx vitest run src/api/client.test.ts
npx vitest run -t "step_up_required"
```

Coverage reports go to `Frontend/coverage/` (`text` in the terminal,
`coverage-summary.json` and an HTML report).

## Layout

| Path | What |
|---|---|
| `vitest.config.ts` | jsdom, `@` alias, setup file, coverage include list and thresholds. `TZ` is pinned to UTC. |
| `src/test/setup.ts` | jest-dom matchers, DOM cleanup, real timers and empty storage after every test. |
| `src/test/fetchMock.ts` | `mockFetch()`, `jsonResponse()`, `apiError()`: queued or routed fake API responses. |
| `src/test/render.tsx` | `renderWithRouter()` (MemoryRouter plus optional providers) and `setupUser()`. |
| `src/**/<module>.test.ts(x)` | Tests sit next to the module they cover. |

## Writing a test

- **Import from `vitest`.** Globals are off: write `import { describe, expect, it, vi } from 'vitest'`.
- **Query by role and name.** `getByRole('button', { name: 'Save' })` tests what a
  user and a screen reader get. Use `getByTestId` only for test harness output.
- **Use user-event for interaction.** Call `const user = setupUser()` and then
  `await user.click(...)`, `user.keyboard('{Escape}')` or `user.paste('123456')`. Use
  `fireEvent` only for events user-event cannot produce.
- **Fake time when the code reads the clock.** Call `vi.useFakeTimers()` and then
  `vi.setSystemTime(...)`. `setupUser()` advances fake timers on its own. Timers go
  back to real after every test. The workspace's simulated "now" is
  `NOW` in `utils/date.ts` (Fri Oct 23 2026, 15:30).
- **Mock the network with `mockFetch()`, never with a real server.**

  ```ts
  const f = mockFetch()
    .reply(200, { items: [] })
    .reply(401, apiError('step_up_required'))
    .fail(new TypeError('Failed to fetch'));
  // or answer by route, whatever the call order:
  mockFetch().route('GET', '/api/me/capabilities', 200, caps);
  expect(f.calls[0].headers.authorization).toBe('Bearer t');
  ```

  A request with nothing queued throws, so a missing stub fails loudly.
- **Reload modules that keep state.** `api/client.ts` keeps its token and auth
  handlers at module level. Call `vi.resetModules()` and then `await import('./client')`
  to get a clean copy (see `client.test.ts`). Use `vi.stubEnv('VITE_API_BASE', …)`
  before the import to test env-dependent code.
- **Components that use the router or contexts** go through
  `renderWithRouter(ui, { route: '/tasks', wrap: (c) => <SomeProvider>{c}</SomeProvider> })`.
- **Stay deterministic.** Use no network, no real clock, no randomness in
  assertions and no order dependence between tests. Run the suite twice before you
  hand off.

## Rules (from `docs/agents/BOARD.md`)

- Never skip a test or weaken an assertion to make the suite pass. Do not use `any`
  or `@ts-ignore`.
- **A test that exposes a real bug asserts the correct behaviour** and is marked
  `it.fails(...)` with a `// FINDING F-FE-n:` comment that explains the defect.
  Do not change app code from a test lane. The finding goes to the coordinator.
  When the fix lands, the `it.fails` test starts passing, Vitest reports it as a
  failure, and the fixer turns it back into `it(...)`.

Open findings: F-FE-1 (`metrics.test.ts`), F-FE-2 and F-FE-3
(`snippets.test.ts`), F-FE-4 (`audit.test.ts`), F-FE-5 (`client.test.ts`) and
F-FE-6 (`CodeInput.test.tsx`).

## Coverage thresholds

Thresholds apply per module group, and only to code that has tests. There is no
global number.

| Group | lines / functions / branches / statements |
|---|---|
| `utils/{fuzzy,date,slug,status,secretScan,audit,authRoutes,snippets,metrics}.ts` | 95 / 95 / 90 / 95 |
| `api/{client,capabilities,adapters}.ts` | 95 / 95 / 90 / 95 |
| `components/ui/{Button,Modal,SearchInput,Segmented,MultiSelect,UnderlineTabs,StatusBadge,ProgressBar,Avatar,StatCard,Panel}.tsx` | 95 / 95 / 85 / 95 |
| `components/auth/CodeInput.tsx` | 95 / 95 / 90 / 95 |

Measured coverage when these were set was 97–100% in every group.

When you add tests for a new module, add it to a group (or a new group) in
`vitest.config.ts`. Never lower an existing threshold.
