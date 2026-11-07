# Backups and restore

There are two independent backup paths. Use both.

| | Application snapshots | Database dumps |
|---|---|---|
| What | every registered collection, as the app sees it | the whole PostgreSQL database (`pg_dump -Fc`) |
| Code | `Backend/resilience/backups.ts` | `infra/scripts/backup-db.sh`, `infra/scripts/restore-db.sh` |
| Encryption | gzip, then AES-256-GCM with `DATA_ENCRYPTION_KEY` (backup id as associated data) | AES-256-CBC (PBKDF2-SHA256) + HMAC-SHA256 with `backup_encryption_key` |
| Where | `S3_BUCKET_BACKUPS`: `snapshots/YYYY/MM/DD/<id>.json.gz.enc` + `manifests/<id>.json` | `S3_BUCKET_BACKUPS`: `postgres/` |
| When | 2 s after start outside production, then every 24 h of uptime; on demand `POST /api/backups` | cron (`make backup`), and before every deploy |
| Restore | `POST /api/backups/:id/restore` (dry run by default) | `infra/scripts/restore-db.sh … --yes` |
| Drill | `POST /api/backups/drill` | `make restore-drill` |

Database dumps, their schedule, off-site mirroring and the real restore
procedure are in the [runbook §3](../deploy/RUNBOOK.md#3-backups-and-restore).
The rest of this page covers application snapshots.

## Application snapshots

Each snapshot is checksummed twice: SHA-256 of the stored ciphertext (detects
storage corruption before decrypting) and of the plaintext (proves a restore
produced exactly what was snapshotted). The backups bucket has Object Lock, so
the app's own credential cannot delete or overwrite a snapshot; expiry after
`BACKUP_RETENTION_DAYS` (35) is done by the bucket lifecycle.

Snapshots contain password hashes and sealed secrets. They are encrypted, but
keep `DATA_ENCRYPTION_KEY` away from wherever the snapshots are copied.

Permissions: listing and creating need Infrastructure ≥ `manage` (create also
step-up); restore needs Administration ≥ `admin` (the Owner) and step-up.

```console
$ curl -s -b owner -X POST http://localhost:8080/api/backups
{"id":"bk-20261107T054024Z-9d3809","file":"snapshots/2026/11/07/bk-20261107T054024Z-9d3809.json.gz.enc","bucket":"devhq-backups","store":"local","createdAt":"2026-11-07T05:40:24.388Z","bytes":8815,"sha256":"ce09d2a4…3fc3","plainSha256":"53cd293c…3fd8","keyId":"dev-derived","encryption":"aes-256-gcm",…}

$ curl -s -b owner http://localhost:8080/api/backups/snapshots      # newest first, limit ≤ 100
{"items":[{"id":"bk-20261107T054024Z-9d3809",…}]}

$ curl -s -b owner -X POST http://localhost:8080/api/backups/drill
{"ok":true,"id":"bk-20261107T054024Z-9d3809","file":"snapshots/2026/11/07/bk-20261107T054024Z-9d3809.json.gz.enc","ms":4,"records":180}
```

(`keyId: "dev-derived"`: without `DATA_ENCRYPTION_KEY` outside production the
key is derived from the session secret. Production requires a real key.)

## Restore

`POST /api/backups/:id/restore` downloads the snapshot, verifies both
checksums, decrypts, and diffs it against live data. **It is a dry run unless
the body says `{"dryRun": false, "confirm": "<backup id>"}`.** `collections`
limits it to named collections.

```console
$ curl -s -b owner -X POST http://localhost:8080/api/backups/bk-20261107T054024Z-9d3809/restore \
    -H 'content-type: application/json' -d '{}'
{"id":"bk-20261107T054024Z-9d3809","dryRun":true,"verified":true,"createdAt":"…","plan":[{"name":"auth.personal_access_tokens","restorable":true,"inBackup":1,"current":1,"add":0,"update":0,"remove":0,"unchanged":1},…]}
```

A real restore first takes a safety backup of the current state, then writes
the rows back through the collections (so they are persisted and audited).
Errors: `404 not_found` (unknown id), `422` with `backup_missing`,
`checksum_mismatch`, `format_unsupported` and similar codes when verification
fails (see [Error codes](../api/error-codes.md)).

Afterwards restart the backend if other processes (a second replica, a
one-shot command) might hold stale in-memory state, and check `/api/ready`.
