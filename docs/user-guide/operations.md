# Operations

Runs deployments, incidents and infrastructure across products and approves
production access. Deployment and Infrastructure `manage`; Organization,
Product, Project, Repository and Administration `view`
([matrix](../concepts/permission-matrix.md)). Demo account: Grace Liu (`m11`,
all three products).

## Daily flow

1. **Incidents** (`/incidents`) — open incidents by severity. **Declare** one
   (product, title, severity SEV1–3, optional service and impact); it starts
   as `investigating` and gets the next `INC-n` id. On the incident page move
   it through `identified` → `monitoring` → `resolved` and add timeline notes;
   every change is a timeline entry and an audit entry. SEV1 declarations are
   audited as sensitive. Mean time to recover is at
   `GET /api/incidents/_stats`.
2. **Deployments** (`/deployments`) — request deploys (staging starts
   `running`; production waits for approval). You can approve production
   deploys requested by **someone else** after re-verifying; your own need the
   Owner or another Operations member. You can roll back any deploy in your
   products without approval.
3. **Access requests** — approve or deny JIT grants from other members
   (Team page access review, or the backend console). Not your own.
4. **Monitors** (`/monitors`) and **Security** (`/security`) — sample data
   today; live sign-ins, sessions, rate limits, posture, backups and the audit
   integrity check are in the backend console (`/console`).
5. **Backups** — create a snapshot or run a restore drill (step-up) from the
   backend console. See [Backups and restore](../operations/backups.md).

With Administration `view` you also see everyone's sign-ins and live sessions
(`/api/locations/*`) and the full JIT grant list.

The curated Operations workspace lists "create doc" and "log time", but your
Project level is `view`, so the app hides them and the API would refuse them
(see the [consistency checks](../concepts/permission-matrix.md#curated-actions-the-server-denies)).

> [!NOTE]
> **Planned: Wave 4 (B-DOMAIN).** Real monitors: HTTP checks run by a
> scheduler (SSRF-safe), opening an incident after repeated failures.
