# Backups and restore

`Backend/resilience/backups.ts` writes immutable snapshots of the data store
and can prove that the latest one is readable.

## What a snapshot contains

`snapshot-<ISO time>.json` in `BACKUP_DIR`:
`{version: 1, createdAt, data}` where `data` holds `members`, `projects`,
`docs`, `tasks`, `taskEvents`, `taskComments`, `subtasks`, `timeLogs`,
`deployments` and `incidents` (`snapshot()` in `Backend/store/db.ts`).

Not included: sessions, sign-in records, JIT grants, rate-limit state and the
audit log (which has its own file). Member records include password hashes and
any TOTP secret, so **treat snapshots as secrets**.

Each snapshot is:

- written with the `wx` flag — create only, never overwrite;
- made read-only (`0444`) straight after writing;
- recorded in `manifest.jsonl` with its SHA-256 and size.

## When snapshots are taken

- Outside production, 2 seconds after the server starts.
- Every 24 hours of uptime, in every environment; after each daily run,
  snapshots older than `BACKUP_RETENTION_DAYS` (35) are pruned.
- On demand: `POST /api/backups` (Infrastructure ≥ `manage` — Owner,
  Operations — plus step-up).

Every create, prune and drill is audited (`backup.created`, `backup.pruned`,
`backup.drill_passed` / `backup.drill_failed`).

```console
$ curl -s -X POST http://localhost:8080/api/backups -H "Authorization: Bearer $TOKEN"
{"file":"snapshot-2026-11-07T00-38-39-697Z.json","sha256":"673e8019dccf3b0063f233b1029227b4545b9fe3a794d7840401adfada4088f5","createdAt":"2026-11-07T00:38:39.697Z","bytes":22695}
```

## Checking backups

```console
$ curl -s http://localhost:8080/api/backups -H "Authorization: Bearer $TOKEN"
{"count":2,"latest":{"file":"snapshot-2026-11-07T00-38-39-697Z.json","sha256":"673e8019…88f5","createdAt":"2026-11-07T00:38:39.697Z","bytes":22695,"verified":true},"retentionDays":35}
```

`verified` re-hashes the latest file and compares it with the manifest.

## Restore drill

`POST /api/backups/drill` (same permissions) loads the newest snapshot,
verifies its checksum and parses it **without touching live data**, and
reports how long that took:

```console
$ curl -s -X POST http://localhost:8080/api/backups/drill -H "Authorization: Bearer $TOKEN"
{"ok":true,"file":"snapshot-2026-11-07T00-38-39-697Z.json","ms":1,"records":134}
```

## Restoring

There is **no restore endpoint or script**. Today a restart reseeds demo data;
nothing reads a snapshot back into the store. A manual restore would mean
loading the `data` object into the `db` maps in code. With PostgreSQL
(Wave 4) the database itself becomes the primary copy and restore procedures
belong with it.

> [!NOTE]
> **Planned: Wave 4 (B-DATA, STORAGE, INFRA).** Snapshots ship to
> `S3_BUCKET_BACKUPS` with object lock in production; PostgreSQL backup and
> restore procedures are documented by INFRA in `docs/deploy/`.

## Production guidance (from the code comments)

Point `BACKUP_DIR` at storage with object lock / WORM retention in a separate
account. File modes alone do not stop an attacker with root on the host.
