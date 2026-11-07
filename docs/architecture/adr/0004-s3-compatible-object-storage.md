# 0004. S3-compatible object storage (MinIO locally)

- **Status:** Accepted, implemented (Wave 4, STORAGE lane)
- **Date:** 2026-11-07 (owner decision)

## Context

Several features need durable blobs: doc and message attachments, avatars,
backup snapshots, the audit archive and trained model artefacts. Today
snapshots and the audit file are written to the local disk
(`BACKUP_DIR`, `AUDIT_LOG_FILE`), and the code itself says local file modes do
not stop a root-level attacker (`Backend/resilience/backups.ts`,
`Backend/audit/auditLog.ts`). Streaming large uploads through a framework-less
API that caps JSON bodies at 256 KB (`MAX_BODY_BYTES`) is a poor fit.

## Decision

Use the S3 API, with MinIO in local and Compose environments and any
S3-compatible service in production.

- Four buckets: `S3_BUCKET_UPLOADS`, `S3_BUCKET_BACKUPS`, `S3_BUCKET_AUDIT`,
  `S3_BUCKET_MODELS`; MinIO in Compose, any S3-compatible service (AWS S3,
  Cloudflare R2) in production. Bucket set-up, object lock and least-privilege
  service users: `infra/minio/bootstrap.sh` and
  [infra/minio/README.md](../../../infra/minio/README.md).
- Uploads use presigned URLs: `POST /api/files/uploads` → browser `PUT` →
  `POST /api/files/:fileId/complete` (size, type and magic-byte checks) →
  short-lived presigned `GET` (`Backend/routes/files.routes.ts`).
- Backups and the audit archive go to buckets with Object Lock
  (`COMPLIANCE` in production).
- The S3 client is our own SigV4 signer (`Backend/storage/sigv4.ts`), keeping
  the backend free of runtime dependencies; without `S3_ENDPOINT` a local
  driver is used.

## Consequences

- File bytes never pass through the API process: the browser uploads directly
  to storage with a presigned URL, and the API only issues and verifies.
  The JSON body limit stays small.
- A presigned URL is a bearer credential for its lifetime; expiries must be
  short and `complete` must verify what was actually uploaded before a file is
  referenced anywhere.
- Object lock gives backups and the audit trail a retention guarantee the
  local filesystem cannot.
- One more service to run locally (MinIO, internal network, console only in
  the Compose dev profile). Bucket encryption (`sse-s3`) needs a KMS key on
  the MinIO server in production.

## References

- `Backend/resilience/backups.ts`, `Backend/audit/auditLog.ts`
- `docs/agents/WAVE4.md` §4–§6
