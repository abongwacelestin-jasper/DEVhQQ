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

The repository has three packages:

| Package | What it is | Guide |
|---|---|---|
| `Backend/` | The API: Node 22, TypeScript run with Node's type stripping (no build step), no runtime dependencies, a custom router whose route table is also the OpenAPI document. Also serves the backend console at `/console`. | [Backend/README.md](../Backend/README.md) |
| `Frontend/` | The web app: a Vite + React single-page app that talks to the API through one client. | [Frontend/README.md](../Frontend/README.md) |
| `Models/` | Placeholder for the machine-learning service. | [ML overview](ml/index.md) |

> [!NOTE]
> **Planned: Wave 4.** The platform is being finished in ten parallel lanes:
> PostgreSQL persistence, S3-compatible object storage (MinIO locally), a
> Python ML service and assistant, Docker Compose with an edge proxy, a GitHub
> App, messaging and workspaces backends, personal access tokens and real
> WebAuthn. Pages describe what the code does **today** and mark anything that
> exists only as a Wave 4 contract with a box like this one. Nothing in a
> "Planned" box works yet.

## What works today, in one paragraph

The API keeps its data in memory (seeded with demo data on every start, so a
restart resets it), authenticates with a password plus a second factor,
authorises every request against the permission matrix and the caller's
products, and writes every state change to the audit log. The web app signs in
against the API and reads tasks, projects, docs, deployments, incidents, the
team directory, JIT grants and the audit trail from it. Several pages
(repositories, pull requests, monitors, messages, workspaces, integrations,
code security, most of the Security Center) still render seed data from
`Frontend/src/data/`; Wave 4 gives each of them a backend module. The
[user guide](user-guide/index.md) says which page is which.

## Map of the docs

| Section | Read it when you want to… |
|---|---|
| [Getting started](getting-started/local-development.md) | run the API and the web app on your machine, sign in with a demo account, and use the backend console. [Troubleshooting](getting-started/troubleshooting.md) covers the usual failures. |
| [Architecture](architecture/overview.md) | understand the components, the request pipeline, the data flow and the trust boundaries. The [ADRs](architecture/adr/index.md) record why it is built this way. |
| [Concepts](concepts/index.md) | understand products and scope, roles and the [permission matrix](concepts/permission-matrix.md), sessions, step-up, JIT elevation, the audit log and location risk. |
| [API](api/index.md) | call the API: [authentication](api/authentication.md), [errors](api/errors.md), [pagination](api/pagination.md), [rate limits](api/rate-limits.md), and the generated [reference](api/reference.md). |
| [User guide](user-guide/index.md) | learn the day-to-day flows for your role, and the [admin tasks](user-guide/admin-tasks.md). |
| [Operations](operations/configuration.md) | configure, monitor, back up and verify a running instance. |
| [ML](ml/index.md) | see what the planned models and assistant will do. |
| [Glossary](glossary.md) | look up a term. These docs use the glossary's wording throughout. |

Contributing: [CONTRIBUTING.md](../CONTRIBUTING.md). Changes:
[CHANGELOG.md](../CHANGELOG.md). Security reports: [SECURITY.md](../SECURITY.md).

## Keeping these docs true

Three pages are generated from the code and must not be edited by hand:

- [API reference](api/reference.md) — from the live route table (`router.inventory()`).
- [Permission matrix](concepts/permission-matrix.md) — from `Backend/auth/rbac.ts`
  and the frontend capability mapping.
- [Error codes](api/error-codes.md) — from every `new HttpError(…)` in `Backend/`.

```bash
cd docs
npm run gen     # regenerate all three
npm run check   # fail if any is stale, then check every link and file path
```

`npm run check` also runs the link checker
([`docs/scripts/check-links.ts`](scripts/check-links.ts)): every relative link
and every repository path written in backticks must exist. References inside
"Planned: Wave 4" boxes may point at files that are not merged yet; the checker
lists them as pending instead of failing.

Why there is no static site generator yet: GitHub already renders these
Markdown files, including the `> [!NOTE]` boxes and Mermaid diagrams, and
Wave 4 defines no hosting target for a docs site (the edge serves only the web
app and the API). A generator such as VitePress would add a few hundred
transitive npm packages to a repository whose `.npmrc` treats every dependency
as supply-chain risk, for no capability we need today. The tree is laid out
so it can be added later without moving files: one `index.md` per section and
relative links only.
