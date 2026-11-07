# User guide

How each role uses the web app day to day. Pick your role:

| Role | Lands on | Guide |
|---|---|---|
| Owner ("Admin" in the app) | Overview `/` | [Owner](owner.md) |
| Project manager | Portfolio delivery `/` | [Project manager](project-manager.md) |
| Developer | My work `/my-work` | [Developer](developer.md) |
| Designer | My work `/my-work` | [Designer](designer.md) |
| Tester | Test queue `/test-queue` | [Tester](tester.md) |
| Operations | Incidents `/incidents` | [Operations](operations.md) |

Administration — invitations, roles, access review, offboarding — is in
[Admin tasks](admin-tasks.md).

## Signing in

1. Open the app and sign in with your email and password, or (outside
   production) a demo role button. See
   [Local development](../getting-started/local-development.md#4-sign-in-with-a-demo-account).
2. Enter the 6-digit code from your authenticator on the **Verify** screen
   (`/verify`). Demo accounts use `246810`.
3. Every role except the Owner then goes through two onboarding screens once:
   **NDA** (`/onboarding/nda`) and **Complete profile**
   (`/onboarding/profile`).

> [!NOTE]
> **Planned: Wave 4 (B-COLLAB, F-SEC).** The NDA and profile are kept in the
> browser's `sessionStorage` today, so they are asked again in a new browser
> and are not recorded on the server. Wave 4 makes the server the authority
> (`GET /api/onboarding`, `POST /api/onboarding/nda`,
> `POST /api/onboarding/profile`). "Forgot password" (`/forgot-password`,
> `/reset-password`) is UI only today; account recovery
> (`POST /api/auth/recovery/request`, `/reset`) arrives with B-COLLAB.

The app locks after a period of inactivity (configurable in the app, with a
30-second warning) and asks you to re-verify; the server independently
requires re-verification after 15 idle minutes. Sensitive actions (approving a
deploy, changing a role, requesting production access) open a
**re-verification** dialog first — see [Step-up](../concepts/step-up.md).

## What you can see

The navigation shows a page only if your role's server permissions allow it
and it is part of your role's workspace. The exact list per role is generated
in the [permission matrix](../concepts/permission-matrix.md#pages-each-role-is-shown).
Everything is limited to the products you are assigned to; the product picker
in the top bar narrows it further. A link to something outside your products
shows "not found".

## Which pages read the API

Some pages still show sample data from `Frontend/src/data/`. Changes you make
on those pages are not saved anywhere.

| Page | Data |
|---|---|
| Overview, My work, Assigned to me, Projects, Project detail, Task detail, Assignments, Work activity, Test queue (tasks) | **API** — tasks, comments, subtasks, time logs, products, projects, team. Project cards add presentation fields from `Frontend/src/data/work.ts`. My work's approvals and mentions panel is sample data. |
| Docs | **API** — list, read, create, edit, delete. Version history and inline comments are kept only in the browser. |
| Deployments, Deployment detail | **API** — list, approve, roll back. Detail pages add sample topology and commit data. |
| Incidents, Incident detail | **API** — list, declare, update. Incident history and next steps are sample data. |
| Team, Member detail | **API** — directory, roles, invitations, deactivation, access review, member audit trail. |
| Audit log | **API** — `GET /api/audit`. |
| Product pages (`/products/:id/…`) | Mixed: work, deployments and incidents from the API; code, analytics and people panels partly sample data. |
| Repositories, Pull requests, Code security, IDE & dev tools, Monitors, Integrations, Messages, Workspaces | **Sample data.** Backends arrive in Wave 4. |
| Security Center | **Sample data** (policies, checks, sign-ins, grants). The live equivalents are in the backend console and the Team page's access review. |
| Code workspace (`/code`) | Local editor and sandbox; can create GitHub Codespaces through the API when `GITHUB_TOKEN` is configured. |

> [!NOTE]
> **Planned: Wave 4 (F-ENG, F-COLLAB).** Every page in the "Sample data" rows
> moves onto a real backend module; no page may present seed data as live
> (`docs/agents/WAVE4.md`). This table will be updated as the lanes merge.
