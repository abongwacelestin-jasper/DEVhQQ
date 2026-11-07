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
3. **First sign-in only:** if you have no authenticator yet (a new invite),
   you enrol one. The web app's Verify screen does not offer this step yet;
   an admin can walk you through the API steps in
   [Deployment and first run](../operations/deployment.md#first-run-production-setup).
4. Every role except the Owner then goes through two onboarding screens once:
   **NDA** (`/onboarding/nda`) and **Complete profile**
   (`/onboarding/profile`). The server records them
   (`GET /api/onboarding`, `POST /api/onboarding/nda`,
   `POST /api/onboarding/profile`): the signature stores the agreement version,
   your typed name, time, IP and a hash of the text.

Forgot your password? **Forgot password** (`/forgot-password`) sends a
single-use reset link valid for 30 minutes; the reset signs you out
everywhere.

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

## Where page data comes from

Every page reads the API. A few panels still use fixed presentation data from
`Frontend/src/data/`, and some modules show labelled demo data when an
integration is not configured.

| Page | Data |
|---|---|
| Overview, My work, Assigned to me, Projects, Project detail, Task detail, Assignments, Work activity, Test queue | API — tasks, comments, subtasks, time logs, notifications, products, projects, team; task insights from the ML bridge. Project cards add presentation fields (colours, descriptions) from `Frontend/src/data/work.ts`. |
| Docs | API — documents, versions with diff and restore, inline comments, attachments. |
| Messages | API — channels, DMs, threads, reactions, pins, polls, attachments; live over `/api/stream`. |
| Workspaces | API — workspaces; the module catalogue and templates are presentation data. |
| Deployments, Incidents | API — including approvals behind step-up and deployment risk insights. |
| Repositories, Pull requests, Code security, CI | API — GitHub App data; labelled **demo** outside production when GitHub is not configured. |
| Monitors, Integrations | API — real checks and outbound webhooks; seeded demo monitors are labelled and never probed. |
| Team, Member detail, Audit log | API — directory, roles, invites, deactivation, access review, offboarding, member audit trail. |
| Security Center | API for sessions, passkeys, authenticator, personal access tokens, sign-ins and grants; the policy and check list is presentation data (`Frontend/src/data/security.ts`). |
| IDE & dev tools | the IDE list is presentation data; Codespaces through the API when configured. |
| Assistant panel | `POST /api/assistant/ask`; unavailable without the models service and an API key. |
