import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockFetch } from '../test/fetchMock';

type ClientModule = typeof import('./client');

/** Fresh module per test: the client keeps its token and handlers in module state. */
async function loadClient(): Promise<ClientModule> {
  vi.resetModules();
  return import('./client');
}

async function caught(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected the request to reject');
}

describe('api() — success paths', () => {
  let client: ClientModule;
  beforeEach(async () => {
    client = await loadClient();
  });

  it('GETs JSON with credentials and the console token header, no content type', async () => {
    const f = mockFetch().reply(200, { items: [1, 2] });
    await expect(client.api('/api/tasks')).resolves.toEqual({ items: [1, 2] });
    expect(f.calls).toHaveLength(1);
    const c = f.calls[0];
    expect(c.url).toBe('/api/tasks');
    expect(c.method).toBe('GET');
    expect(c.init?.credentials).toBe('include');
    expect(c.headers['x-devhq-client']).toBe('console');
    expect(c.headers.accept).toBe('application/json');
    expect(c.headers['content-type']).toBeUndefined();
    expect(c.headers.authorization).toBeUndefined();
  });

  it('sends a JSON body with a content type', async () => {
    const f = mockFetch().reply(201, { key: 'RB-1' });
    await client.api('/api/tasks', { method: 'POST', body: { title: 'x' } });
    expect(f.calls[0].method).toBe('POST');
    expect(f.calls[0].headers['content-type']).toBe('application/json');
    expect(f.calls[0].body).toEqual({ title: 'x' });
  });

  it('resolves undefined for an empty (204) response', async () => {
    mockFetch().reply(204);
    await expect(client.api('/api/tasks/RB-1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('attaches, persists and clears the bearer token', async () => {
    const f = mockFetch().reply(200, {}).reply(200, {});
    client.setToken('tok-1');
    expect(client.getToken()).toBe('tok-1');
    expect(sessionStorage.getItem('devhq.api.token')).toBe('tok-1');
    await client.api('/api/a');
    expect(f.calls[0].headers.authorization).toBe('Bearer tok-1');

    client.setToken(null);
    expect(sessionStorage.getItem('devhq.api.token')).toBeNull();
    await client.api('/api/b');
    expect(f.calls[1].headers.authorization).toBeUndefined();
  });

  it('restores the token from sessionStorage on load', async () => {
    sessionStorage.setItem('devhq.api.token', 'persisted');
    const fresh = await loadClient();
    expect(fresh.getToken()).toBe('persisted');
  });

  it('rememberToken stores only a present token', async () => {
    client.rememberToken(null);
    client.rememberToken({});
    expect(client.getToken()).toBeNull();
    client.rememberToken({ token: 'from-body' });
    expect(client.getToken()).toBe('from-body');
  });

  it('prefixes VITE_API_BASE without a double slash', async () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.example.test/');
    const based = await loadClient();
    const f = mockFetch().reply(200, {});
    await based.api('/api/health');
    expect(f.calls[0].url).toBe('https://api.example.test/api/health');
  });
});

describe('api() — error mapping', () => {
  let client: ClientModule;
  let signedOut: ReturnType<typeof vi.fn>;
  let stepUpRequired: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    client = await loadClient();
    signedOut = vi.fn();
    stepUpRequired = vi.fn();
    client.setAuthHandlers({ signedOut });
    client.setAuthHandlers({ stepUpRequired }); // merged, not replaced
  });

  it.each(['unauthenticated', 'session_revoked', 'session_expired', 'mfa_required'])(
    '401 %s ends the session: sign-out handler fires',
    async (code) => {
      mockFetch().reply(401, apiError(code, 'Session ended', undefined, 'req-9'));
      const e = await caught(client.api('/api/tasks'));
      expect(e).toBeInstanceOf(client.ApiError);
      const err = e as InstanceType<ClientModule['ApiError']>;
      expect(err).toMatchObject({ status: 401, code, message: 'Session ended', requestId: 'req-9' });
      expect(err.isSessionEnded).toBe(true);
      expect(signedOut).toHaveBeenCalledTimes(1);
      expect(stepUpRequired).not.toHaveBeenCalled();
    },
  );

  it('401 step_up_required opens re-verification instead of signing out', async () => {
    mockFetch().reply(401, apiError('step_up_required'));
    const err = (await caught(client.api('/api/team/m2', { method: 'PATCH', body: {} }))) as InstanceType<
      ClientModule['ApiError']
    >;
    expect(err.code).toBe('step_up_required');
    expect(err.isSessionEnded).toBe(false);
    expect(stepUpRequired).toHaveBeenCalledTimes(1);
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('401 with the X-Step-Up-Required header is treated as step-up too', async () => {
    mockFetch().reply(401, apiError('mfa_invalid'), { 'X-Step-Up-Required': '1' });
    await caught(client.api('/api/auth/step-up', { method: 'POST', body: { code: '1' } }));
    expect(stepUpRequired).toHaveBeenCalledTimes(1);
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('a 403 never signs out or prompts', async () => {
    mockFetch().reply(403, apiError('forbidden', 'Requires manage on Deployment'));
    const err = (await caught(client.api('/api/deployments/d1/approve', { method: 'POST' }))) as InstanceType<
      ClientModule['ApiError']
    >;
    expect(err.status).toBe(403);
    expect(err.isSessionEnded).toBe(false);
    expect(signedOut).not.toHaveBeenCalled();
    expect(stepUpRequired).not.toHaveBeenCalled();
  });

  it('silent requests suppress both reactions but still reject', async () => {
    mockFetch()
      .reply(401, apiError('session_expired'))
      .reply(401, apiError('step_up_required'));
    await caught(client.api('/api/auth/session', { silent: true }));
    await caught(client.api('/api/auth/step-up', { silent: true }));
    expect(signedOut).not.toHaveBeenCalled();
    expect(stepUpRequired).not.toHaveBeenCalled();
  });

  it('422 carries code, message, request id and validation details', async () => {
    const details = { allowed: ['key', 'title'] };
    mockFetch().reply(422, apiError('field_not_allowed', 'Field "x" can\'t be queried', details, 'req-422'));
    const err = (await caught(client.api('/api/_query', { method: 'POST', body: {} }))) as InstanceType<
      ClientModule['ApiError']
    >;
    expect(err).toMatchObject({
      name: 'ApiError',
      status: 422,
      code: 'field_not_allowed',
      message: 'Field "x" can\'t be queried',
      requestId: 'req-422',
      details,
    });
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('a non-JSON error body (proxy 502 page) still yields a typed error', async () => {
    mockFetch().replyText(502, '<html>Bad gateway</html>');
    const err = (await caught(client.api('/api/tasks'))) as InstanceType<ClientModule['ApiError']>;
    expect(err).toMatchObject({ status: 502, code: 'http_502', message: 'HTTP 502' });
    expect(err.requestId).toBeUndefined();
  });

  it('a network failure becomes ApiError(0, "network")', async () => {
    mockFetch().fail(new TypeError('Failed to fetch'));
    const err = (await caught(client.api('/api/tasks'))) as InstanceType<ClientModule['ApiError']>;
    expect(err).toBeInstanceOf(client.ApiError);
    expect(err).toMatchObject({ status: 0, code: 'network' });
    expect(err.message).toMatch(/reach the DevHQ API/);
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('an abort is re-thrown untouched so callers can ignore it', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    mockFetch().fail(abort);
    const controller = new AbortController();
    expect(await caught(client.api('/api/tasks', { signal: controller.signal }))).toBe(abort);
  });

  // FINDING F-FE-5: the backend ends sessions with codes the client does not
  // treat as "session ended". auth/sessions.ts revokes the session and returns
  // 401 `session_context_changed` (user-agent change) and `invalid_token`
  // (bad/rotated HMAC); middleware/authenticate.ts returns 401
  // `account_inactive` for a deactivated member. The client's SESSION_ENDED set
  // (api/client.ts) omits all three, so the sign-out handler never fires and
  // the UI keeps a dead session, failing every call with 401.
  for (const code of ['session_context_changed', 'invalid_token', 'account_inactive']) {
    it.fails(`401 ${code} signs the user out (F-FE-5)`, async () => {
      mockFetch().reply(401, apiError(code));
      await caught(client.api('/api/tasks'));
      expect(signedOut).toHaveBeenCalledTimes(1);
    });
  }
});
