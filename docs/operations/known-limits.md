# Known limits

Read this before putting DevHQ in front of real users. Each item says what the
limit is, why, and what to do about it.

## Run exactly one backend replica

Every backend process loads all collections into memory at boot and serves
reads from there ([ADR 0003](../architecture/adr/0003-postgres-jsonb-collections.md)).
There is no cross-instance invalidation yet, so two replicas would each see
only their own writes and diverge. Rate-limit buckets, the event bus and the
realtime streams are per process too. Stay at one replica (the
Compose default) and scale vertically.
One-shot commands that write data (`bootstrap-owner`) must run with the
backend stopped for the same reason. See the
[runbook scaling notes](../deploy/RUNBOOK.md#5-scaling-notes).

## ML models are synthetic until there is real history

Outside production the models service trains and promotes **synthetic
cold-start models** at start-up when nothing is promoted
(`ML_BOOTSTRAP_SYNTHETIC`, on by default outside production). In production
nothing is bootstrapped: until a model is trained and promoted, the backend
answers every insight from its heuristics (`source: "heuristic"`). Synthetic
models' metrics prove the pipeline works; they say nothing about accuracy for
your team. Responses
carry `trainedOn: "synthetic"`. A model trained on real data is only promoted
when it passes the held-out gate (for example AUC ≥ 0.70 and at least 200
training rows for overdue risk), which a small team will not reach for a while.
Until then, treat every insight as advisory. Deployment risk must never block
or reassign a deploy on its own; the two-person rule stays the control. See the
model cards in [Models/README.md](../../Models/README.md#model-cards).

## Disable demo mode on anything internet-facing

Demo mode is on whenever `NODE_ENV` is not `production` and `DEMO_DISABLED` is
not `1`. It seeds twelve accounts with the public password `devhq-demo`, offers
one-click role sign-in (`POST /api/auth/demo`), and accepts the shared code
`246810` for the seeded demo accounts. The code is published by
`GET /api/auth/demo-accounts`. A staging server reachable from the internet
with demo mode on is an open door. Set `DEMO_DISABLED=1` there (the
`.env.example` default). Production refuses to start with any other
`DEMO_*` variable set.

## MinIO server-side encryption needs a KMS key in production

`mc encrypt set sse-s3` only works when the MinIO server has a KMS:
`MINIO_KMS_SECRET_KEY=<name>:<base64 32 bytes>` (a single static key) or KES
with a real KMS. `ENABLE_SSE=0` skips bucket encryption and is for
development only. Backups and sealed secrets are encrypted by the app with
`DATA_ENCRYPTION_KEY` regardless, but uploads would be stored in clear.
See [infra/minio/README.md](../../infra/minio/README.md).

## Other limits

- **First-factor enrolment is API-only.** The web app's Verify screen cannot
  enrol a first authenticator yet; see
  [Deployment and first run](deployment.md#first-run-production-setup).
- **Console and audit routes are open to every signed-in member.**
  `GET /api/audit`, `/api/_logs`, `/api/_metrics`, `/api/_config`,
  `/api/security/posture` and the query runner's `audit` collection have no
  role guard. `/api/_events` is filtered per subscriber. See
  [Roles and permissions](../concepts/roles-and-permissions.md#routes-open-to-every-signed-in-member).
- **Each boot starts a new audit chain** (`seq` 1). The chains are linked
  across restarts only by their archived copies, not cryptographically.
- **JIT elevation does not unlock any route yet** (`requireElevation` is
  unused).
- **Deployments are recorded and approved, not executed.** Rollout status is
  simulated.
- **`DATA_ENCRYPTION_KEY` rotation** needs app-side re-encryption; do not
  replace the key file on its own.
- Open items from the security lane are listed in
  [docs/security/CONTROLS.md](../security/CONTROLS.md#known-gaps--follow-ups)
  and the independent assessment in
  [docs/security/assessment/REPORT.md](../security/assessment/REPORT.md).
