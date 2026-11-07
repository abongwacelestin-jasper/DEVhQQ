/**
 * Local object-store driver — used when S3_ENDPOINT is unset (smoke tests,
 * quick start without MinIO). Disk-backed under STORAGE_LOCAL_DIR.
 *
 * It mirrors the S3 semantics the app depends on, so the same code paths are
 * exercised without MinIO:
 *  - presigned PUT/GET URLs served by a loopback-only HTTP listener (started
 *    lazily, unref'd), HMAC-signed with an expiry and with Content-Type and
 *    Content-Length pinned exactly like a SigV4 presigned PUT,
 *  - range reads, metadata, ETag (MD5), prefix listing with continuation,
 *  - Object Lock emulation: a per-bucket default retention makes objects
 *    immutable (no overwrite, no delete) until their retain-until date.
 *
 * Objects live at `<root>/<bucket>/<sha256(key)>` with a `.meta.json` sidecar,
 * so arbitrary keys never become arbitrary paths.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { uriEncode } from './sigv4.ts';
import {
  StorageError,
  assertSafeKey,
  type LockMode,
  type ObjectHead,
  type ObjectStore,
  type PresignedRequest,
} from './types.ts';

interface Meta {
  key: string;
  size: number;
  contentType: string;
  etag: string;
  lastModified: string;
  metadata: Record<string, string>;
  versionId: string;
  lock?: { mode: LockMode; retainUntil: string };
}

export interface LocalStoreOptions {
  root: string;
  /** Secret the presign HMAC key is derived from (the session secret). */
  secret: string;
  /** Default Object Lock retention per bucket (emulates the bucket config). */
  defaultRetention?: Record<string, { mode: LockMode; days: number }>;
  /** Origins allowed to PUT/GET from a browser (CORS). */
  allowedOrigins?: string[];
}

export function createLocalStore(opts: LocalStoreOptions): ObjectStore {
  const signKey = createHmac('sha256', opts.secret).update('devhq-local-object-store').digest();
  const bucketDir = (bucket: string) => {
    if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket))
      throw new StorageError(400, 'InvalidBucketName', 'Invalid bucket name');
    return join(opts.root, bucket);
  };
  const fileOf = (bucket: string, key: string) =>
    join(bucketDir(bucket), createHash('sha256').update(key).digest('hex'));

  async function readMeta(bucket: string, key: string): Promise<Meta | null> {
    try {
      return JSON.parse(await readFile(fileOf(bucket, key) + '.meta.json', 'utf8')) as Meta;
    } catch {
      return null;
    }
  }

  function assertUnlocked(meta: Meta | null) {
    if (meta?.lock && new Date(meta.lock.retainUntil).getTime() > Date.now())
      throw new StorageError(
        403,
        'AccessDenied',
        `Object is WORM-protected (${meta.lock.mode}) until ${meta.lock.retainUntil}`,
      );
  }

  async function put(
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType: string,
    metadata: Record<string, string>,
    retention?: { mode: LockMode; retainUntil: Date },
  ) {
    assertSafeKey(key);
    const dir = bucketDir(bucket);
    await mkdir(dir, { recursive: true });
    assertUnlocked(await readMeta(bucket, key));
    const def = opts.defaultRetention?.[bucket];
    const lockUntil =
      retention?.retainUntil ?? (def ? new Date(Date.now() + def.days * 86_400_000) : undefined);
    const meta: Meta = {
      key,
      size: body.length,
      contentType,
      etag: `"${createHash('md5').update(body).digest('hex')}"`,
      lastModified: new Date().toISOString(),
      metadata,
      versionId: randomBytes(8).toString('hex'),
      lock:
        lockUntil && (retention?.mode ?? def?.mode)
          ? {
              mode: (retention?.mode ?? def?.mode) as LockMode,
              retainUntil: lockUntil.toISOString(),
            }
          : undefined,
    };
    const file = fileOf(bucket, key);
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, file);
    await writeFile(file + '.meta.json', JSON.stringify(meta));
    return meta;
  }

  // ---- presign listener -----------------------------------------------------

  let base: Promise<string> | undefined;

  function sign(fields: string[]): string {
    return createHmac('sha256', signKey).update(JSON.stringify(fields)).digest('base64url');
  }

  function fieldsOf(method: string, bucket: string, key: string, q: URLSearchParams): string[] {
    return [
      method,
      bucket,
      key,
      q.get('exp') ?? '',
      q.get('ct') ?? '',
      q.get('len') ?? '',
      q.get('rcd') ?? '',
      q.get('rct') ?? '',
    ];
  }

  function cors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    if (origin && opts.allowedOrigins?.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Expose-Headers', 'ETag');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }

  function fail(res: ServerResponse, status: number, code: string) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/xml');
    res.end(`<?xml version="1.0"?><Error><Code>${code}</Code></Error>`);
  }

  async function serve(req: IncomingMessage, res: ServerResponse) {
    cors(req, res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    const url = new URL(req.url ?? '/', 'http://local');
    const [, bucket, ...rest] = url.pathname.split('/');
    const key = rest.map((s) => decodeURIComponent(s)).join('/');
    const q = url.searchParams;
    const method = req.method === 'HEAD' ? 'GET' : (req.method ?? '');
    const sig = Buffer.from(q.get('sig') ?? '');
    const want = Buffer.from(sign(fieldsOf(method, bucket ?? '', key, q)));
    if (sig.length !== want.length || !timingSafeEqual(sig, want))
      return fail(res, 403, 'SignatureDoesNotMatch');
    if (Number(q.get('exp')) < Date.now()) return fail(res, 403, 'AccessDenied');

    if (method === 'PUT') {
      const expectedLen = Number(q.get('len'));
      if ((req.headers['content-type'] ?? '') !== q.get('ct'))
        return fail(res, 403, 'SignatureDoesNotMatch');
      if (Number(req.headers['content-length'] ?? -1) !== expectedLen)
        return fail(res, 403, 'SignatureDoesNotMatch');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > expectedLen) return fail(res, 400, 'IncompleteBody');
        chunks.push(c as Buffer);
      }
      if (size !== expectedLen) return fail(res, 400, 'IncompleteBody');
      try {
        const meta = await put(bucket, key, Buffer.concat(chunks), q.get('ct') ?? '', {});
        res.setHeader('ETag', meta.etag);
        res.statusCode = 200;
        return res.end();
      } catch (e) {
        const err = e instanceof StorageError ? e : new StorageError(500, 'InternalError', '');
        return fail(res, err.status, err.code);
      }
    }
    if (method === 'GET') {
      const meta = await readMeta(bucket, key);
      if (!meta) return fail(res, 404, 'NoSuchKey');
      const body = await readFile(fileOf(bucket, key));
      res.statusCode = 200;
      res.setHeader('Content-Type', q.get('rct') || meta.contentType);
      if (q.get('rcd')) res.setHeader('Content-Disposition', q.get('rcd') ?? '');
      res.setHeader('Content-Length', body.length);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.setHeader('ETag', meta.etag);
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    return fail(res, 405, 'MethodNotAllowed');
  }

  function listener(): Promise<string> {
    base ??= new Promise((resolve, reject) => {
      const srv = createServer((req, res) => {
        serve(req, res).catch(() => fail(res, 500, 'InternalError'));
      });
      srv.headersTimeout = 10_000;
      srv.requestTimeout = 60_000;
      srv.once('error', reject);
      // Loopback only: this listener exists for dev and tests, never for the network.
      srv.listen(Number(process.env.STORAGE_LOCAL_PORT ?? 0), '127.0.0.1', () => {
        srv.unref();
        resolve(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`);
      });
    });
    return base;
  }

  async function presign(
    method: 'PUT' | 'GET',
    bucket: string,
    key: string,
    expiresIn: number,
    extra: Record<string, string>,
  ): Promise<string> {
    assertSafeKey(key);
    bucketDir(bucket);
    const q = new URLSearchParams({ exp: String(Date.now() + expiresIn * 1000), ...extra });
    q.set('sig', sign(fieldsOf(method, bucket, key, q)));
    return `${await listener()}/${bucket}/${uriEncode(key, false)}?${q.toString()}`;
  }

  const store: ObjectStore = {
    kind: 'local',

    async putObject(bucket, key, body, o = {}) {
      const meta = await put(
        bucket,
        key,
        body,
        o.contentType ?? 'application/octet-stream',
        o.metadata ?? {},
        o.retention,
      );
      return { etag: meta.etag, versionId: meta.versionId };
    },

    async getObject(bucket, key, o = {}) {
      assertSafeKey(key);
      const meta = await readMeta(bucket, key);
      if (!meta) return null;
      let body = await readFile(fileOf(bucket, key));
      if (o.range) body = body.subarray(o.range[0], o.range[1] + 1);
      return { body, head: { ...meta } };
    },

    async headObject(bucket, key): Promise<ObjectHead | null> {
      assertSafeKey(key);
      return readMeta(bucket, key);
    },

    async deleteObject(bucket, key) {
      assertSafeKey(key);
      const meta = await readMeta(bucket, key);
      if (!meta) return;
      assertUnlocked(meta);
      await unlink(fileOf(bucket, key)).catch(() => undefined);
      await unlink(fileOf(bucket, key) + '.meta.json').catch(() => undefined);
    },

    async copyObject(bucket, fromKey, toKey) {
      const src = await store.getObject(bucket, fromKey);
      if (!src) throw new StorageError(404, 'NoSuchKey', 'Copy source not found');
      await put(bucket, toKey, src.body, src.head.contentType, src.head.metadata);
    },

    async presignPut(bucket, key, o): Promise<PresignedRequest> {
      const url = await presign('PUT', bucket, key, o.expiresIn, {
        ct: o.contentType,
        len: String(o.contentLength),
      });
      return { url, method: 'PUT', headers: { 'Content-Type': o.contentType } };
    },

    async presignGet(bucket, key, o): Promise<PresignedRequest> {
      const extra: Record<string, string> = {};
      if (o.responseContentDisposition) extra.rcd = o.responseContentDisposition;
      if (o.responseContentType) extra.rct = o.responseContentType;
      return {
        url: await presign('GET', bucket, key, o.expiresIn, extra),
        method: 'GET',
        headers: {},
      };
    },

    async listObjects(bucket, o = {}) {
      const dir = bucketDir(bucket);
      const names = (await readdir(dir).catch(() => [] as string[])).filter((n) =>
        n.endsWith('.meta.json'),
      );
      const metas: Meta[] = [];
      for (const n of names) {
        try {
          const m = JSON.parse(await readFile(join(dir, n), 'utf8')) as Meta;
          if (!o.prefix || m.key.startsWith(o.prefix)) metas.push(m);
        } catch {
          /* half-written sidecar — skip */
        }
      }
      metas.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const after = o.continuationToken
        ? Buffer.from(o.continuationToken, 'base64url').toString('utf8')
        : '';
      const page = metas.filter((m) => m.key > after).slice(0, Math.min(1000, o.maxKeys ?? 1000));
      const last = page.at(-1);
      const more = last ? metas.some((m) => m.key > last.key) : false;
      return {
        items: page.map((m) => ({
          key: m.key,
          size: m.size,
          etag: m.etag,
          lastModified: m.lastModified,
        })),
        nextToken: more && last ? Buffer.from(last.key).toString('base64url') : undefined,
      };
    },
  };
  return store;
}
