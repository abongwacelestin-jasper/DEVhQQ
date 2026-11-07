# 0004. S3-compatible object storage (MinIO locally)

- **Status:** Accepted, planned for Wave 4 (STORAGE lane)
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

> [!NOTE]
> **Planned: Wave 4 (STORAGE).** Contract from `docs/agents/WAVE4.md` §6:
>
> - `POST /api/files/uploads` `{purpose, contentType, size, name, refId}` →
>   `{fileId, uploadUrl, headers, expiresAt}`: a presigned `PUT` with a size
>   and content-type allow-list. `purpose` is one of `doc-attachment`,
>   `avatar`, `message-attachment`.
> - `POST /api/files/:fileId/complete` verifies the object exists and checks
>   size, type and magic bytes; `GET /api/files/:fileId` returns a short-lived
>   presigned `GET`; `DELETE /api/files/:fileId`.
> - Buckets: `S3_BUCKET_UPLOADS`, `S3_BUCKET_BACKUPS`, `S3_BUCKET_AUDIT`,
>   `S3_BUCKET_MODELS`; connection via `S3_ENDPOINT`, `S3_REGION`,
>   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`.
> - Backups and the audit archive ship to their buckets with object lock
>   (WORM) in production.
> - Code lives in `Backend/storage/`, `Backend/routes/files.routes.ts` and
>   `infra/minio/`.

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
  the Compose dev profile). Without the `S3_*` variables, file endpoints must
  answer `503 integration_unconfigured` rather than crash.

## References

- `Backend/resilience/backups.ts`, `Backend/audit/auditLog.ts`
- `docs/agents/WAVE4.md` §4–§6
