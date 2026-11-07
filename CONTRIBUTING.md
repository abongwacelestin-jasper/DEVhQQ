# Contributing to DevHQ

How we work on this repository: setup, the rules every change follows, what a
pull request must contain, and how it is verified. Read the
[docs](docs/index.md) for how the system works.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## Setup

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 22.6 | the API runs TypeScript with `--experimental-strip-types` |
| npm | ≥ 10 | workspaces |
| Git | recent | |

```bash
npm install              # root workspaces: Backend, Frontend, Models
npm run hooks:install    # optional: Husky + lint-staged pre-commit hook
```

`.npmrc` sets `ignore-scripts=true`: dependency install scripts never run, so
hooks are not installed automatically. Keep that setting.

Run the API and the web app as described in
[Local development](docs/getting-started/local-development.md). No `.env` file
is needed for development; the API has safe development defaults and does not
read `.env` itself. Never commit real secrets (`.env` and `.env.*` are
git-ignored).

## Repository layout

```text
Backend/    the API (Node, strip-only TypeScript, no runtime dependencies) — see Backend/README.md
Frontend/   the web app (Vite + React) — see Frontend/README.md
Models/     placeholder for the Python ML service (Wave 4)
docs/       documentation, generators and the docs linter — see docs/index.md
docs/agents/  internal coordination for the delivery lanes (BOARD, WAVE4)
.github/    CI, security scans, Dependabot
```

## Scripts

From the root (all workspaces) or inside a package:

| Command | Backend | Frontend | docs |
|---|---|---|---|
| typecheck | `npm run typecheck` | `npm run typecheck` | — |
| lint (0 warnings) | `npm run lint` | `npm run lint` | — |
| tests | `npm run smoke` (`npm test`) | `npm test` (runs typecheck) | `npm run check` |
| build | — (no build step) | `npm run build` | `npm run gen` |
| format | `npm run format:check` | `npm run format:check` | — |

Root shortcuts: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run dev:backend`, `npm run dev:frontend`.

## Hard rules

From `docs/agents/BOARD.md` and `docs/agents/WAVE4.md`. A pull request that
breaks one is not merged.

1. **Never weaken a check to go green.** No skipped or deleted assertions, no
   `echo … && exit 0` standing in for a test, no relaxing an existing smoke
   check.
2. **No `any`, no `@ts-ignore`.** An `eslint-disable` needs a one-line
   justification next to it.
3. **Every state change is audited** with `audit.append(…)`, including the
   request id.
4. **Out of scope is `404`**, never `403`: a resource in a product the caller
   is not assigned to must look like it does not exist.
5. **Validate every input** against an allow-list schema (`Backend/lib/validate.ts`).
6. **Strip-only TypeScript in the backend**: no `enum`, `namespace`,
   parameter properties or decorators; import with `.ts`; `import type` for
   types ([ADR 0002](docs/architecture/adr/0002-strip-only-typescript.md)).
7. **No new runtime dependency in the backend** without an ADR.
8. **No secrets in source**, tests, fixtures, comments or commit messages.
9. **Stay inside your ownership.** During a wave, each lane edits only its
   listed files; shared hotspots (`Backend/server.ts`, `Backend/types.ts`,
   `Frontend/src/App.tsx`, `Backend/scripts/smoke.ts`) take additive, minimal
   edits only.
10. **"Done" means it runs and is tested twice**, on fresh processes, with the
    second run not reusing the first run's state. A flake is a failure.

Security requirements in more detail are in [SECURITY.md](SECURITY.md).

## Commits

Conventional Commits, one logical change per commit:

```text
<type>(<scope>): <subject>
```

- **type**: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`,
  `perf`, `security`
- **scope**: `backend`, `frontend`, `models`, `docs`, `deps`, `ci`
- **subject**: imperative, lower case, no trailing period, ≤ 72 characters

During a delivery wave, lanes commit as `wave4(<LANE>): <subject>`, e.g.
`wave4(DOCS): add generated API reference`.

## Tests

- **Backend:** `npm run smoke` boots the app in-process and walks the critical
  paths (health, the console page and its CSP nonce, OpenAPI, every demo
  sign-in, password + MFA, product scoping and `404`, task writes and
  activity, unknown-field rejection, the query runner, no user enumeration,
  the audit chain). Two-person deploy, step-up and token rotation are covered
  by the supervisor gate described in `docs/agents/BOARD.md`, not by smoke. New routes add a labelled block with a happy path and at least
  one refusal (`403` wrong role, `404` other product, `422` bad body).
- **Frontend:** `typecheck`, `lint` and `build` must pass.
- **Docs:** `cd docs && npm run check` — the generated pages must be current
  and every link and file path must exist.
- Tests must not depend on the network or on another run's state.

## Pull request checklist

- [ ] One logical change; files touched are listed
- [ ] `Backend`: `npm run typecheck && npm run lint && npm run smoke` — 0 / 0 / all pass
- [ ] `Frontend`: `npm run typecheck && npm run lint && npm run build` — 0 / 0 / exit 0
- [ ] Ran the checks twice on fresh processes
- [ ] New routes: registered with summary and tag, guarded, validated, audited, scoped, smoke-tested
- [ ] `cd docs && npm run gen && npm run check` passes; docs updated for changed behaviour or configuration
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] No secrets, debug output, `any`, `@ts-ignore`, or unexplained `eslint-disable`
- [ ] No new dependency, or a justification (and an ADR for the backend)

Handoff format for lane work:
`status | branch | files | what changed | verification commands + results | known gaps | requests for coordinator`.

## Reporting security issues

Privately, as described in [SECURITY.md](SECURITY.md) — never in a public
issue.

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
