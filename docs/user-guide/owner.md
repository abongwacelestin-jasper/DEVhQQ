# Owner

The Owner has `admin` in every area and sees every product
([matrix](../concepts/permission-matrix.md)). The web app calls this role
**Admin**. Demo account: Amara Okafor (`m1`). No onboarding screens.

## Daily flow

1. **Overview** (`/`) — products with open and late task counts, projects and
   people, from `/api/products`, `/api/projects` and `/api/team`.
2. **Approvals.** Production deploys requested by Operations wait for you on
   **Deployments** (`/deployments`). Open one and approve; the app asks you to
   re-verify if your last verification is older than 5 minutes or your network
   changed. You cannot approve a deploy you requested.
3. **Access review** on **Team & roles** (`/team`) — pending JIT grants and
   active members without a second factor. Approve or deny grants (you cannot
   approve your own). See [Admin tasks](admin-tasks.md#access-review).
4. **Audit log** (`/audit`) — the full trail; filter by member from a member's
   page (`/team/:memberId`).

## Things only the Owner does

- Invite members and change roles, products and status
  ([Admin tasks](admin-tasks.md)).
- Make another member an Owner. You cannot change your own role, and the last
  active Owner cannot be demoted.
- Read restricted docs you are not an editor of.
- Create backups and run restore drills (Infrastructure ≥ `manage`; also
  Operations) — from the backend console today.
- See every page, including Security, Integrations, Workspaces and Audit.

The Owner also passes every JIT elevation check without a grant
(`requireElevation` in `Backend/auth/rbac.ts`), though no route uses that
check yet.
