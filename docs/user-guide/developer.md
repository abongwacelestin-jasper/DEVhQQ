# Developer

Works tasks and code in their products. Project, Product and Repository
`contribute`; Organization, Deployment and Infrastructure `view`; no
Administration ([matrix](../concepts/permission-matrix.md)). Demo account:
Kofi Mensah (`m4`, renewberry).

## Daily flow

1. **My work** (`/my-work`) — your tasks, overdue first, with mentions and
   assignment notifications. Task cards can show an ETA and overdue-risk
   insight (marked when it comes from a heuristic or a synthetic model).
2. **Task detail** (`/tasks/:taskKey`) — move a task through `backlog` →
   `in-progress` → `review`, comment, add subtasks, log time. You **cannot**
   move your own task to `done`; your reviewer or a manager does that
   (`403 self_close`). Linked pull requests and blockers show on the task.
3. **Create tasks and bugs** in your projects, and docs (Project ≥
   `contribute`). Deleting needs `manage`, which you do not have.
4. **Code workspace** (`/code`) — in-browser editor; with the API configured
   for GitHub it can create, start and stop Codespaces for a repository.
5. **Repositories, Pull requests, CI and Code security** — from the GitHub
   App: review a pull request with `approve`, `request-changes` or `comment`
   (Repository ≥ `contribute`). Without GitHub configured, these pages show
   labelled demo data.
6. **Messages** (`/messages`) — channels and DMs for your products.
7. **Personal access tokens** (Security Center) — for scripts and CI; scoped,
   expiring, shown once.
8. **Deployments** (`/deployments`) — read-only. Developers keep
   `Deployment: view`; you cannot request staging or production deploys
   (owner decision, Wave 4).

## Production access

If you need production for an incident, request a JIT grant for one product
with a reason (at least 10 characters) and a duration (15 min – 8 h). An Owner
or Operations member approves it; it expires by itself. Requests go through
`POST /api/access/grants` (the backend console has a form). Note that an
active grant does not unlock any API route yet. See
[JIT elevation](../concepts/jit-access.md).
