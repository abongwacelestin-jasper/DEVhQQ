# Contributing to DevHQ

Thanks for taking the time to contribute. This document describes how we work,
what we expect from a pull request, and the security rules that are
non-negotiable in this repository.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Repository Layout](#repository-layout)
- [Development Workflow](#development-workflow)
- [Commit Convention](#commit-convention)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Security Requirements](#security-requirements)
- [Pull Request Checklist](#pull-request-checklist)
- [Release Process](#release-process)
- [Getting Help](#getting-help)

---

## Code of Conduct

This project adheres to the [Contributor Covenant](./CODE_OF_CONDUCT.md). By
participating you are expected to uphold it. Report unacceptable behaviour to
**conduct@devhq.com**.

## Getting Started

### Prerequisites

| Tool    | Version   | Notes                                  |
| ------- | --------- | -------------------------------------- |
| Node.js | >= 22.6.0 | Required for native TypeScript support |
| npm     | >= 10.0.0 | Workspaces support                     |
| Python  | >= 3.10.0 | Only for the `Models` workspace        |
| Git     | >= 2.40   | Signed commits recommended             |

### Install

```bash
git clone https://github.com/devhq/devhq.git
cd devhq

# Single install for all workspaces (hoisted)
npm install
```

Copy the environment template and fill in local-only values:

```bash
cp .env.example .env
```

> `.env` is git-ignored. Never commit it, and never paste real credentials into
> an issue, pull request, or chat.

### Run

```bash
npm run dev            # all workspaces
npm run dev:backend    # API only
npm run dev:frontend   # web app only
```

## Repository Layout

```
.
├── Backend/     Node.js + TypeScript API (no build step)
├── Frontend/    React + Vite + Tailwind web client
├── Models/      ML models and training scripts
├── docs/        Architecture and design notes
└── .github/     CI, security scans, Dependabot
```

Each workspace is an independent npm package. Cross-workspace imports must go
through the published package name (`@devhq/backend`), never a relative path
that escapes the workspace root.

## Development Workflow

1. **Open an issue first** for anything larger than a typo or a one-line fix.
   This avoids duplicated effort and lets us agree on the approach.
2. **Fork and branch** from `main`:

   ```bash
   git switch -c feat/short-description
   ```

   Branch prefixes: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`,
   `security/`, `perf/`.

3. **Keep commits small and focused.** One logical change per commit.
4. **Rebase, don't merge.** `git rebase origin/main` before opening a PR.
5. **Open the PR** against `main` and fill in the template completely.

### Pre-commit hooks

Dependency lifecycle scripts are disabled via `.npmrc` (`ignore-scripts=true`),
so hooks are **not** installed automatically. Enable them once per clone:

```bash
npm run hooks:install
```

Husky then runs `lint-staged` on commit, which applies ESLint and Prettier to
staged files. If a hook fails, fix the reported issue — do not use
`--no-verify`.

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

- **type**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`,
  `ci`, `chore`, `revert`, `security`
- **scope**: workspace or area — `backend`, `frontend`, `models`, `deps`, `ci`
- **subject**: imperative mood, lowercase, no trailing period, <= 72 chars

Examples:

```
feat(backend): add per-tenant rate limiting
fix(frontend): prevent stale auth state after logout
security(deps): bump vite to 5.4.20 for CVE-2025-30208
```

Breaking changes must include a `BREAKING CHANGE:` footer and a `!` after the
type, e.g. `feat(backend)!: drop Node 20 support`.

## Coding Standards

Formatting and linting are enforced by tooling, not by review comments:

```bash
npm run format        # write formatting
npm run format:check  # verify (CI)
npm run lint          # ESLint, zero warnings allowed
npm run typecheck     # tsc --noEmit
```

Conventions:

- TypeScript everywhere; `strict` mode is on. Avoid `any` — use `unknown` and
  narrow.
- Prefer named exports over default exports.
- No `console.log` in library code; use the logger abstraction.
- No commented-out code, no `TODO` without an issue reference.
- Files are UTF-8, LF line endings, 2-space indent (4 for Python).
- Keep functions small and pure where practical; isolate I/O at the edges.

### TypeScript

The backend runs TypeScript directly via Node's type stripping, so:

- Only **erasable** syntax is allowed in `Backend/` (no `enum`, no `namespace`,
  no parameter properties, no decorators).
- Use `import type { X } from '...'` for type-only imports.

## Testing

```bash
npm test                      # all workspaces
npm run test:backend          # single workspace
npm run test:coverage         # coverage report
```

- Every bug fix ships with a regression test.
- Every new endpoint ships with at least one happy-path and one failure test.
- Tests must not depend on network access or wall-clock time; inject clocks and
  HTTP clients.

## Security Requirements

Security is a first-class requirement in DevHQ. The following are mandatory and
will block a pull request:

1. **No secrets in source.** No keys, tokens, passwords, private keys, or
   connection strings — not in code, tests, fixtures, comments, or commit
   messages. Use environment variables (see `.env.example`).
2. **No new dependency without justification.** Explain in the PR why the
   dependency is needed, its maintenance status, and its licence. GPL-3.0 and
   AGPL-3.0 are not permitted.
3. **Validate all external input** at the trust boundary (HTTP handler, CLI
   argument, file read). Never trust client-supplied IDs, sizes, or paths.
4. **No dynamic code execution.** `eval`, `new Function`, and `vm` are banned by
   lint rule. If you believe you need one, open an issue first.
5. **No path traversal.** Resolve and verify user-supplied paths stay inside the
   intended directory.
6. **No raw SQL string concatenation.** Use parameterised queries.
7. **Escape output** rendered into HTML; never use `dangerouslySetInnerHTML`
   with untrusted content.
8. **Least privilege.** New endpoints must declare authentication and
   authorisation explicitly; deny by default.
9. **Log safely.** Never log tokens, passwords, full request bodies, or PII.
10. **Report vulnerabilities privately** per [SECURITY.md](./SECURITY.md) — not
    in a public issue.

CI enforces: `npm audit --audit-level=high`, CodeQL, Gitleaks, Trivy, and
dependency review. A red security check is never overridden by a maintainer
without a documented, time-boxed exception.

## Pull Request Checklist

- [ ] Linked issue (or a clear explanation of the change)
- [ ] Scope limited to one logical change
- [ ] `npm run lint` passes with zero warnings
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `npm run format:check` passes
- [ ] Tests added or updated for behaviour changes
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] No secrets, debug output, or commented-out code
- [ ] No new dependency, or a justification is included
- [ ] Documentation updated when behaviour or configuration changes

A maintainer will review within 3 business days. Reviews may request changes;
please respond or close the PR rather than letting it go stale.

## Release Process

1. Update `CHANGELOG.md` and bump `version` in the root and affected workspace
   `package.json` files.
2. Run the full validation suite locally.
3. Tag: `git tag -a v1.x.y -m "v1.x.y"` and push the tag.
4. CI publishes the GitHub release notes from the changelog.
5. Post-release: verify the deployment and rotate any credentials touched by the
   release.

## Getting Help

- **Questions / ideas**: open a GitHub Discussion.
- **Bugs**: open an issue with reproduction steps.
- **Security**: email **security@devhq.com** (never a public issue).

---

By contributing you agree that your contributions are licensed under the
[MIT License](./LICENSE).
