/**
 * S3-compatible driver (MinIO locally, AWS S3 / Cloudflare R2 in production)
 * built on `fetch` + the in-house SigV4 signer.
 *
 * - Every request body is hashed into x-amz-content-sha256 (no unsigned
 *   payloads on server-side calls) and PUTs carry Content-MD5, which S3
 *   requires for buckets with Object Lock.
 * - Presigned URLs are signed against S3_PUBLIC_ENDPOINT (the browser-reachable
 *   host); server-side calls go to S3_ENDPOINT. Both must resolve to the same
 *   storage — the host is part of the signature.
 * - Requests time out (30 s) so a hung storage backend can't pin handlers.
 */

import { createHash } from 'node:crypto';
import type { StorageConfig } from '../config/env.ts';
import { presignUrl, sha256Hex, signRequest, uriEncode, type Credentials } from './sigv4.ts';
import {
  StorageError,
  assertSafeKey,
  type LockMode,
  type ObjectHead,
  type ObjectStore,
  type ObjectSummary,
  type PresignedRequest,
} from './types.ts';

const TIMEOUT_MS = 30_000;

function xmlDecode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? xmlDecode(m[1]) : undefined;
}

function headFrom(key: string, res: Response): ObjectHead {
  const metadata: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    if (name.startsWith('x-amz-meta-')) metadata[name.slice(11)] = value;
  });
  const mode = res.headers.get('x-amz-object-lock-mode');
  const until = res.headers.get('x-amz-object-lock-retain-until-date');
  const range = res.headers.get('content-range'); // bytes 0-15/12345
  const total = range?.match(/\/(\d+)$/)?.[1];
  return {
    key,
    size: Number(total ?? res.headers.get('content-length') ?? 0),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    etag: res.headers.get('etag') ?? '',
    lastModified: new Date(res.headers.get('last-modified') ?? Date.now()).toISOString(),
    metadata,
    versionId: res.headers.get('x-amz-version-id') ?? undefined,
    lock:
      (mode === 'GOVERNANCE' || mode === 'COMPLIANCE') && until
        ? { mode: mode as LockMode, retainUntil: until }
        : undefined,
  };
}

export function createS3Store(cfg: StorageConfig): ObjectStore {
  if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey)
    throw new Error('S3 driver needs S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  const credentials: Credentials = {
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
  };
  const internal = cfg.endpoint;
  const publicBase = cfg.publicEndpoint ?? cfg.endpoint;

  function objectUrl(base: string, bucket: string, key?: string): URL {
    const u = new URL(base);
    const path = key ? '/' + uriEncode(key, false) : '/';
    if (cfg.forcePathStyle) {
      u.pathname = `${u.pathname.replace(/\/$/, '')}/${bucket}${path}`;
    } else {
      u.hostname = `${bucket}.${u.hostname}`;
      u.pathname = `${u.pathname.replace(/\/$/, '')}${path}`;
    }
    return u;
  }

  async function request(
    method: string,
    url: URL,
    opts: { headers?: Record<string, string>; body?: Uint8Array; okStatuses?: number[] } = {},
  ): Promise<Response> {
    const body = opts.body;
    const payloadHash = sha256Hex(body ?? new Uint8Array());
    const signed = signRequest({
      method,
      url,
      headers: { ...(opts.headers ?? {}), 'x-amz-content-sha256': payloadHash },
      payloadHash,
      region: cfg.region,
      service: 's3',
      credentials,
      date: new Date(),
    });
    // fetch derives Host from the URL; sending it explicitly is forbidden.
    const { host: _host, ...headers } = signed.headers;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body && body.length ? body : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (e) {
      throw new StorageError(503, 'StorageUnavailable', `Object storage unreachable: ${String(e)}`);
    }
    if (res.ok || opts.okStatuses?.includes(res.status)) return res;
    const text = method === 'HEAD' ? '' : await res.text().catch(() => '');
    throw new StorageError(
      res.status,
      tag(text, 'Code') ?? `Http${res.status}`,
      tag(text, 'Message') ?? `${method} ${url.pathname} → ${res.status}`,
    );
  }

  return {
    kind: 's3',

    async putObject(bucket, key, body, opts = {}) {
      assertSafeKey(key);
      const headers: Record<string, string> = {
        'content-type': opts.contentType ?? 'application/octet-stream',
        'content-md5': createHash('md5').update(body).digest('base64'),
      };
      for (const [k, v] of Object.entries(opts.metadata ?? {}))
        headers[`x-amz-meta-${k.toLowerCase()}`] = v;
      if (opts.retention) {
        headers['x-amz-object-lock-mode'] = opts.retention.mode;
        headers['x-amz-object-lock-retain-until-date'] = opts.retention.retainUntil.toISOString();
      }
      const res = await request('PUT', objectUrl(internal, bucket, key), { headers, body });
      await res.arrayBuffer().catch(() => undefined);
      return {
        etag: res.headers.get('etag') ?? '',
        versionId: res.headers.get('x-amz-version-id') ?? undefined,
      };
    },

    async getObject(bucket, key, opts = {}) {
      assertSafeKey(key);
      const headers: Record<string, string> = {};
      if (opts.range) headers.range = `bytes=${opts.range[0]}-${opts.range[1]}`;
      const res = await request('GET', objectUrl(internal, bucket, key), {
        headers,
        okStatuses: [404],
      });
      if (res.status === 404) {
        await res.arrayBuffer().catch(() => undefined);
        return null;
      }
      return { body: Buffer.from(await res.arrayBuffer()), head: headFrom(key, res) };
    },

    async headObject(bucket, key) {
      assertSafeKey(key);
      const res = await request('HEAD', objectUrl(internal, bucket, key), { okStatuses: [404] });
      return res.status === 404 ? null : headFrom(key, res);
    },

    async deleteObject(bucket, key) {
      assertSafeKey(key);
      const res = await request('DELETE', objectUrl(internal, bucket, key));
      await res.arrayBuffer().catch(() => undefined);
    },

    async copyObject(bucket, fromKey, toKey) {
      assertSafeKey(fromKey);
      assertSafeKey(toKey);
      const res = await request('PUT', objectUrl(internal, bucket, toKey), {
        headers: {
          'x-amz-copy-source': `/${bucket}/${uriEncode(fromKey, false)}`,
          'x-amz-metadata-directive': 'COPY',
        },
      });
      // S3 can answer 200 with an <Error> body for copies.
      const text = await res.text();
      if (text.includes('<Error>'))
        throw new StorageError(500, tag(text, 'Code') ?? 'CopyFailed', tag(text, 'Message') ?? '');
    },

    async presignPut(bucket, key, opts): Promise<PresignedRequest> {
      assertSafeKey(key);
      const url = presignUrl({
        method: 'PUT',
        url: objectUrl(publicBase, bucket, key),
        headers: {
          'content-type': opts.contentType,
          'content-length': String(opts.contentLength),
        },
        region: cfg.region,
        service: 's3',
        credentials,
        date: new Date(),
        expiresIn: opts.expiresIn,
      });
      // Content-Length is set by the browser from the body; it is signed, so a
      // body of any other size is rejected by storage.
      return { url: url.toString(), method: 'PUT', headers: { 'Content-Type': opts.contentType } };
    },

    async presignGet(bucket, key, opts): Promise<PresignedRequest> {
      assertSafeKey(key);
      const target = objectUrl(publicBase, bucket, key);
      if (opts.responseContentDisposition)
        target.searchParams.set('response-content-disposition', opts.responseContentDisposition);
      if (opts.responseContentType)
        target.searchParams.set('response-content-type', opts.responseContentType);
      const url = presignUrl({
        method: 'GET',
        url: target,
        region: cfg.region,
        service: 's3',
        credentials,
        date: new Date(),
        expiresIn: opts.expiresIn,
      });
      return { url: url.toString(), method: 'GET', headers: {} };
    },

    async listObjects(bucket, opts = {}) {
      const url = objectUrl(internal, bucket);
      url.searchParams.set('list-type', '2');
      if (opts.prefix) url.searchParams.set('prefix', opts.prefix);
      if (opts.continuationToken)
        url.searchParams.set('continuation-token', opts.continuationToken);
      url.searchParams.set('max-keys', String(Math.min(1000, opts.maxKeys ?? 1000)));
      const xml = await (await request('GET', url)).text();
      const items: ObjectSummary[] = [];
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        items.push({
          key: tag(m[1], 'Key') ?? '',
          size: Number(tag(m[1], 'Size') ?? 0),
          etag: tag(m[1], 'ETag') ?? '',
          lastModified: tag(m[1], 'LastModified') ?? '',
        });
      }
      const truncated = tag(xml, 'IsTruncated') === 'true';
      return { items, nextToken: truncated ? tag(xml, 'NextContinuationToken') : undefined };
    },
  };
}
