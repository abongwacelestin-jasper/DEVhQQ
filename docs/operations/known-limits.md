# Known limits

Read this before putting DevHQ in front of real users. Each item says what the
limit is, why, and what to do about it.

## Run exactly one backend replica

The data layer is part way through its move to relational tables
([ADR 0011](../architecture/adr/0011-relational-data-layer.md)). Stay at one
replica (the Compose default) and scale vertically until phase 3 lands.

**Already replica-safe** (phase 1: typed tables, read from PostgreSQL on every
request, nothing held in process memory): members and their credentials
(`members`), sessions (`sessions`), tasks (`tasks`), task events
(`task_events`), task comments (`task_comments`) and notifications
(`notifications`). `npm run smoke:pg` proves it with two API processes on one
database. Without `DATABASE_URL` these live in process memory, as before.

**Still need one replica**, because each process loads them into memory at
boot and never sees another process's later writes
([ADR 0003](../architecture/adr/0003-postgres-jsonb-collections.md)):

- work data: `projects`, `docs`, `subtasks`, `timeLogs`, `deployments`,
  `incidents`, `incident_actions`;
- collaboration: `collab_channels`, `collab_messages`, `collab_channel_reads`,
  `collab_workspaces`, `collab_doc_versions`, `collab_doc_comments`,
  `collab_nda_signatures`, `collab_resignations`, `collab_recovery_tokens`
  (a reset link issued by one replica is unknown to another);
- security: `jitGrants`, `auth.personal_access_tokens`,
  `auth.totp_counters` (TOTP replay protection is per process), `signIns`
  (the risk history);
- engineering: every `eng_*` collection (repos, pulls, CI runs, findings,
  GitHub installations, deliveries and identities, monitors and their
  history, integrations, outbound webhooks and deliveries), and `files`;
- state that is not persisted at all: pending WebAuthn challenges
  (`auth/webauthn.ts`) and pending authenticator enrolments (`auth/totp.ts`),
  so the options call and the verify call must reach the same process.

With `REDIS_URL` set, the stateless parts are already shared
([ADR 0009](../architecture/adr/0009-redis-for-shared-runtime-state.md)):
rate-limit buckets, the event bus behind `/api/_events`, the realtime hub
behind `/api/stream`, and periodic-job leases. Without `REDIS_URL` all four
are per process, as before. The conditions for more than one replica are in
[Railway: Scaling](../deploy/RAILWAY.md#11-scaling).

Pub/sub is fire-and-forget. A replica that is disconnected from Redis when an
event is published does not receive it; SSE clients replay recent events by
`Last-Event-ID` from whichever replica they reconnect to, best effort (each
replica keeps the last 500 events it saw).
`bootstrap-owner` writes only members, which are rows now (the unique keys
decide), so it can run beside a live backend. Other one-shot commands that
write collections still need the backend stopped. See the
[runbook scaling notes](../deploy/RUNBOOK.md#5-scaling-notes).

## Periodic jobs run where `JOBS_IN_PROCESS` says, and the worker waits

The API's daily backup timer restarts with every deploy (and production skips
the boot-time backup), so a service deployed more than once a day never backs
up from that timer. Run backups from a scheduler instead: the Railway cron
service runs `worker.ts --once backup,drill`, and Compose has
`make backup` for database dumps. Monitors and digests write collections, so
they must stay in the API process until cross-instance invalidation exists;
`worker.ts` refuses its long-running mode in production unless
`WORKER_LOOP_ENABLED=1`. Each run takes a lease first (Redis `SET NX PX` with
`REDIS_URL`), so a job never runs twice even when several processes have it
enabled. A lease does not stop the worker from writing over rows the API
holds in memory. `WORKER_LOOP_ENABLED=1` becomes safe once the data layer
serves monitors, monitor history, incidents, notifications and members from
Postgres on demand, and moves the module-level sweeps (sessions, JIT grants,
tokens) off in-memory state. While Redis is unreachable, runs are skipped,
not run unguarded. See [Railway: Jobs](../deploy/RAILWAY.md#10-jobs-where-each-periodic-job-runs).

## R2 bucket locks are not S3 Object Lock COMPLIANCE

On Cloudflare R2 the backups and audit buckets are protected by bucket lock
rules: no token can delete or overwrite a locked object, but a Cloudflare
account admin can remove the rule. See
[WORM on R2](../deploy/RAILWAY.md#worm-on-r2) for the compensating controls.

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

- **French and Spanish cover navigation and page headings only.** Body copy,
  forms and messages are English. Full translation needs translated strings
  reviewed by native speakers (`Frontend/src/data/translations.ts`).
- **The audit trail, logs and metrics are not product-scoped.** They need
  Administration ≥ `view` (Owner, Operations), and whoever has it sees every
  product. See
  [Roles and permissions](../concepts/roles-and-permissions.md#routes-open-to-every-signed-in-member).
- **The audit chain proves integrity, not the newest tail.** Each boot
  continues the stored chain, so restarts are covered by the hashes. Entries
  removed from the very end while no process is running are not detectable
  from that store alone. Check against the archive's latest `headHash`
  (`verify-audit.ts --head`), as described in
  [Audit verification](audit-verification.md#what-the-hashes-cannot-prove).
- **Deployments are recorded and approved, not executed.** Rollout status is
  simulated.
- **Incident action items have no reminders.** An overdue step is only
  highlighted on the incident page; nothing is sent when a due date passes.
  Due dates are calendar days compared with the viewer's local date. A deleted
  step is gone from the list; its timeline and audit entries remain. An
  incident holds at most 100 steps.
- **`DATA_ENCRYPTION_KEY` rotation** needs app-side re-encryption; do not
  replace the key file on its own.
- Open items from the security lane are listed in
  [docs/security/CONTROLS.md](../security/CONTROLS.md#known-gaps--follow-ups)
  and the independent assessment in
  [docs/security/assessment/REPORT.md](../security/assessment/REPORT.md).
