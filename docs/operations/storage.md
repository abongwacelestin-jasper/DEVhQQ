# Storage

DevHQ keeps state in two places: PostgreSQL for records, S3-compatible object
storage for blobs. The bucket set-up, object lock, service users and the AWS
S3 / Cloudflare R2 equivalents are documented by the storage lane in
[infra/minio/README.md](../../infra/minio/README.md); this page explains how the
application uses them.

## PostgreSQL

`Backend/db/boot.ts`, called once from `buildApp()`:

- **Without `DATABASE_URL`** everything stays in memory and demo data is
  seeded on every start (local quick start, smoke tests).
- **With `DATABASE_URL`**: run migrations (with `DATABASE_MIGRATION_URL`, the
  DDL-capable role, when set), install the PostgreSQL collection driver, load
  every registered collection into memory (`hydrateAll()`), then seed demo
  data **only** when `NODE_ENV` is not `production` **and** the documents
  table is empty. The emptiness check and the seed run under an advisory lock.
- Rows live in a generic `documents` table keyed by `(collection, key)` with
  a JSONB payload ([ADR 0003](../architecture/adr/0003-postgres-jsonb-collections.md)).
  Handlers read from memory; writes are queued and flushed in order.
  `GET /api/ready` reports `"persistence": {"mode", "pending", "saturated"}`
  and turns `503` when the database is unreachable or the write queue is
  saturated.
- The audit chain is mirrored into an append-only `audit_entries` table
  (`Backend/db/auditSink.ts`), one `chain_id` per process boot.

Persisted collections include members, projects, docs, tasks and their
activity, deployments, incidents, sign-ins, sessions, JIT grants, TOTP replay
counters, personal access tokens, files, and every collaboration and
engineering module (`collab_*`, `eng_*`). Rate-limit buckets, logs and metrics
stay per process.

Connection settings: `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `DATABASE_SSL`,
`DATABASE_SSL_CA`, `DATABASE_POOL_MAX`, `DATABASE_CONNECT_TIMEOUT_MS`,
`DATABASE_STATEMENT_TIMEOUT_MS` (see [env vars](env-vars.md)).

## Object storage

| Bucket (variable) | Default | Used for |
|---|---|---|
| `S3_BUCKET_UPLOADS` | `devhq-uploads` | user files: `pending/` while uploading, `files/` once verified |
| `S3_BUCKET_BACKUPS` | `devhq-backups` | encrypted application snapshots and their manifests; database dumps from `make backup` |
| `S3_BUCKET_AUDIT` | `devhq-audit` | audit chain batches |
| `S3_BUCKET_MODELS` | `devhq-models` | the ML model registry (models service only) |

Backups and audit buckets use Object Lock: `GOVERNANCE` in development,
`COMPLIANCE` in production (`STORAGE_LOCK_MODE`), so neither the backend
credential nor an attacker holding it can delete or shorten retention. The
backend's MinIO user can only `PutObject` into the audit bucket.

Without `S3_ENDPOINT` the backend uses a local driver under
`STORAGE_LOCAL_DIR` (default `<BACKUP_DIR>/object-store`), which is what a
plain `npm run dev` uses; `GET /api/storage/status` shows the driver in use:

```json
{"driver":"local","buckets":{"uploads":"devhq-uploads","backups":"devhq-backups","audit":"devhq-audit","models":"devhq-models"},"lockMode":"GOVERNANCE","uploads":true,"auditArchive":{"enabled":true,"bootId":"20261107T054006Z-07c238","pending":11,"batches":0,"entries":0,"failures":0,"lastKey":"","lastError":""}}
```

In production an `S3_ENDPOINT` that is not `https://` is refused unless
`S3_ALLOW_HTTP=1` (used for the internal `http://minio:9000` in Compose).

### File uploads

`Backend/routes/files.routes.ts`. The API never proxies file bytes:

1. `POST /api/files/uploads {purpose, contentType, size, name, refId}` checks
   the purpose's type and size allow-list and the caller's access to the
   referenced resource, then returns a presigned `PUT` (content type and length
   are signed) valid for 10 minutes. Purposes: `avatar` (raster images, 2 MB),
   `doc-attachment` and `message-attachment` (25 MB).
2. The browser uploads directly to storage.
3. `POST /api/files/:fileId/complete` checks the object exists with the exact
   size, sniffs the magic bytes, runs the malware-scan hook, and only then moves
   it to `files/`. Any mismatch deletes the object.
4. `GET /api/files/:fileId` returns a 60-second presigned `GET`. Only raster
   images render inline; everything else downloads as an attachment with the
   verified content type.

Access follows the referenced resource: a file attached to something you
cannot see answers `404`. Every state change is audited.

Presigned URLs are signed for the host the browser uses: the backend talks to
`S3_ENDPOINT` internally and signs browser URLs for `S3_PUBLIC_ENDPOINT`. See
the storage README for the edge routing and CORS this needs.

### Audit archive

`Backend/storage/auditArchive.ts` ships the audit chain to the audit bucket in
batches (every 200 entries or 60 s) as
`audit/YYYY/MM/DD/<bootId>/<fromSeq>-<toSeq>.jsonl`. Each batch's header
carries the hash it chains from and its head hash, so consecutive batches link
up and a missing or altered batch is detectable offline. Failed uploads stay
buffered and are retried; the local `AUDIT_LOG_FILE` remains the first copy.

## Encryption

- TOTP secrets, integration credentials and backups are sealed with
  AES-256-GCM using `DATA_ENCRYPTION_KEY` (32 bytes, hex). Previous keys for
  decryption during rotation go in `DATA_ENCRYPTION_KEYS_PREVIOUS`. Rotating
  the key needs app-side re-encryption; do not change the file alone
  ([runbook §4](../deploy/RUNBOOK.md#4-rotation)).
- MinIO server-side encryption (`sse-s3`) is a second layer and needs a KMS
  key on the server: `MINIO_KMS_SECRET_KEY` for a single static key, or KES
  with a real KMS. Without one, `ENABLE_SSE=0` skips it — acceptable for
  development only. See [Known limits](known-limits.md).
