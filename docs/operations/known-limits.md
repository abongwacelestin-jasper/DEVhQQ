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

## Periodic jobs run where `JOBS_IN_PROCESS` says, and the worker waits

The API's daily backup timer restarts with every deploy (and production skips
the boot-time backup), so a service deployed more than once a day never backs
up from that timer. Run backups from a scheduler instead: the Railway cron
service runs `worker.ts --once backup,drill`, and Compose has
`make backup` for database dumps. Monitors and digests write collections, so
they must stay in the API process until cross-instance invalidation exists;
`worker.ts` refuses its long-running mode in production unless
`WORKER_LOOP_ENABLED=1`. See [Railway: Jobs](../deploy/RAILWAY.md#10-jobs-where-each-periodic-job-runs).

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
