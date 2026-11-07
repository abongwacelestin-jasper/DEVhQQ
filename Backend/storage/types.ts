/**
 * Object storage abstraction. Two drivers implement it:
 *  - `s3`    — any S3-compatible API (MinIO, AWS S3, Cloudflare R2) via the
 *              in-house SigV4 signer (storage/sigv4.ts),
 *  - `local` — a disk-backed driver with a loopback presign server, used when
 *              S3_ENDPOINT is unset (smoke tests, quick start). Never in production
 *              for uploads.
 */

export type LockMode = 'GOVERNANCE' | 'COMPLIANCE';

export interface PutOptions {
  contentType?: string;
  /** User metadata (sent as x-amz-meta-*; keys lowercase ASCII). */
  metadata?: Record<string, string>;
  /**
   * Per-object retention. Optional: the backups/audit buckets also carry a
   * default retention set by infra/minio/bootstrap.sh, which is what we rely
   * on in production (the backend credential lacks s3:PutObjectRetention).
   */
  retention?: { mode: LockMode; retainUntil: Date };
}

export interface ObjectHead {
  key: string;
  size: number;
  contentType: string;
  etag: string;
  lastModified: string;
  metadata: Record<string, string>;
  versionId?: string;
  lock?: { mode: LockMode; retainUntil: string };
}

export interface ObjectSummary {
  key: string;
  size: number;
  etag: string;
  lastModified: string;
}

export interface PresignPutOptions {
  contentType: string;
  /** Exact byte length; signed, so the PUT fails if the client sends anything else. */
  contentLength: number;
  expiresIn: number;
}

export interface PresignGetOptions {
  expiresIn: number;
  responseContentDisposition?: string;
  responseContentType?: string;
}

export interface PresignedRequest {
  url: string;
  method: 'PUT' | 'GET';
  /** Headers the client must send verbatim (they are part of the signature). */
  headers: Record<string, string>;
}

export interface ObjectStore {
  readonly kind: 's3' | 'local';
  putObject(
    bucket: string,
    key: string,
    body: Uint8Array,
    opts?: PutOptions,
  ): Promise<{ etag: string; versionId?: string }>;
  /** `range` is inclusive, like the HTTP Range header. Resolves null when missing. */
  getObject(
    bucket: string,
    key: string,
    opts?: { range?: [number, number] },
  ): Promise<{ body: Buffer; head: ObjectHead } | null>;
  headObject(bucket: string, key: string): Promise<ObjectHead | null>;
  deleteObject(bucket: string, key: string): Promise<void>;
  copyObject(bucket: string, fromKey: string, toKey: string): Promise<void>;
  presignPut(bucket: string, key: string, opts: PresignPutOptions): Promise<PresignedRequest>;
  presignGet(bucket: string, key: string, opts: PresignGetOptions): Promise<PresignedRequest>;
  listObjects(
    bucket: string,
    opts?: { prefix?: string; continuationToken?: string; maxKeys?: number },
  ): Promise<{ items: ObjectSummary[]; nextToken?: string }>;
}

/** Storage-layer failure. `code` is the S3 error code (or a local equivalent). */
export class StorageError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
    this.code = code;
  }
}

/** Rejects keys that could escape a prefix or confuse signing. */
export function assertSafeKey(key: string) {
  if (
    !key ||
    key.length > 900 ||
    key.startsWith('/') ||
    key.split('/').some((s) => s === '..' || s === '.' || s === '') ||
    // Control characters have no place in object keys.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f\\]/.test(key)
  )
    throw new StorageError(400, 'InvalidKey', 'Invalid object key');
}
