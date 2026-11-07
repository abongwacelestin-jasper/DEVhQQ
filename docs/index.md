# DevHQ documentation

DevHQ is an internal developer-operations platform for one organisation. It
holds the organisation's products (RenewBerry, Blog and Mirror Acture), their
projects and tasks, project docs, deployments and incidents, and the people
who work on them, and it puts access control and an audit trail around all of
it: six roles, a permission matrix scoped by product, MFA and passkeys,
just-in-time production access, two-person deploy approval and a hash-chained
audit log.

It is built for the people inside that organisation: owners and admins, project
managers, developers, designers, testers and operations engineers. It is not a
multi-tenant SaaS product.

The repository has three packages and a Compose stack:

| Part | What it is | Guide |
|---|---|---|
| `Backend/` | The API: Node 22, TypeScript run with Node's type stripping (no build step), one runtime dependency (`pg`), a custom router whose route table is also the OpenAPI document. Also serves the backend console at `/console`. | [Backend/README.md](../Backend/README.md) |
| `Frontend/` | The web app: a Vite + React single-page app that talks to the API through one cookie-only client. | [Frontend/README.md](../Frontend/README.md) |
| `Models/` | The ML service: Python, FastAPI, scikit-learn; predictions and the assistant, reachable only from the backend. | [Models/README.md](../Models/README.md) |
| `infra/`, `docker-compose.yml` | Caddy edge and frontend server, PostgreSQL, MinIO, secrets, backup and deploy scripts, Railway config. | [docs/deploy/RUNBOOK.md](deploy/RUNBOOK.md), [docs/deploy/RAILWAY.md](deploy/RAILWAY.md) |

## What is in place

Every domain has a real backend module: tasks, projects and docs (with
versions and comments), deployments and incidents, the team, JIT access,
messaging and workspaces, notifications, onboarding, account recovery and
offboarding, the GitHub App with repositories, pull requests, CI runs and code
findings, uptime monitors, integrations with signed outbound webhooks, file
uploads, backups, personal access tokens, ML insights and the assistant — 181
routes in all. State is persisted in PostgreSQL, blobs in S3-compatible
storage, the audit chain additionally in a write-once bucket. Where an
optional integration is not configured, the API says so
(`503 integration_unconfigured`) or, outside production, serves clearly
labelled demo data.

Before going live, read [Known limits](operations/known-limits.md): one backend
replica, synthetic ML models until there is real history, demo mode off on
anything internet-facing, and a KMS key for MinIO encryption.

## Map of the docs

| Section | Read it when you want to… |
|---|---|
| [Getting started](getting-started/local-development.md) | run DevHQ on your machine (Docker or two processes), sign in with a demo account, and use the backend console. [Troubleshooting](getting-started/troubleshooting.md) covers the usual failures. |
| [Architecture](architecture/overview.md) | understand the components, the request pipeline, the data flow and the trust boundaries. The [ADRs](architecture/adr/index.md) record why it is built this way. |
| [Concepts](concepts/index.md) | understand products and scope, roles and the [permission matrix](concepts/permission-matrix.md), sessions, step-up, JIT elevation, the audit log and location risk. |
| [API](api/index.md) | call the API: [authentication](api/authentication.md), [errors](api/errors.md), [pagination](api/pagination.md), [rate limits](api/rate-limits.md), and the generated [reference](api/reference.md). |
| [User guide](user-guide/index.md) | learn the day-to-day flows for your role, and the [admin tasks](user-guide/admin-tasks.md). |
| [Operations](operations/deployment.md) | deploy and do the [first-run setup](operations/deployment.md#first-run-production-setup), [configure](operations/configuration.md), use [storage](operations/storage.md), [back up and restore](operations/backups.md), [monitor](operations/monitoring.md), [verify the audit log](operations/audit-verification.md), and know the [limits](operations/known-limits.md). |
| [Security](security/CONTROLS.md) | the security lane's controls map, [threat model](security/THREAT_MODEL.md), [WebAuthn client contract](security/webauthn-client.md) and the independent [assessment](security/assessment/REPORT.md). |
| [Deploy](deploy/RUNBOOK.md) | the infrastructure lane's [runbook](deploy/RUNBOOK.md), [deployment architecture](deploy/ARCHITECTURE.md), and [Railway + Cloudflare R2](deploy/RAILWAY.md). |
| [ML](ml/index.md) | understand the insights and the assistant, and where the model cards are. |
| [Glossary](glossary.md) | look up a term. These docs use the glossary's wording throughout. |

Contributing: [CONTRIBUTING.md](../CONTRIBUTING.md). Changes:
[CHANGELOG.md](../CHANGELOG.md). Security reports: [SECURITY.md](../SECURITY.md).

## Keeping these docs true

Four pages are generated from the code and must not be edited by hand:

- [API reference](api/reference.md) — from the live route table (`router.inventory()`).
- [Permission matrix](concepts/permission-matrix.md) — from `Backend/auth/rbac.ts`
  and the frontend capability mapping.
- [Error codes](api/error-codes.md) — from every `new HttpError(…)` in `Backend/`.
- [Environment variables](operations/env-vars.md) — from every environment read
  in `Backend/`, `Frontend/` and `Models/`.

```bash
cd docs
npm run gen     # regenerate all four
npm run check   # fail if any is stale, then check every link and file path
```

`npm run check` also runs the link checker
([`docs/scripts/check-links.ts`](scripts/check-links.ts)): every relative link
and every repository path written in backticks must exist. (References inside
a "Planned" box may point at files that do not exist yet; the checker lists
them as pending instead of failing. Wave 4 has shipped, so there are none
today.)

Why there is no static site generator: GitHub already renders these Markdown
files, including the `> [!NOTE]` boxes and Mermaid diagrams, and the
deployment has no hosting target for a docs site (the edge serves only the web
app and the API). A generator such as VitePress would add a few hundred
transitive npm packages to a repository whose `.npmrc` treats every dependency
as supply-chain risk, for no capability we need today. The tree is laid out
so it can be added later without moving files: one `index.md` per section and
relative links only.
