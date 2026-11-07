# 0007. Two-person rule for production deploys and JIT access

- **Status:** Accepted, implemented
- **Date:** 2026-10-30 (recorded 2026-11-07)

## Context

A single compromised or careless account should not be able to change
production. Production changes in DevHQ come in two forms: deploying a new
version, and a person gaining production access (just-in-time elevation).
Recovery, on the other hand, must never wait for process: when production is
broken, rolling back has to be fast.

## Decision

**Production deploys** (`Backend/routes/operations.routes.ts`):

- Requesting a deploy needs Deployment ≥ `contribute` and the product in the
  caller's scope. A `production` request starts as `awaiting-approval`; a
  `staging` request starts as `running` with no approval.
- Approving needs Deployment ≥ `manage` **and** a step-up within the last
  5 minutes, and the approver must not be the requester
  (`403 self_approval`). Only `awaiting-approval` deploys can be approved
  (`409 not_pending`).
- Rolling back needs Deployment ≥ `manage` but **no** step-up and **no**
  second person (MTTR first). A deploy already rolled back answers
  `409 already_rolled_back`.

**JIT production access** (`Backend/auth/jit.ts`,
`Backend/routes/team.routes.ts`):

- Any member can request a grant for a product in their scope, with a reason
  of at least 10 characters and a duration of 15–480 minutes, after a step-up.
- Only an Owner or Operations member who is not the requester can approve,
  after a step-up (`403 self_approval`, `403 forbidden`).
- Revoking or denying needs Deployment ≥ `manage` and a step-up.
- Grants expire automatically; a 15-second sweeper marks them `expired` and
  audits it.

Every transition is written to the audit log with `sensitive: true`.

With the current matrix only Owner (`admin`) and Operations (`manage`) reach
Deployment ≥ `contribute`, so only they can request or approve deploys, and a
production deploy needs two different people from that group. Developers keep
`Deployment: view` (Wave 4 owner decision).

## Consequences

- An Operations engineer can request a production deploy but needs the Owner
  or another Operations member to approve it; with a single Operations member
  the Owner is the only possible approver.
- The rule is enforced in the API, so the backend console, the web app and any
  script are bound by it equally.
- Rollback without approval is a deliberate gap: someone with Deployment ≥
  `manage` can roll back alone. The audit entry is the control.
- DevHQ records and approves deploys; the actual rollout is simulated (the
  status changes to `succeeded` after about four seconds). Connecting the
  approval to a real CI/CD system is not part of the code yet.
- `requireElevation()` exists in `Backend/auth/rbac.ts` for routes that should
  require an active JIT grant, but no route uses it yet: an active grant shows
  up in the principal's `elevations` and in the UI, and does not unlock any
  endpoint today.

## References

- `Backend/routes/operations.routes.ts`, `Backend/auth/jit.ts`,
  `Backend/auth/rbac.ts`
- [JIT elevation](../../concepts/jit-access.md), [Step-up](../../concepts/step-up.md)
