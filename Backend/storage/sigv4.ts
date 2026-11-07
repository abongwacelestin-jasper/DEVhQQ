/**
 * AWS Signature Version 4 — a small, dependency-free signer on node:crypto.
 *
 * Why hand-rolled instead of @aws-sdk/*: the backend ships with zero runtime
 * dependencies (supply-chain surface is part of our threat model) and S3 only
 * needs a handful of operations. SigV4 is a fully specified, deterministic
 * algorithm, so this file is checked against AWS's published test vectors
 * (`storage/sigv4.test.ts`, also run in the smoke suite) — any deviation is a
 * test failure, not a silent auth error in production.
 *
 * Spec: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 *
 * Scope deliberately kept small:
 *  - header signing (Authorization) and query signing (presigned URLs),
 *  - S3 rules: single URI-encoding and no path normalisation (`s3: true`),
 *    generic AWS rules otherwise (double encoding + dot-segment removal),
 *  - no chunked / streaming payload signing (we always hash the full body or
 *    use UNSIGNED-PAYLOAD for presigned URLs, as S3 requires).
 */

import { createHash, createHmac } from 'node:crypto';

export const ALGORITHM = 'AWS4-HMAC-SHA256';
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignInput {
  method: string;
  url: URL;
  /** Headers to sign. `host` is added from the URL when missing. */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body, or UNSIGNED-PAYLOAD. Defaults to the empty-body hash. */
  payloadHash?: string;
  region: string;
  service: string;
  credentials: Credentials;
  date: Date;
  /** S3 canonicalisation: encode path once, never normalise it. Default: service === 's3'. */
  s3?: boolean;
}

export interface Signed {
  /** Headers to send, including host, x-amz-date and Authorization. */
  headers: Record<string, string>;
  authorization: string;
  signature: string;
  signedHeaders: string;
  canonicalRequest: string;
  stringToSign: string;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** `20150830T123600Z` */
export function amzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/** RFC 3986 encoding as AWS defines it: only A-Z a-z 0-9 - . _ ~ stay literal. */
export function uriEncode(s: string, encodeSlash = true): string {
  let out = '';
  for (const byte of Buffer.from(s, 'utf8')) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(c) || (c === '/' && !encodeSlash)) out += c;
    else out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  const joined = '/' + out.join('/');
  return path.endsWith('/') && joined !== '/' ? joined + '/' : joined;
}

export function canonicalUri(url: URL, s3: boolean): string {
  // URL.pathname is already percent-encoded for some characters; decode then
  // re-encode with AWS rules so the result is the same however the caller built it.
  const raw = url.pathname || '/';
  if (s3)
    return (
      raw
        .split('/')
        .map((seg) => uriEncode(safeDecode(seg)))
        .join('/') || '/'
    );
  const decoded = normalizePath(raw.split('/').map(safeDecode).join('/'));
  // Generic services: encode each segment, then encode the result again.
  const once = decoded
    .split('/')
    .map((seg) => uriEncode(seg))
    .join('/');
  return (
    once
      .split('/')
      .map((seg) => uriEncode(seg))
      .join('/') || '/'
  );
}

export function canonicalQuery(params: URLSearchParams): string {
  const pairs: [string, string][] = [];
  params.forEach((v, k) => pairs.push([uriEncode(k), uriEncode(v)]));
  pairs.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

function canonicalHeaders(headers: Record<string, string>) {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) {
    const name = k.toLowerCase().trim();
    const value = String(v).trim().replace(/\s+/g, ' ');
    map.set(name, map.has(name) ? `${map.get(name)},${value}` : value);
  }
  const names = [...map.keys()].sort();
  return {
    text: names.map((n) => `${n}:${map.get(n)}\n`).join(''),
    signed: names.join(';'),
  };
}

export function signingKey(secret: string, day: string, region: string, service: string): Buffer {
  const kDate = hmac('AWS4' + secret, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function compute(
  input: SignInput,
  headers: Record<string, string>,
  query: URLSearchParams,
  payloadHash: string,
) {
  const s3 = input.s3 ?? input.service === 's3';
  const stamp = amzDate(input.date);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const ch = canonicalHeaders(headers);
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(input.url, s3),
    canonicalQuery(query),
    ch.text,
    ch.signed,
    payloadHash,
  ].join('\n');
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const key = signingKey(input.credentials.secretAccessKey, day, input.region, input.service);
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex');
  return { stamp, scope, signedHeaders: ch.signed, canonicalRequest, stringToSign, signature };
}

function withHost(input: SignInput): Record<string, string> {
  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'host')) headers.host = input.url.host;
  return headers;
}

/** Signs a request with an Authorization header. */
export function signRequest(input: SignInput): Signed {
  const headers = withHost(input);
  const hasDate = Object.keys(headers).some((k) => k.toLowerCase() === 'x-amz-date');
  if (!hasDate) headers['x-amz-date'] = amzDate(input.date);
  if (input.credentials.sessionToken)
    headers['x-amz-security-token'] = input.credentials.sessionToken;
  const payloadHash = input.payloadHash ?? EMPTY_SHA256;
  const c = compute(input, headers, input.url.searchParams, payloadHash);
  const authorization = `${ALGORITHM} Credential=${input.credentials.accessKeyId}/${c.scope}, SignedHeaders=${c.signedHeaders}, Signature=${c.signature}`;
  return {
    headers: { ...headers, authorization },
    authorization,
    signature: c.signature,
    signedHeaders: c.signedHeaders,
    canonicalRequest: c.canonicalRequest,
    stringToSign: c.stringToSign,
  };
}

/**
 * Presigns a URL (query-string auth). Any header passed in `headers` becomes a
 * signed header the client MUST send verbatim (we use this to pin
 * Content-Type and Content-Length on uploads).
 */
export function presignUrl(input: SignInput & { expiresIn: number }): URL {
  if (!Number.isInteger(input.expiresIn) || input.expiresIn < 1 || input.expiresIn > 604_800)
    throw new Error('expiresIn must be 1..604800 seconds');
  const headers = withHost(input);
  const url = new URL(input.url.toString());
  const stamp = amzDate(input.date);
  const scope = `${stamp.slice(0, 8)}/${input.region}/${input.service}/aws4_request`;
  const names = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
    .join(';');
  url.searchParams.set('X-Amz-Algorithm', ALGORITHM);
  url.searchParams.set('X-Amz-Credential', `${input.credentials.accessKeyId}/${scope}`);
  url.searchParams.set('X-Amz-Date', stamp);
  url.searchParams.set('X-Amz-Expires', String(input.expiresIn));
  if (input.credentials.sessionToken)
    url.searchParams.set('X-Amz-Security-Token', input.credentials.sessionToken);
  url.searchParams.set('X-Amz-SignedHeaders', names);
  const c = compute(
    { ...input, url },
    headers,
    url.searchParams,
    input.payloadHash ?? UNSIGNED_PAYLOAD,
  );
  url.searchParams.set('X-Amz-Signature', c.signature);
  // Re-serialise with AWS encoding so '+', '*', etc. are unambiguous on the wire.
  url.search = canonicalQuery(url.searchParams);
  return url;
}
