import '../setup.ts';
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BlockedTargetError,
  blockedAddress,
  checkUrlShape,
  expandV6,
  guardedRequest,
  setOutboundDeps,
  vetUrl,
  type OutboundRequest,
  type OutboundResponse,
  type ResolvedAddress,
} from '../../monitors/ssrf.ts';

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:2800:220:1:248:1893:25c8:1946';

function isBlocked(fn: () => unknown) {
  assert.throws(fn, (e: unknown) => e instanceof BlockedTargetError);
}

describe('monitors/ssrf — address classification', () => {
  const blockedV4: [string, RegExp][] = [
    ['0.0.0.0', /this-network/],
    ['0.255.255.255', /this-network/],
    ['10.0.0.1', /private/],
    ['10.255.255.255', /private/],
    ['100.64.0.1', /carrier-grade/],
    ['100.127.255.255', /carrier-grade/],
    ['127.0.0.1', /loopback/],
    ['127.255.255.254', /loopback/],
    ['169.254.169.254', /link-local/],
    ['169.254.0.1', /link-local/],
    ['172.16.0.1', /private/],
    ['172.31.255.255', /private/],
    ['192.0.0.8', /IETF/],
    ['192.0.2.1', /documentation/],
    ['192.88.99.1', /6to4/],
    ['192.168.1.1', /private/],
    ['198.18.0.1', /benchmarking/],
    ['198.19.255.255', /benchmarking/],
    ['198.51.100.7', /documentation/],
    ['203.0.113.9', /documentation/],
    ['224.0.0.1', /multicast/],
    ['239.255.255.250', /multicast/],
    ['240.0.0.1', /reserved/],
    ['255.255.255.255', /reserved/],
  ];
  for (const [ip, why] of blockedV4)
    it(`blocks ${ip}`, () => assert.match(blockedAddress(ip) ?? 'ALLOWED', why));

  it('allows public IPv4, including the edges just outside blocked ranges', () => {
    for (const ip of [
      PUBLIC_V4,
      '1.1.1.1',
      '8.8.8.8',
      '9.255.255.255',
      '11.0.0.0',
      '100.63.255.255',
      '100.128.0.0',
      '172.15.255.255',
      '172.32.0.0',
      '192.167.255.255',
      '192.169.0.0',
      '198.17.255.255',
      '198.20.0.0',
      '223.255.255.255',
      '126.255.255.255',
      '128.0.0.0',
      '169.253.255.255',
      '169.255.0.0',
    ])
      assert.equal(blockedAddress(ip), null, ip);
  });

  const blockedV6: [string, RegExp][] = [
    ['::', /unspecified/],
    ['::1', /loopback/],
    ['0:0:0:0:0:0:0:1', /loopback/],
    ['::ffff:169.254.169.254', /IPv4-mapped/],
    ['::ffff:a9fe:a9fe', /IPv4-mapped/],
    ['::ffff:8.8.8.8', /IPv4-mapped/],
    ['::127.0.0.1', /IPv4-compatible/],
    ['64:ff9b::7f00:1', /NAT64/],
    ['64:ff9b:1::1', /NAT64/],
    ['100::1', /discard/],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', /Teredo/],
    ['2001:db8::1', /documentation/],
    ['2002:7f00:1::', /6to4/],
    ['fc00::1', /unique-local/],
    ['fd00:ec2::254', /unique-local/],
    ['fe80::1', /link-local/],
    ['fe80::1%eth0', /link-local/],
    ['febf::1', /link-local/],
    ['fec0::1', /site-local/],
    ['ff02::1', /multicast/],
  ];
  for (const [ip, why] of blockedV6)
    it(`blocks ${ip}`, () => assert.match(blockedAddress(ip) ?? 'ALLOWED', why));

  it('allows public IPv6', () => {
    for (const ip of [PUBLIC_V6, '2a00:1450:4001:82a::200e', '2001:4860:4860::8888', '2003::1'])
      assert.equal(blockedAddress(ip), null, ip);
  });

  it('anything that is not an IP literal is refused by the classifier', () => {
    for (const s of ['example.com', '', '1.2.3', '256.1.1.1', '::g', '[::1]'])
      assert.notEqual(blockedAddress(s), null, s);
  });

  it('expandV6 handles compression, embedded IPv4 and zone ids, and rejects malformed input', () => {
    assert.deepEqual(expandV6('::'), [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(expandV6('1::'), [1, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(expandV6('::ffff:1.2.3.4'), [0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    assert.deepEqual(expandV6('FE80::1%25en0'), [0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    assert.deepEqual(expandV6('1:2:3:4:5:6:7:8'), [1, 2, 3, 4, 5, 6, 7, 8]);
    for (const bad of [
      '1:::2',
      '1::2::3',
      'g::1',
      '1:2:3:4:5:6:7:8:9',
      '1:2:3',
      '12345::',
      '::1.2.3.256',
      '1.2.3.4',
    ])
      assert.equal(expandV6(bad), null, bad);
  });
});

describe('monitors/ssrf — URL shape', () => {
  it('blocks encoded and alternate spellings of internal addresses (WHATWG-normalised)', () => {
    for (const u of [
      'http://2130706433/',
      'http://0x7f.1/',
      'http://0x7f000001/',
      'http://017700000001/',
      'http://127.1/',
      'http://%31%32%37.0.0.1/',
      'http://0/',
      'http://169.254.169.254./latest/meta-data/',
      'http://[::1]/',
      'http://[::ffff:169.254.169.254]/',
      'http://[0:0:0:0:0:ffff:7f00:1]/',
      'http://[::127.0.0.1]/',
      'http://[fd00:ec2::254]/',
      'https://10.0.0.1:8443/',
    ])
      isBlocked(() => checkUrlShape(u));
  });

  it('blocks internal hostnames, case- and trailing-dot-insensitively', () => {
    for (const u of [
      'http://localhost/',
      'http://LOCALHOST:8080/',
      'http://localhost./',
      'http://api.localhost/',
      'http://printer.local/',
      'http://db.internal/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://metadata/',
      'http://instance-data/',
    ])
      isBlocked(() => checkUrlShape(u));
  });

  it('only http(s) — and http can be switched off', () => {
    for (const u of [
      'ftp://example.com/',
      'file:///etc/passwd',
      'gopher://example.com/',
      'data:text/plain,x',
      'javascript:alert(1)',
      'ws://example.com/',
    ])
      isBlocked(() => checkUrlShape(u));
    assert.equal(checkUrlShape('http://example.com/').hostname, 'example.com');
    isBlocked(() => checkUrlShape('http://example.com/', { allowHttp: false }));
    assert.equal(checkUrlShape('https://example.com/', { allowHttp: false }).protocol, 'https:');
  });

  it('refuses credentials in the URL and unparsable input', () => {
    isBlocked(() => checkUrlShape('https://user:pass@example.com/'));
    isBlocked(() => checkUrlShape('https://localhost:80@example.com/'));
    isBlocked(() => checkUrlShape('https://:x@example.com/'));
    isBlocked(() => checkUrlShape('not a url'));
    isBlocked(() => checkUrlShape(''));
  });

  it('accepts public literals and names, and URL objects as well as strings', () => {
    assert.equal(checkUrlShape(`https://${PUBLIC_V4}/x`).hostname, PUBLIC_V4);
    assert.equal(checkUrlShape(`https://[${PUBLIC_V6}]/`).hostname, `[${PUBLIC_V6}]`);
    assert.equal(checkUrlShape(new URL('https://status.example.com/health')).pathname, '/health');
    // Names that merely contain a denied word are fine.
    assert.equal(checkUrlShape('https://localhost.example.com/').hostname, 'localhost.example.com');
    assert.equal(
      checkUrlShape('https://internal-tools.example.com/').hostname,
      'internal-tools.example.com',
    );
  });
});

describe('monitors/ssrf — DNS vetting and pinning', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());
  const resolveTo = (addrs: ResolvedAddress[]) => {
    const seen: string[] = [];
    restore = setOutboundDeps({
      resolver: async (h) => {
        seen.push(h);
        return addrs;
      },
    });
    return seen;
  };

  it('pins the first vetted address', async () => {
    const seen = resolveTo([
      { address: PUBLIC_V4, family: 4 },
      { address: '1.1.1.1', family: 4 },
    ]);
    const r = await vetUrl('https://status.example.com/');
    assert.deepEqual(r.ip, { address: PUBLIC_V4, family: 4 });
    assert.deepEqual(seen, ['status.example.com']);
  });

  it('rejects the name if ANY answer is internal (rebinding-style mixed answers)', async () => {
    for (const bad of [
      '127.0.0.1',
      '169.254.169.254',
      '10.1.2.3',
      '::1',
      '::ffff:127.0.0.1',
      'fd00:ec2::254',
    ]) {
      resolveTo([
        { address: PUBLIC_V4, family: 4 },
        { address: bad, family: bad.includes(':') ? 6 : 4 },
      ]);
      await assert.rejects(vetUrl('https://rebind.example.com/'), BlockedTargetError, bad);
      restore?.();
    }
  });

  it('IP literals skip DNS entirely', async () => {
    const seen = resolveTo([{ address: '127.0.0.1', family: 4 }]);
    const r = await vetUrl(`https://[${PUBLIC_V6}]/`);
    assert.deepEqual(r.ip, { address: PUBLIC_V6, family: 6 });
    assert.deepEqual(seen, []);
  });

  it('DNS errors and empty answers fail closed (not as a BlockedTargetError)', async () => {
    restore = setOutboundDeps({
      resolver: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    await assert.rejects(vetUrl('https://nx.example.com/'), /DNS lookup failed/);
    restore();
    resolveTo([]);
    await assert.rejects(vetUrl('https://empty.example.com/'), /no addresses/);
  });
});

describe('monitors/ssrf — guardedRequest', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  /** Fake DNS (everything public unless listed) + scripted transport. */
  function fake(
    responses: ((req: OutboundRequest) => OutboundResponse | Promise<OutboundResponse>)[],
    dns: Record<string, string> = {},
  ) {
    const calls: OutboundRequest[] = [];
    restore = setOutboundDeps({
      resolver: async (h) => [{ address: dns[h] ?? PUBLIC_V4, family: 4 }],
      transport: async (req) => {
        calls.push(req);
        const next = responses.shift();
        assert.ok(next, `unexpected request to ${req.url}`);
        return next(req);
      },
    });
    return calls;
  }
  const ok = (body = 'ok'): OutboundResponse => ({
    status: 200,
    headers: {},
    body,
    truncated: false,
  });
  const redirect = (status: number, location: string) => (): OutboundResponse => ({
    status,
    headers: { location },
    body: '',
    truncated: false,
  });

  it('sends to the pinned IP with the original URL (SNI/Host stay the hostname)', async () => {
    const calls = fake([() => ok()], { 'api.example.com': PUBLIC_V4 });
    const res = await guardedRequest('https://api.example.com/health', { headers: { 'x-a': '1' } });
    assert.equal(res.status, 200);
    assert.equal(res.ip, PUBLIC_V4);
    assert.equal(res.finalUrl, 'https://api.example.com/health');
    assert.equal(calls[0].url.hostname, 'api.example.com');
    assert.deepEqual(calls[0].ip, { address: PUBLIC_V4, family: 4 });
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].headers['x-a'], '1');
    assert.equal(calls[0].maxBodyBytes, 64 * 1024);
  });

  it('re-vets every redirect hop: a redirect to the metadata service is blocked', async () => {
    const calls = fake([redirect(302, 'http://169.254.169.254/latest/meta-data/')]);
    await assert.rejects(guardedRequest('https://public.example.com/'), BlockedTargetError);
    assert.equal(calls.length, 1, 'the internal hop is never requested');
  });

  it('re-resolves names on redirect: a redirect to a name that resolves internally is blocked', async () => {
    fake([redirect(301, 'https://evil.example.net/')], { 'evil.example.net': '10.0.0.5' });
    await assert.rejects(guardedRequest('https://public.example.com/'), BlockedTargetError);
  });

  it('follows at most 3 redirects, resolving relative locations', async () => {
    const calls = fake([
      redirect(302, '/a'),
      redirect(302, '/b'),
      redirect(302, 'https://other.example.com/c'),
      () => ok('done'),
    ]);
    const res = await guardedRequest('https://start.example.com/');
    assert.equal(res.body, 'done');
    assert.deepEqual(
      calls.map((c) => c.url.toString()),
      [
        'https://start.example.com/',
        'https://start.example.com/a',
        'https://start.example.com/b',
        'https://other.example.com/c',
      ],
    );
    fake([redirect(302, '/1'), redirect(302, '/2'), redirect(302, '/3'), redirect(302, '/4')]);
    await assert.rejects(guardedRequest('https://loop.example.com/'), /too many redirects/);
  });

  it('303 switches POST to GET and drops the body; 307 keeps both', async () => {
    const calls = fake([redirect(303, '/see-other'), () => ok()]);
    await guardedRequest('https://x.example.com/', { method: 'POST', body: '{"a":1}' });
    assert.deepEqual([calls[1].method, calls[1].body], ['GET', undefined]);
    const again = fake([redirect(307, '/temp'), () => ok()]);
    await guardedRequest('https://x.example.com/', { method: 'POST', body: '{"a":1}' });
    assert.deepEqual([again[1].method, again[1].body], ['POST', '{"a":1}']);
  });

  it('followRedirects:false returns the 3xx as is', async () => {
    const calls = fake([redirect(302, 'https://elsewhere.example.com/')]);
    const res = await guardedRequest('https://x.example.com/', { followRedirects: false });
    assert.equal(res.status, 302);
    assert.equal(calls.length, 1);
  });

  it('enforces the overall deadline even if the transport hangs', async () => {
    fake([() => new Promise<OutboundResponse>(() => undefined)]);
    const started = Date.now();
    await assert.rejects(guardedRequest('https://slow.example.com/', { timeoutMs: 50 }), /timeout/);
    assert.ok(Date.now() - started < 2000);
  });

  it('refuses blocked targets before any DNS or socket work', async () => {
    const calls = fake([]);
    for (const u of ['http://127.0.0.1/', 'http://localhost/', 'file:///etc/passwd'])
      await assert.rejects(guardedRequest(u), BlockedTargetError, u);
    assert.equal(calls.length, 0);
  });
});
