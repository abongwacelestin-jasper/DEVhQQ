# Tester

Works the test queue, reports bugs, checks PRs and staging. Project and
Product `contribute`; Organization, Repository and Deployment `view`
([matrix](../concepts/permission-matrix.md)). Demo account: Ravi Patel
(`m10`, renewberry and mirror).

## Daily flow

1. **Test queue** (`/test-queue`) — tasks waiting for testing, from the API.
   with the related pull requests and staging deployments.
2. **Task detail** — as a task's reviewer you can move it to `done` (the
   self-close rule only stops the assignee). Comment with findings, log time.
3. **Report a bug** — create a task of type `bug` in the project.
4. **Deployments** (`/deployments`) — read-only view of what is on staging and
   production.
5. **Pull requests** (`/pull-requests`) — PR checks from the GitHub App (demo data when GitHub is not configured).

The curated Tester workspace offers bug reports and time logging, not general
task creation (`Frontend/src/data/roles.ts`); the API would allow creating
tasks (Project ≥ `contribute`).
