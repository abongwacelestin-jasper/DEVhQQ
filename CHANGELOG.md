# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Root npm workspace configuration covering `Backend`, `Frontend`, and `Models`.
- Shared tooling configuration: ESLint flat config, Prettier, EditorConfig.
- Security policy (`SECURITY.md`), contribution guide, and code of conduct.
- GitHub Actions workflows for continuous integration and linting.
- Security automation: CodeQL, Gitleaks, Trivy, dependency review, and
  Dependabot version updates.
- Environment variable template (`.env.example`).
- npm security hardening via `.npmrc`: strict SSL, `ignore-scripts=true`
  (blocks dependency lifecycle-script attacks), `audit=true` at high severity,
  and exact version recording.

### Changed

- `Backend`, `Frontend`, and `Models` are now scoped packages
  (`@devhq/backend`, `@devhq/frontend`, `@devhq/models`) with full package
  metadata: description, author, contributors, repository, bugs, homepage,
  keywords, and engine constraints.
- Workspace scripts standardised on `dev`, `build`, `lint`, `typecheck`,
  `format`, `test`, and `validate`.

### Security

- Enabled automated dependency and secret scanning in CI.

## [1.0.0] - 2026-10-30

### Added

- Initial repository structure with three independent workspaces:
  - **Backend** — Node.js HTTP API in TypeScript, run directly via Node's
    native type stripping (no build step). Includes authentication, rate
    limiting, security middleware, resilience helpers, and audit logging.
  - **Frontend** — React single-page application built with Vite, TypeScript,
    and Tailwind CSS.
  - **Models** — machine learning workspace for code analysis, anomaly
    detection, task prediction, and productivity insights.
- MIT licence.

[Unreleased]: https://github.com/devhq/devhq/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/devhq/devhq/releases/tag/v1.0.0
