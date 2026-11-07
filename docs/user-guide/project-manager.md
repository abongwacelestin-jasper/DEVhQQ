# Project manager

Plans, assigns and documents work in their products. Project and Product
`manage`, Organization, Repository and Deployment `view`, no Infrastructure or
Administration ([matrix](../concepts/permission-matrix.md)). Demo account:
Daniel Reyes (`m2`, renewberry).

## Daily flow

1. **Portfolio delivery** (`/`) — your products with open and late tasks.
2. **Assignments** (`/assignments`) — who has what; reassign tasks. Assigning
   needs Project ≥ `manage`, and the assignee must be an active member of the
   task's product (`422 assignee_invalid` otherwise).
3. **Projects** (`/projects`, `/projects/:projectId`) — create tasks
   (title, type, priority, assignee, optional reviewer, due date, estimate in
   hours 1–40).
4. **Task detail** (`/tasks/:taskKey`) — change status, priority, due date;
   comment; add and tick subtasks; log time. Every change is recorded on the
   task's timeline and in **Work activity** (`/activity`).
5. **Docs** (`/docs`) — write specs, meeting notes, decisions and handovers;
   publish them (status `draft` → `in-review` → `published`). Deleting a doc
   needs Project ≥ `manage`, which you have.
6. **Team** (`/team`) — read the directory for your products.

## Rules that apply to you

- You can move other people's tasks to **done**; your own too, because you
  hold Project ≥ `manage`.
- **Deployments are read-only**: you can see them but not request, approve or
  roll back (`403 forbidden`).
- You can delete tasks and docs in your products. Deletions are audited as
  sensitive.
