import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Router, STREAM, type Ctx } from '../../lib/http.ts';
import { config } from '../../config/env.ts';
import { HttpError } from '../../types.ts';
import { errorCode, startRouter, type TestServer } from '../helpers/server.ts';

/** Raw node:http request so oversized / odd bodies are sent exactly as given. */
function rawRequest(
  base: string,
  opts: { method: string; path: string; headers?: Record<string, string>; body?: Buffer | string },
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  const url = new URL(opts.path, base);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: opts.method,
        host: url.hostname,
        port: url.port,
        path: opts.path,
        headers: opts.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    // The server may answer (413) and close before the whole body is written.
    req.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code !== 'EPIPE' && e.code !== 'ECONNRESET') reject(e);
    });
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

describe('lib/http — Router', () => {
  let app: TestServer;
  const seen: { params?: Record<string, string>; body?: unknown; query?: string; order: string[] } =
    {
      order: [],
    };

  before(async () => {
    const r = new Router();
    r.use(async (ctx, next) => {
      seen.order.push('global');
      ctx.res.setHeader('X-Global', '1');
      return next();
    });
    r.add('GET', '/api/items', { summary: 'list', tag: 'items' }, (ctx) => {
      seen.query = ctx.query.toString();
      return { items: [1, 2] };
    });
    r.add('GET', '/api/items/:id', 'one', (ctx) => {
      seen.params = { ...ctx.params };
      return { id: ctx.params.id };
    });
    r.add('GET', '/api/a/:x/b/:y', 'two params', (ctx) => ({ ...ctx.params }));
    r.add(
      'POST',
      '/api/items',
      'create',
      async (_ctx, next) => {
        seen.order.push('route-mw');
        return next();
      },
      (ctx) => {
        seen.order.push('handler');
        seen.body = ctx.body;
        ctx.status = 201;
        return { created: true, raw: ctx.rawBody?.length ?? 0 };
      },
    );
    r.add('DELETE', '/api/items/:id', 'remove', () => undefined);
    r.add('GET', '/api/boom', 'throws', () => {
      throw new Error('db password is hunter2 at /srv/app/secret.ts:42');
    });
    r.add('GET', '/api/reject', 'async rejects', async () => {
      await Promise.resolve();
      throw new TypeError('Cannot read properties of undefined (reading "internalField")');
    });
    r.add('GET', '/api/teapot', 'http error', () => {
      throw new HttpError(418, 'teapot', 'Short and stout', { spout: true });
    });
    r.add('GET', '/api/stream', 'takes over', (ctx: Ctx) => {
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', 'text/plain');
      ctx.res.end('streamed');
      return STREAM;
    });
    app = await startRouter(r);
  });
  after(() => app.close());

  it('routes by method and path and returns JSON', async () => {
    const res = await app.client().get('/api/items?x=1&y=two');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { items: [1, 2] });
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(seen.query, 'x=1&y=two');
  });

  it('accepts a trailing slash', async () => {
    assert.equal((await app.client().get('/api/items/')).status, 200);
  });

  it('extracts and URL-decodes path params', async () => {
    const res = await app.client().get('/api/items/a%20b%2Fc');
    assert.equal(res.status, 200);
    assert.deepEqual(seen.params, { id: 'a b/c' });
    assert.deepEqual((await app.client().get('/api/a/1/b/2')).json, { x: '1', y: '2' });
  });

  it('params never span segments', async () => {
    assert.equal((await app.client().get('/api/items/a/b')).status, 404);
  });

  it('unknown paths are 404 with a JSON error and request id', async () => {
    const res = await app.client().get('/api/nope');
    assert.equal(res.status, 404);
    assert.equal(errorCode(res), 'not_found');
    const body = res.json as { error: { requestId: string } };
    assert.equal(body.error.requestId, res.headers.get('x-request-id'));
    assert.deepEqual(seen.order.slice(-1), ['global'], 'global middleware runs for 404s');
  });

  it('known path + wrong method is 405 with an Allow header', async () => {
    const res = await app.client().request('PUT', '/api/items');
    assert.equal(res.status, 405);
    assert.equal(errorCode(res), 'method_not_allowed');
    assert.deepEqual(res.headers.get('allow')?.split(', ').sort(), ['GET', 'POST']);
    const del = await app.client().request('PATCH', '/api/items/7');
    assert.equal(del.status, 405);
    assert.deepEqual(del.headers.get('allow')?.split(', ').sort(), ['DELETE', 'GET']);
  });

  it('runs global middleware, then route middleware, then the handler', async () => {
    seen.order = [];
    const res = await app.client().post('/api/items', { a: 1 });
    assert.equal(res.status, 201);
    assert.deepEqual(seen.order, ['global', 'route-mw', 'handler']);
    assert.deepEqual(seen.body, { a: 1 });
    assert.equal((res.json as { raw: number }).raw, Buffer.byteLength('{"a":1}'));
    assert.equal(res.headers.get('x-global'), '1');
  });

  it('an empty body parses to undefined, whatever the content type', async () => {
    seen.body = 'unset';
    const res = await rawRequest(app.base, {
      method: 'POST',
      path: '/api/items',
      headers: { 'Content-Type': 'text/plain' },
    });
    assert.equal(res.status, 201);
    assert.equal(seen.body, undefined);
  });

  it('returns 204 with no body when the handler returns undefined', async () => {
    const res = await app.client().delete('/api/items/1');
    assert.equal(res.status, 204);
    assert.equal(res.text, '');
  });

  it('rejects non-JSON bodies with 415 (blocks form-post CSRF)', async () => {
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      '',
    ]) {
      const res = await rawRequest(app.base, {
        method: 'POST',
        path: '/api/items',
        headers: type ? { 'Content-Type': type } : {},
        body: 'a=1',
      });
      assert.equal(res.status, 415, `content-type "${type}"`);
      assert.equal(
        (JSON.parse(res.body) as { error: { code: string } }).error.code,
        'unsupported_media_type',
      );
    }
  });

  it('rejects malformed JSON with 400', async () => {
    for (const body of ['{', '{"a":}', 'undefined', "{'a':1}"]) {
      const res = await app.client().request('POST', '/api/items', { rawBody: body });
      assert.equal(res.status, 400, body);
      assert.equal(errorCode(res), 'invalid_json');
    }
  });

  it('rejects bodies over maxBodyBytes with 413', async () => {
    const big = Buffer.alloc(config.maxBodyBytes + 1, 0x20);
    const res = await rawRequest(app.base, {
      method: 'POST',
      path: '/api/items',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(big.length) },
      body: big,
    });
    assert.equal(res.status, 413);
    assert.equal(
      (JSON.parse(res.body) as { error: { code: string } }).error.code,
      'payload_too_large',
    );
  });

  it('accepts a body of exactly maxBodyBytes', async () => {
    const json = JSON.stringify({ pad: 'x'.repeat(config.maxBodyBytes - 10) });
    assert.equal(Buffer.byteLength(json), config.maxBodyBytes);
    const res = await app.client().request('POST', '/api/items', { rawBody: json });
    assert.equal(res.status, 201);
  });

  it('answers HEAD for GET routes with headers but no body', async () => {
    const res = await rawRequest(app.base, { method: 'HEAD', path: '/api/items' });
    assert.equal(res.status, 200);
    assert.equal(res.body, '');
    assert.equal(res.headers['content-length'], String(Buffer.byteLength('{"items":[1,2]}')));
  });

  it('turns unexpected errors into a generic 500 without leaking internals', async () => {
    for (const path of ['/api/boom', '/api/reject']) {
      const res = await app.client().get(path);
      assert.equal(res.status, 500);
      assert.deepEqual(Object.keys((res.json as { error: object }).error).sort(), [
        'code',
        'message',
        'requestId',
      ]);
      assert.equal(errorCode(res), 'internal');
      assert.doesNotMatch(res.text, /hunter2|secret\.ts|internalField|TypeError|at \S+:\d+/);
    }
  });

  it('serialises HttpError status, code, message and details', async () => {
    const res = await app.client().get('/api/teapot');
    assert.equal(res.status, 418);
    assert.deepEqual((res.json as { error: Record<string, unknown> }).error, {
      code: 'teapot',
      message: 'Short and stout',
      requestId: res.headers.get('x-request-id'),
      details: { spout: true },
    });
  });

  it('echoes a client X-Request-Id (truncated to 64 chars) or generates a UUID', async () => {
    const given = await app
      .client()
      .get('/api/items', { headers: { 'X-Request-Id': 'r'.repeat(100) } });
    assert.equal(given.headers.get('x-request-id'), 'r'.repeat(64));
    const generated = await app.client().get('/api/items');
    assert.match(generated.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
  });

  it('lets a handler take over the response (STREAM)', async () => {
    const res = await app.client().get('/api/stream');
    assert.equal(res.status, 200);
    assert.equal(res.text, 'streamed');
  });

  it('builds an inventory with tags, auth mode and default responses', async () => {
    const r = new Router();
    r.add('GET', '/api/x/:id', 'public route', () => 1);
    r.add(
      'POST',
      '/api/y',
      { summary: 'guarded', tag: 'why' },
      async (_c, n) => n(),
      () => 2,
    );
    assert.deepEqual(r.inventory(), [
      {
        method: 'GET',
        path: '/api/x/:id',
        summary: 'public route',
        tag: 'x',
        auth: 'public',
        responses: [429],
      },
      {
        method: 'POST',
        path: '/api/y',
        summary: 'guarded',
        tag: 'why',
        auth: 'session',
        responses: [401, 403, 429],
      },
    ]);
  });

  // FINDING B-3 (lib/http.ts:164): path params go through decodeURIComponent
  // with no guard, so a malformed escape like `%E0%A4%A` throws URIError,
  // which the catch-all turns into a 500 and an error log line. Any
  // unauthenticated caller can generate 5xx (and noise in MTTD alerting that
  // keys on 5xx). It should be a 400 (or 404).
  it(
    'malformed percent-encoding in a path param is a client error, not a 500',
    async () => {
      const res = await app.client().get('/api/items/%E0%A4%A');
      assert.ok(res.status >= 400 && res.status < 500, `got ${res.status}`);
    },
  );
});
