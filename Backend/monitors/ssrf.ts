/**
 * SSRF-safe outbound HTTP, shared by uptime monitors and outbound webhooks.
 *
 * A URL supplied by a user is never handed to `fetch`. Instead:
 *  1. Parse with WHATWG URL (normalises tricks like `http://2130706433/` and
 *     `http://0x7f.1/` to dotted IPv4). Only http/https, no credentials.
 *  2. Reject denied hostnames (`localhost`, `*.internal`, metadata names).
 *  3. Resolve DNS ourselves and reject the request if ANY resolved address is
 *     private, loopback, link-local, CGNAT, multicast, reserved, cloud metadata
 *     (169.254.169.254, fd00:ec2::254), unique-local (fc00::/7) or an
 *     IPv4-mapped / NAT64 / 6to4 / Teredo IPv6 address.
 *  4. Connect to the first vetted IP by pinning it in the socket `lookup`, so
 *     a second DNS answer (DNS rebinding) can't swap the destination. TLS still
 *     verifies the certificate against the original hostname (SNI).
 *  5. Redirects are not followed by the socket; we follow at most 3 manually,
 *     re-running the whole guard for every hop.
 *  6. Hard 10 s deadline for the whole exchange and a response body cap.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';

export const OUTBOUND_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 64 * 1024;
const MAX_REDIRECTS = 3;

export class BlockedTargetError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Blocked destination: ${reason}`);
    this.name = 'BlockedTargetError';
    this.reason = reason;
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface OutboundRequest {
  method: 'GET' | 'HEAD' | 'POST';
  url: URL;
  ip: ResolvedAddress;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBodyBytes: number;
}

export interface OutboundResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  truncated: boolean;
}

/** Performs one request against an already-vetted, pinned IP. */
export type Transport = (req: OutboundRequest) => Promise<OutboundResponse>;

const defaultResolver: Resolver = async (hostname) => {
  const rows = await dnsLookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

const defaultTransport: Transport = (r) =>
  new Promise((resolve, reject) => {
    const pinned: LookupFunction = (_host, opts, cb) => {
      if (opts.all) cb(null, [{ address: r.ip.address, family: r.ip.family }]);
      else cb(null, r.ip.address, r.ip.family);
    };
    const send = r.url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(
      r.url,
      {
        method: r.method,
        headers: {
          'user-agent': 'TavetaHQ-Outbound/1.0',
          ...r.headers,
          ...(r.body !== undefined ? { 'content-length': String(Buffer.byteLength(r.body)) } : {}),
        },
        lookup: pinned,
        // A fresh socket per request: pooled sockets would bypass the pinned lookup.
        agent: false,
        timeout: r.timeoutMs,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on('data', (c: Buffer) => {
          if (truncated) return;
          size += c.length;
          if (size > r.maxBodyBytes) {
            truncated = true;
            chunks.push(c.subarray(0, Math.max(0, r.maxBodyBytes - (size - c.length))));
            res.destroy();
            finish();
            return;
          }
          chunks.push(c);
        });
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            truncated,
          });
        };
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', (e) => (done ? undefined : reject(e)));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (r.body !== undefined) req.write(r.body);
    req.end();
  });

let resolver: Resolver = defaultResolver;
let transport: Transport = defaultTransport;

/** Test seam: replace DNS resolution and/or the socket layer. Returns a restore function. */
export function setOutboundDeps(deps: { resolver?: Resolver; transport?: Transport }): () => void {
  const prev = { resolver, transport };
  if (deps.resolver) resolver = deps.resolver;
  if (deps.transport) transport = deps.transport;
  return () => {
    resolver = prev.resolver;
    transport = prev.transport;
  };
}

// ── Address classification ──────────────────────────────────────────────────

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
}

const v4Blocks: [string, number, string][] = [
  ['0.0.0.0', 8, 'this-network'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'carrier-grade NAT'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local / cloud metadata'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'IETF protocol assignments'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.88.99.0', 24, '6to4 relay'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved / broadcast'],
];

function blockedV4(ip: string): string | null {
  const n = v4ToInt(ip);
  for (const [base, bits, why] of v4Blocks) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((n & mask) >>> 0 === (v4ToInt(base) & mask) >>> 0) return why;
  }
  return null;
}

/** Expands an IPv6 literal (including an embedded dotted IPv4 tail) to 8 hextets. */
export function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const n = v4ToInt(dotted[1]);
    s = s.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const parts = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (parts.length !== 8) return null;
  const out = parts.map((p) => (/^[0-9a-f]{1,4}$/.test(p) ? Number.parseInt(p, 16) : NaN));
  return out.some((x) => Number.isNaN(x)) ? null : out;
}

function blockedV6(ip: string): string | null {
  const h = expandV6(ip);
  if (!h) return 'unparseable IPv6';
  if (h.every((x) => x === 0)) return 'unspecified';
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return 'loopback';
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return 'IPv4-mapped IPv6';
  if (h.slice(0, 6).every((x) => x === 0)) return 'IPv4-compatible IPv6';
  if (h[0] === 0x64 && h[1] === 0xff9b) return 'NAT64';
  if (h[0] === 0x100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return 'discard-only';
  if (h[0] === 0x2001 && h[1] === 0) return 'Teredo';
  if (h[0] === 0x2001 && h[1] === 0xdb8) return 'documentation';
  if (h[0] === 0x2002) return '6to4';
  if ((h[0] & 0xfe00) === 0xfc00) return 'unique-local (fc00::/7, incl. fd00:ec2::254 metadata)';
  if ((h[0] & 0xffc0) === 0xfe80) return 'link-local';
  if ((h[0] & 0xffc0) === 0xfec0) return 'site-local';
  if ((h[0] & 0xff00) === 0xff00) return 'multicast';
  return null;
}

/** Returns why an IP literal is not a permitted destination, or null if it is public. */
export function blockedAddress(ip: string): string | null {
  const fam = isIP(ip);
  if (fam === 4) return blockedV4(ip);
  if (fam === 6) return blockedV6(ip);
  return 'not an IP address';
}

const deniedHosts = [
  /^localhost$/,
  /\.localhost$/,
  /\.local$/,
  /\.internal$/,
  /^metadata$/,
  /^metadata\.google\.internal$/,
  /^instance-data$/,
];

/**
 * Static checks on a URL (scheme, credentials, literal IPs, denied names).
 * Throws BlockedTargetError. Does not resolve DNS — see `vetUrl`.
 */
export function checkUrlShape(raw: string | URL, opts: { allowHttp?: boolean } = {}): URL {
  let url: URL;
  try {
    url = typeof raw === 'string' ? new URL(raw) : raw;
  } catch {
    throw new BlockedTargetError('not a valid URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && opts.allowHttp !== false))
    throw new BlockedTargetError(`scheme ${url.protocol.replace(':', '')} is not allowed`);
  if (url.username || url.password) throw new BlockedTargetError('credentials in URL');
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (!host) throw new BlockedTargetError('missing host');
  if (isIP(host)) {
    const why = blockedAddress(host);
    if (why) throw new BlockedTargetError(`${host} is ${why}`);
  } else if (deniedHosts.some((re) => re.test(host))) {
    throw new BlockedTargetError(`${host} is an internal hostname`);
  }
  return url;
}

/** Full check: shape + DNS. Every resolved address must be public; returns the pinned one. */
export async function vetUrl(
  raw: string | URL,
  opts: { allowHttp?: boolean } = {},
): Promise<{ url: URL; ip: ResolvedAddress }> {
  const url = checkUrlShape(raw, opts);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const fam = isIP(host);
  if (fam) return { url, ip: { address: host, family: fam === 6 ? 6 : 4 } };
  let addrs: ResolvedAddress[];
  try {
    addrs = await resolver(host);
  } catch {
    throw new Error(`DNS lookup failed for ${host}`);
  }
  if (!addrs.length) throw new Error(`DNS returned no addresses for ${host}`);
  for (const a of addrs) {
    const why = blockedAddress(a.address);
    if (why) throw new BlockedTargetError(`${host} resolves to ${a.address} (${why})`);
  }
  return { url, ip: addrs[0] };
}

export interface GuardedResult extends OutboundResponse {
  ip: string;
  ms: number;
  finalUrl: string;
}

/**
 * Sends a request through the guard, following up to 3 redirects (each hop
 * re-vetted). The deadline covers DNS, connect, every hop and the body.
 */
export async function guardedRequest(
  raw: string | URL,
  init: {
    method?: 'GET' | 'HEAD' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    allowHttp?: boolean;
    followRedirects?: boolean;
    timeoutMs?: number;
    maxBodyBytes?: number;
  } = {},
): Promise<GuardedResult> {
  const started = performance.now();
  const deadline = started + (init.timeoutMs ?? OUTBOUND_TIMEOUT_MS);
  let target: string | URL = raw;
  let method = init.method ?? 'GET';
  let body = init.body;
  for (let hop = 0; ; hop++) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error('timeout');
    const { url, ip } = await withDeadline(vetUrl(target, init), remaining);
    const res = await withDeadline(
      transport({
        method,
        url,
        ip,
        headers: init.headers ?? {},
        body,
        timeoutMs: Math.max(1, Math.round(deadline - performance.now())),
        maxBodyBytes: init.maxBodyBytes ?? MAX_BODY_BYTES,
      }),
      deadline - performance.now(),
    );
    const location = res.headers.location;
    if (init.followRedirects !== false && res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Error('too many redirects');
      target = new URL(String(location), url);
      if (res.status === 303) {
        method = method === 'HEAD' ? 'HEAD' : 'GET';
        body = undefined;
      }
      continue;
    }
    return {
      ...res,
      ip: ip.address,
      ms: Math.round(performance.now() - started),
      finalUrl: url.toString(),
    };
  }
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return Promise.reject(new Error('timeout'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}
