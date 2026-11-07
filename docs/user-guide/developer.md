# Developer

Works tasks and code in their products. Project, Product and Repository
`contribute`; Organization, Deployment and Infrastructure `view`; no
Administration ([matrix](../concepts/permission-matrix.md)). Demo account:
Kofi Mensah (`m4`, renewberry).

## Daily flow

1. **My work** (`/my-work`) — your tasks, overdue first. Approvals and
   mentions on this page are sample data.
2. **Task detail** (`/tasks/:taskKey`) — move a task through `backlog` →
   `in-progress` → `review`, comment, add subtasks, log time. You **cannot**
   move your own task to `done`; your reviewer or a manager does that
   (`403 self_close`). Linked pull requests and blockers show on the task.
3. **Create tasks and bugs** in your projects, and docs (Project ≥
   `contribute`). Deleting needs `manage`, which you do not have.
4. **Code workspace** (`/code`) — in-browser editor; with the API configured
   for GitHub it can create, start and stop Codespaces for a repository.
5. **Repositories, Pull requests, Code security, IDE & dev tools** — sample
   data today.
6. **Deployments** (`/deployments`) — read-only. Developers keep
   `Deployment: view`; you cannot request staging or production deploys
   (owner decision, Wave 4).

## Production access

If you need production for an incident, request a JIT grant for one product
with a reason (at least 10 characters) and a duration (15 min – 8 h). An Owner
or Operations member approves it; it expires by itself. Requests go through
`POST /api/access/grants` (the backend console has a form). See
[JIT elevation](../concepts/jit-access.md).

> [!NOTE]
> **Planned: Wave 4 (B-DOMAIN, F-ENG).** Real repositories, pull requests with
> review decisions (`approve`, `request-changes`, `comment`), CI runs and code
> findings from the GitHub App.
