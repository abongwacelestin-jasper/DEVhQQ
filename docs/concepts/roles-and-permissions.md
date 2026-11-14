# Roles and permissions

Authorisation in TavetaHQ has three parts, all checked by the API on every
request:

1. **Role → level per area**, from the permission matrix.
2. **Scope**: the products the member is assigned to
   ([Products and scope](products-and-scope.md)).
3. **Rules on top** for sensitive actions: step-up, two-person approval,
   self-action bans.

The web app derives what it shows from the same data and never decides on its
own that something is allowed.

## Roles

| Role | In one line | Demo account |
|---|---|---|
| **Owner** | Full control of the organisation, every product, security and audit. The web app labels it "Admin". | `m1` Amara Okafor |
| **Project manager** | Plans, assigns and documents work in their products; reads deployments. | `m2` Daniel Reyes |
| **Developer** | Works tasks and code in their products; reads deployments and infrastructure. | `m4` Kofi Mensah |
| **Designer** | Works design tasks and docs in their products. | `m9` Inès Moreau |
| **Tester** | Works the test queue, reports bugs, reads deployments. | `m10` Ravi Patel |
| **Operations** | Runs deployments, incidents and infrastructure across products; approves production access. | `m11` Grace Liu |

A member has exactly one role (`Member.role`). The Owner role cannot be handed
out by invite; it can only be given by an existing Owner changing a member's
role, and the last active Owner cannot be demoted (`409 last_owner`).

## Areas and levels

The matrix grants a **level** in each of seven **areas**:

| Area | Covers |
|---|---|
| Organization | the member directory, roles, invitations, workspaces |
| Product | product-level views and analytics |
| Project | projects, tasks, comments, subtasks, time logs, docs |
| Repository | repositories, pull requests, code, code security |
| Deployment | deployment requests, approvals, rollbacks, JIT revocation |
| Infrastructure | backups and restore drills; incidents and monitors in the UI |
| Administration | security settings, the audit page, integrations, everyone's sign-ins and sessions, JIT grant list |

Levels are ordered `none` < `view` < `contribute` < `manage` < `admin`, and a
check for a level passes for any higher level.

**The full matrix, with every enforcement point and the UI mapping, is
generated from the code: [Permission matrix](permission-matrix.md).** Do not
copy it elsewhere; link to it.

## How a check runs

- **Route guard.** `requireArea(area, level)` in the route's middleware chain
  refuses the request with `403 forbidden` and the message
  `Requires <level> on <area>`:

  ```console
  $ curl -s -b dev -X POST http://localhost:8080/api/deployments -H 'content-type: application/json' \
      -d '{"product":"renewberry","env":"staging","version":"1.0","sha":"abcdef1"}'
  {"error":{"code":"forbidden","message":"Requires contribute on Deployment","requestId":"5dccb33c-…"}}
  ```

- **In-handler check.** `can(principal, area, level)` changes what a handler
  returns, e.g. `GET /api/locations/sign-ins` returns everyone's sign-ins for
  Administration ≥ `view` and only your own otherwise.
- **Scope.** `canSeeProduct` / `assertProduct` filter lists and turn
  out-of-scope resources into `404`.
- **Rules.** Some actions add a rule no matrix cell can express:

  | Rule | Where | Error |
  |---|---|---|
  | Production deploy approver ≠ requester | `POST /api/deployments/:id/approve` | `403 self_approval` |
  | JIT approver ≠ requester, and is Owner or Operations | `POST /api/access/grants/:grantId/approve` | `403 self_approval`, `403 forbidden` |
  | Assignee cannot move their own task to `done` unless Project ≥ `manage` | `PATCH /api/tasks/:key` | `403 self_close` |
  | Cannot change your own role | `PATCH /api/team/:memberId` | `403 self_demotion` |
  | At least one active Owner remains | `PATCH /api/team/:memberId` | `409 last_owner` |
  | Invites only for products the inviter is assigned to | `POST /api/team/invites` | `403 forbidden` |
  | Sensitive actions need a fresh verification | see [Step-up](step-up.md) | `401 step_up_required` |

- **Changes take effect immediately.** Changing a member's role, products or
  status revokes all of their sessions (`revokeAllFor`), so the new
  permissions apply on their next sign-in rather than whenever a token
  expires.

## How the web app uses it

After sign-in the app calls `GET /api/me/capabilities`:

```console
$ curl -s -b dev http://localhost:8080/api/me/capabilities
{"role":"Developer","products":["renewberry"],"matrix":{"Organization":"view","Product":"contribute","Project":"contribute","Repository":"contribute","Deployment":"view","Infrastructure":"view","Administration":"none"},"levels":["none","view","contribute","manage","admin"],"verifiedAt":1794011769217,"elevations":[]}
```

`Frontend/src/api/capabilities.ts` maps each page and action to a server area
and level. A page or button appears only when the server level is high enough
**and** the role's curated list in `Frontend/src/data/roles.ts` includes it.
The curated list can hide something the server allows, never the reverse;
hiding is presentation, the API is the control. The
[permission matrix page](permission-matrix.md#how-the-web-app-uses-the-matrix)
shows the resulting pages per role and the actions a curated list offers but
the server denies.

`GET /api/team/roles` returns the whole matrix (used by the Team page and the
console).

## Routes open to every signed-in member

Some authenticated routes have no area guard. Most are personal (your own
sessions, passkeys, capabilities) or product-scoped in the handler (tasks,
docs, incidents). `GET /api/_inventory` (the route table) and
`GET /api/_query/collections` return the same thing to every member.

The audit and console routes are **not** open: they need Administration ≥
`view` (Owner and Operations) and return `403 forbidden` to everyone else.

| Route | Returns |
|---|---|
| `GET /api/audit`, `GET /api/audit/verify` | the whole audit trail, all products |
| `POST /api/_query` with `from: "audit"` | the same, through the query runner (zero rows without Administration ≥ `view`) |
| `GET /api/_logs` | recent request logs (paths, IPs, member ids) |
| `GET /api/_metrics`, `GET /api/_config` | runtime metrics, redacted config |
| `GET /api/security/posture`, `GET /api/security/rate-limits`, `GET /api/backups` | security summary, rate-limit buckets (keyed by IP), backup status |

`POST /api/incidents` and `PATCH /api/incidents/:id` also have no area guard:
any member can declare or update an incident in a product in their scope. The
web app offers "Declare incident" only to roles with Infrastructure ≥
`contribute`.

`GET /api/_events` filters every event per subscriber (security events only
for Administration ≥ `view`), see [Realtime](../api/realtime.md). The generated list of every authenticated route
without an area guard is at the end of the
[permission matrix page](permission-matrix.md#authenticated-routes-without-an-area-guard).

## Personal access tokens

A personal access token carries scopes such as `project:view` or
`deployment:contribute`. On every request the token's level in an area is the
**lower** of its scope and the member's current role (`effectiveLevel` in
`Backend/auth/rbac.ts`); an area the token has no scope for is `none`. Tokens
can never pass step-up and cannot manage tokens or credentials
(`requireSession`). Routes without an area guard do not consult scopes, so a
token with any scope can read them; `GET /api/me/capabilities` still reports
the role's matrix for a token rather than the token's effective levels (an
open item in [docs/security/CONTROLS.md](../security/CONTROLS.md#known-gaps--follow-ups)).
See [Authentication](../api/authentication.md#personal-access-tokens).
