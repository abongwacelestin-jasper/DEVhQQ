/**
 * Files API — presigned uploads to object storage (WAVE4 §6 STORAGE).
 *
 * Flow:
 *   1. POST /api/files/uploads   → validates purpose, type and size against an
 *      allow-list and the caller's access to the referenced resource, then
 *      returns a presigned PUT (Content-Type and Content-Length are signed).
 *      The object lands under `pending/` — a bucket lifecycle rule expires it
 *      if the upload is abandoned.
 *   2. Browser PUTs the bytes straight to storage (the API never proxies them).
 *   3. POST /api/files/:id/complete → HEAD (exists, exact size), magic-byte
 *      sniff of the first bytes, malware-scan hook, then copy to `files/` and
 *      mark ready. Any mismatch deletes the object and rejects the upload.
 *   4. GET /api/files/:id → 60 s presigned GET. Only raster images render
 *      inline; everything else is `Content-Disposition: attachment`, and the
 *      stored (verified) type is forced via response-content-type.
 *
 * Authorization is always by the referenced resource (storage/refs.ts):
 * out-of-scope → 404. Every state change is audited; metadata is a persisted
 * collection (`files`).
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { can } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { randomToken } from '../security/crypto.ts';
import { createCollection } from '../store/collection.ts';
import { logger } from '../lib/logger.ts';
import {
  HttpError,
  type PermissionArea,
  type PermissionLevel,
  type Principal,
  type ProductId,
} from '../types.ts';
import { buckets, objectStore, StorageError, uploadsAvailable } from '../storage/index.ts';
import { matchesMagic, SNIFF_BYTES } from '../storage/magic.ts';
import { malwareScanner, type ScanVerdict } from '../storage/scanner.ts';
import { resolveRef, type RefKind } from '../storage/refs.ts';
import { installAuditArchive } from '../storage/auditArchive.ts';
import { registerBackupTable } from '../resilience/sources.ts';

// ---- policy -----------------------------------------------------------------

export const PURPOSES = ['doc-attachment', 'avatar', 'message-attachment'] as const;
export type Purpose = (typeof PURPOSES)[number];

const MB = 1024 * 1024;
const RASTER = ['image/png', 'image/jpeg', 'image/webp'];
const ATTACHMENT_TYPES = [
  ...RASTER,
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
/** Types a browser may render inline. Never HTML, SVG, XML or anything scriptable. */
const INLINE_TYPES = new Set([...RASTER, 'image/gif']);
/** Belt and braces: refused even if someone widens an allow-list by mistake. */
const NEVER = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
]);

interface Policy {
  types: string[];
  maxBytes: number;
  ref: RefKind;
  /** Role level required to attach (checked before the reference, like other writes). */
  needs?: [PermissionArea, PermissionLevel];
}

export const POLICIES: Record<Purpose, Policy> = {
  avatar: { types: RASTER, maxBytes: 2 * MB, ref: 'member' },
  'doc-attachment': {
    types: ATTACHMENT_TYPES,
    maxBytes: 25 * MB,
    ref: 'doc',
    needs: ['Project', 'contribute'],
  },
  'message-attachment': {
    types: ATTACHMENT_TYPES,
    maxBytes: 25 * MB,
    ref: 'channel',
    needs: ['Project', 'view'],
  },
};

const UPLOAD_TTL_S = 10 * 60;
const DOWNLOAD_TTL_S = 60;
const MAX_PENDING_PER_MEMBER = 20;

// ---- model ------------------------------------------------------------------

export interface StoredFile {
  id: string;
  purpose: Purpose;
  refKind: RefKind;
  refId: string;
  product: ProductId | null;
  name: string;
  contentType: string;
  size: number;
  bucket: string;
  /** Final key once ready; the pending key before that. */
  key: string;
  status: 'pending' | 'ready' | 'rejected';
  rejectReason?: string;
  scan?: { engine: string; verdict: ScanVerdict; signature?: string; at: string };
  etag?: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
}

export const files = createCollection<StoredFile>('files');
registerBackupTable('files', files);

const uploadBody = v.object({
  purpose: v.enumOf(PURPOSES),
  contentType: v.string({ max: 120, pattern: /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/ }),
  size: v.int({ min: 1, max: 25 * MB }),
  name: v.string({ min: 1, max: 255 }),
  refId: v.string({ min: 1, max: 80, pattern: /^[A-Za-z0-9_.:-]+$/ }),
});

/** Display name only — never used as a key. Strips paths and control characters. */
function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // Removing control characters is the point of this pattern.
  // eslint-disable-next-line no-control-regex
  const stripped = base.replace(/[\u0000-\u001f\u007f"<>]/g, '');
  const clean = stripped.trim().slice(0, 180);
  return clean || 'file';
}

function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function publicView(f: StoredFile) {
  return {
    id: f.id,
    purpose: f.purpose,
    refId: f.refId,
    name: f.name,
    contentType: f.contentType,
    size: f.size,
    status: f.status,
    scan: f.scan ? { engine: f.scan.engine, verdict: f.scan.verdict } : undefined,
    createdBy: f.createdBy,
    createdAt: f.createdAt,
    completedAt: f.completedAt,
  };
}

/** The file as the caller may see it, or 404. Re-checks the reference every time. */
function visibleFile(p: Principal, id: string): StoredFile {
  const f = files.get(id);
  if (!f) throw new HttpError(404, 'not_found', 'Not found');
  if (f.status !== 'ready' && f.createdBy !== p.memberId)
    throw new HttpError(404, 'not_found', 'Not found');
  if (!resolveRef(f.refKind, p, f.refId)) throw new HttpError(404, 'not_found', 'Not found');
  return f;
}

function storageFailure(e: unknown): never {
  if (e instanceof HttpError) throw e;
  if (e instanceof StorageError) {
    logger.error('storage error', { code: e.code, status: e.status, message: e.message });
    throw new HttpError(
      e.code === 'StorageUnavailable' ? 503 : 502,
      e.code === 'StorageUnavailable' ? 'storage_unavailable' : 'storage_error',
      'Object storage request failed',
    );
  }
  throw e;
}

function requireStorage() {
  if (!uploadsAvailable())
    throw new HttpError(503, 'integration_unconfigured', 'Object storage is not configured');
}

async function reject(f: StoredFile, reason: string, actor: string, requestId: string) {
  await objectStore()
    .deleteObject(f.bucket, f.key)
    .catch(() => undefined);
  f.status = 'rejected';
  f.rejectReason = reason;
  files.save(f.id);
  audit.append({
    actor,
    action: 'file.rejected',
    target: `${f.id} · ${f.purpose} · ${reason}`,
    sensitive: reason === 'malware_detected',
    requestId,
  });
}

/** Removes abandoned pending uploads and old rejected rows. */
export async function sweepFiles(now = Date.now()): Promise<number> {
  let removed = 0;
  for (const f of [...files.values()]) {
    const expired = f.status === 'pending' && new Date(f.expiresAt).getTime() + 60_000 < now;
    const staleReject =
      f.status === 'rejected' && new Date(f.createdAt).getTime() + 86_400_000 < now;
    if (!expired && !staleReject) continue;
    if (expired)
      await objectStore()
        .deleteObject(f.bucket, f.key)
        .catch(() => undefined); // lifecycle on pending/ is the backstop
    files.delete(f.id);
    removed++;
  }
  if (removed)
    audit.append({
      actor: 'system',
      action: 'file.swept',
      target: `${removed} abandoned upload(s)`,
    });
  return removed;
}

// ---- routes -----------------------------------------------------------------

export function registerFileRoutes(r: Router) {
  installAuditArchive();
  setInterval(
    () => void sweepFiles().catch((e) => logger.error('file sweep failed', { err: String(e) })),
    10 * 60_000,
  ).unref();

  r.add(
    'POST',
    '/api/files/uploads',
    {
      summary: 'Request a presigned upload (purpose-based type/size allow-list)',
      tag: 'files',
      responses: [401, 403, 404, 413, 415, 422, 429, 503],
    },
    authenticate,
    async (ctx) => {
      requireStorage();
      const p = ctx.principal!;
      const body = parse(uploadBody, ctx.body);
      const policy = POLICIES[body.purpose];
      if (NEVER.has(body.contentType) || !policy.types.includes(body.contentType))
        throw new HttpError(
          415,
          'unsupported_media_type',
          `${body.contentType} is not allowed for ${body.purpose}`,
          {
            allowed: policy.types,
          },
        );
      if (body.size > policy.maxBytes)
        throw new HttpError(
          413,
          'payload_too_large',
          `${body.purpose} uploads are limited to ${policy.maxBytes} bytes`,
          {
            maxBytes: policy.maxBytes,
          },
        );
      if (policy.needs && !can(p, policy.needs[0], policy.needs[1]))
        throw new HttpError(403, 'forbidden', `Requires ${policy.needs[1]} on ${policy.needs[0]}`);
      if (
        body.purpose === 'avatar' &&
        body.refId !== p.memberId &&
        !can(p, 'Administration', 'manage')
      )
        throw new HttpError(404, 'not_found', 'Not found');
      const ref = resolveRef(policy.ref, p, body.refId);
      if (!ref) throw new HttpError(404, 'not_found', 'Not found');

      const pending = [...files.values()].filter(
        (f) => f.createdBy === p.memberId && f.status === 'pending',
      ).length;
      if (pending >= MAX_PENDING_PER_MEMBER)
        throw new HttpError(
          429,
          'too_many_pending_uploads',
          'Finish or cancel pending uploads first',
        );

      const id = `file-${randomToken(12)}`;
      const now = Date.now();
      const f: StoredFile = {
        id,
        purpose: body.purpose,
        refKind: policy.ref,
        refId: body.refId,
        product: ref.product,
        name: safeName(body.name),
        contentType: body.contentType,
        size: body.size,
        bucket: buckets.uploads,
        key: `pending/${id}`,
        status: 'pending',
        createdBy: p.memberId,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + UPLOAD_TTL_S * 1000).toISOString(),
      };
      const signed = await objectStore()
        .presignPut(f.bucket, f.key, {
          contentType: f.contentType,
          contentLength: f.size,
          expiresIn: UPLOAD_TTL_S,
        })
        .catch(storageFailure);
      files.set(id, f);
      audit.append({
        actor: p.memberId,
        action: 'file.upload_requested',
        target: `${id} · ${f.purpose} · ${f.refKind}:${f.refId} · ${f.contentType} · ${f.size} bytes`,
        requestId: ctx.requestId,
      });
      ctx.status = 201;
      return {
        fileId: id,
        uploadUrl: signed.url,
        method: signed.method,
        headers: signed.headers,
        expiresAt: f.expiresAt,
      };
    },
  );

  r.add(
    'POST',
    '/api/files/:fileId/complete',
    {
      summary: 'Verify an uploaded object (exists, size, magic bytes, scan) and mark it ready',
      tag: 'files',
      responses: [401, 404, 409, 410, 422, 503],
    },
    authenticate,
    async (ctx) => {
      requireStorage();
      const p = ctx.principal!;
      const f = files.get(ctx.params.fileId);
      if (!f || f.createdBy !== p.memberId || !resolveRef(f.refKind, p, f.refId))
        throw new HttpError(404, 'not_found', 'Not found');
      if (f.status === 'ready') return publicView(f);
      if (f.status === 'rejected')
        throw new HttpError(409, 'upload_rejected', `Upload was rejected: ${f.rejectReason}`);
      const store = objectStore();
      if (new Date(f.expiresAt).getTime() < Date.now()) {
        await reject(f, 'expired', p.memberId, ctx.requestId);
        throw new HttpError(
          410,
          'upload_expired',
          'The upload window has closed; request a new one',
        );
      }

      try {
        const head = await store.headObject(f.bucket, f.key);
        if (!head) throw new HttpError(409, 'upload_missing', 'No object has been uploaded yet');
        if (head.size !== f.size) {
          await reject(f, 'size_mismatch', p.memberId, ctx.requestId);
          throw new HttpError(422, 'size_mismatch', 'Uploaded size does not match the request');
        }
        const start = await store.getObject(f.bucket, f.key, {
          range: [0, Math.min(SNIFF_BYTES, f.size) - 1],
        });
        if (!start || !matchesMagic(f.contentType, start.body)) {
          await reject(f, 'type_mismatch', p.memberId, ctx.requestId);
          throw new HttpError(
            422,
            'type_mismatch',
            'File content does not match its declared type',
          );
        }

        const scanner = malwareScanner();
        const result = await scanner.scan({
          bucket: f.bucket,
          key: f.key,
          size: f.size,
          contentType: f.contentType,
          read: async () => (await store.getObject(f.bucket, f.key))?.body ?? Buffer.alloc(0),
        });
        f.scan = {
          engine: scanner.name,
          verdict: result.verdict,
          signature: result.signature,
          at: new Date().toISOString(),
        };
        if (result.verdict === 'infected') {
          await reject(f, 'malware_detected', p.memberId, ctx.requestId);
          throw new HttpError(422, 'malware_detected', 'The file failed a malware scan');
        }
        if (result.verdict === 'error') {
          files.save(f.id);
          throw new HttpError(
            503,
            'scan_unavailable',
            'Malware scanning is unavailable; try again shortly',
          );
        }

        const finalKey = `files/${f.purpose}/${f.product ?? 'members'}/${f.id}`;
        await store.copyObject(f.bucket, f.key, finalKey);
        await store.deleteObject(f.bucket, f.key);
        const done = await store.headObject(f.bucket, finalKey);
        f.key = finalKey;
        f.etag = done?.etag;
        f.status = 'ready';
        f.completedAt = new Date().toISOString();
        files.save(f.id);
      } catch (e) {
        storageFailure(e);
      }
      audit.append({
        actor: p.memberId,
        action: 'file.uploaded',
        target: `${f.id} · ${f.purpose} · ${f.refKind}:${f.refId} · ${f.size} bytes · scan ${f.scan?.verdict}`,
        requestId: ctx.requestId,
      });
      return publicView(f);
    },
  );

  r.add(
    'GET',
    '/api/files',
    {
      summary: 'Ready files attached to a resource (refId, purpose)',
      tag: 'files',
      responses: [401, 404, 422],
    },
    authenticate,
    (ctx) => {
      const p = ctx.principal!;
      const purpose = parse(v.enumOf(PURPOSES), ctx.query.get('purpose') ?? 'doc-attachment');
      const refId = parse(v.string({ min: 1, max: 80 }), ctx.query.get('refId') ?? '');
      if (!resolveRef(POLICIES[purpose].ref, p, refId))
        throw new HttpError(404, 'not_found', 'Not found');
      return {
        items: [...files.values()]
          .filter((f) => f.purpose === purpose && f.refId === refId && f.status === 'ready')
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .map(publicView),
      };
    },
  );

  r.add(
    'GET',
    '/api/files/:fileId',
    { summary: 'Short-lived presigned download URL', tag: 'files', responses: [401, 404, 503] },
    authenticate,
    async (ctx) => {
      requireStorage();
      const p = ctx.principal!;
      const f = visibleFile(p, ctx.params.fileId);
      if (f.status !== 'ready') throw new HttpError(404, 'not_found', 'Not found');
      const disposition = INLINE_TYPES.has(f.contentType) ? 'inline' : 'attachment';
      const signed = await objectStore()
        .presignGet(f.bucket, f.key, {
          expiresIn: DOWNLOAD_TTL_S,
          responseContentDisposition: contentDisposition(disposition, f.name),
          responseContentType: f.contentType,
        })
        .catch(storageFailure);
      audit.append({
        actor: p.memberId,
        action: 'file.download_issued',
        target: `${f.id} · ${f.refKind}:${f.refId}`,
        requestId: ctx.requestId,
      });
      return {
        ...publicView(f),
        url: signed.url,
        disposition,
        expiresAt: new Date(Date.now() + DOWNLOAD_TTL_S * 1000).toISOString(),
      };
    },
  );

  r.add(
    'DELETE',
    '/api/files/:fileId',
    {
      summary: 'Delete a file (uploader, or manager of the resource)',
      tag: 'files',
      responses: [401, 403, 404, 503],
    },
    authenticate,
    async (ctx) => {
      requireStorage();
      const p = ctx.principal!;
      const f = visibleFile(p, ctx.params.fileId);
      const mayManage =
        f.purpose === 'avatar' ? can(p, 'Administration', 'manage') : can(p, 'Project', 'manage');
      if (f.createdBy !== p.memberId && !mayManage)
        throw new HttpError(
          403,
          'forbidden',
          'Only the uploader or a manager can delete this file',
        );
      await objectStore().deleteObject(f.bucket, f.key).catch(storageFailure);
      files.delete(f.id);
      audit.append({
        actor: p.memberId,
        action: f.status === 'pending' ? 'file.upload_cancelled' : 'file.deleted',
        target: `${f.id} · ${f.name} · ${f.refKind}:${f.refId}`,
        sensitive: f.status === 'ready',
        requestId: ctx.requestId,
      });
    },
  );
}
