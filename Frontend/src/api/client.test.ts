import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockFetch } from '../test/fetchMock';

type ClientModule = typeof import('./client');

/** Fresh module per test: the client keeps its handlers in module state. */
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

  // Contract change (wave 4, F-SEC): browser sessions are cookie-only. The
  // client no longer sends X-DevHQ-Client or a bearer token and never reads a
  // token from a response body; credentials are same-origin only.
  it('GETs JSON with same-origin credentials, no client header, no token, no content type', async () => {
    const f = mockFetch().reply(200, { items: [1, 2] });
    await expect(client.api('/api/tasks')).resolves.toEqual({ items: [1, 2] });
    expect(f.calls).toHaveLength(1);
    const c = f.calls[0];
    expect(c.url).toBe('/api/tasks');
    expect(c.method).toBe('GET');
    expect(c.init?.credentials).toBe('same-origin');
    expect(c.headers['x-devhq-client']).toBeUndefined();
    expect(c.headers.accept).toBe('application/json');
    expect(c.headers['content-type']).toBeUndefined();
    expect(c.headers.authorization).toBeUndefined();
  });

  it('never stores a token from a response body in JS-readable storage', async () => {
    mockFetch().reply(200, { ok: true, token: 'leaked-if-stored' });
    await client.api('/api/auth/demo', { method: 'POST', body: { role: 'pm' } });
    const stored = [...Object.keys(sessionStorage), ...Object.keys(localStorage)].map(
      (k) => `${k}=${sessionStorage.getItem(k) ?? localStorage.getItem(k)}`,
    );
    expect(stored.join(';')).not.toContain('leaked-if-stored');
    expect('setToken' in client).toBe(false);
    expect('getToken' in client).toBe(false);
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
  let signedOut: ReturnType<typeof vi.fn<() => void>>;
  let stepUp: ReturnType<typeof vi.fn<(cause: unknown) => Promise<boolean>>>;

  beforeEach(async () => {
    client = await loadClient();
    signedOut = vi.fn();
    stepUp = vi.fn(async () => false);
    client.setAuthHandlers({ signedOut });
    client.setAuthHandlers({ stepUp }); // merged, not replaced
  });

  it.each([
    'unauthenticated',
    'invalid_token',
    'session_revoked',
    'session_expired',
    'session_context_changed',
    'account_inactive',
  ])(
    '401 %s ends the session: sign-out handler fires',
    async (code) => {
      mockFetch().reply(401, apiError(code, 'Session ended', undefined, 'req-9'));
      const e = await caught(client.api('/api/tasks'));
      expect(e).toBeInstanceOf(client.ApiError);
      const err = e as InstanceType<ClientModule['ApiError']>;
      expect(err).toMatchObject({
        status: 401,
        code,
        message: 'Session ended',
        requestId: 'req-9',
      });
      expect(err.isSessionEnded).toBe(true);
      expect(signedOut).toHaveBeenCalledTimes(1);
      expect(stepUp).not.toHaveBeenCalled();
    },
  );

  it('401 mfa_required (password-only session mid sign-in) does not sign the user out', async () => {
    mockFetch().reply(401, apiError('mfa_required', 'Complete MFA to continue'));
    const e = await caught(client.api('/api/tasks'));
    expect(e).toBeInstanceOf(client.ApiError);
    const err = e as InstanceType<ClientModule['ApiError']>;
    expect(err).toMatchObject({ status: 401, code: 'mfa_required' });
    expect(err.isSessionEnded).toBe(false);
    expect(signedOut).not.toHaveBeenCalled();
    expect(stepUp).not.toHaveBeenCalled();
  });

  it('401 step_up_required opens re-verification, then retries the request once verified', async () => {
    stepUp.mockResolvedValueOnce(true);
    const f = mockFetch().reply(401, apiError('step_up_required')).reply(200, { id: 'm2' });
    await expect(
      client.api('/api/team/m2', { method: 'PATCH', body: { role: 'Tester' } }),
    ).resolves.toEqual({
      id: 'm2',
    });
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]).toMatchObject({ method: 'PATCH', body: { role: 'Tester' } });
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('a cancelled step-up rejects with step_up_cancelled and does not retry', async () => {
    const f = mockFetch().reply(401, apiError('step_up_required', 'x', undefined, 'req-su'));
    const err = (await caught(
      client.api('/api/team/m2', { method: 'PATCH', body: {} }),
    )) as InstanceType<ClientModule['ApiError']>;
    expect(err).toMatchObject({ status: 401, code: 'step_up_cancelled', requestId: 'req-su' });
    expect(err.isSessionEnded).toBe(false);
    expect(f.calls).toHaveLength(1);
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('a retry that needs step-up again is not looped', async () => {
    stepUp.mockResolvedValue(true);
    const f = mockFetch()
      .reply(401, apiError('step_up_required'))
      .reply(401, apiError('step_up_required'));
    const err = (await caught(client.api('/api/backups', { method: 'POST' }))) as InstanceType<
      ClientModule['ApiError']
    >;
    expect(err.code).toBe('step_up_required');
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(f.calls).toHaveLength(2);
  });

  it('concurrent step-up refusals share one re-verification prompt', async () => {
    let release: (v: boolean) => void = () => undefined;
    stepUp.mockImplementation(() => new Promise<boolean>((r) => (release = r)));
    const f = mockFetch();
    f.reply(401, apiError('step_up_required')).reply(401, apiError('step_up_required'));
    f.reply(200, { a: 1 }).reply(200, { b: 2 });
    const both = Promise.all([client.api('/api/a'), client.api('/api/b')]);
    await vi.waitFor(() => expect(stepUp).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    release(true);
    const results = await both;
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
  });

  it('without a step-up handler the request is reported as cancelled', async () => {
    const bare = await loadClient();
    mockFetch().reply(401, apiError('step_up_required'));
    const err = (await caught(bare.api('/api/x'))) as InstanceType<ClientModule['ApiError']>;
    expect(err.code).toBe('step_up_cancelled');
  });

  it('401 with the X-Step-Up-Required header and no code is treated as step-up', async () => {
    mockFetch().reply(401, {}, { 'X-Step-Up-Required': '1' });
    const err = (await caught(client.api('/api/x', { method: 'POST', body: {} }))) as InstanceType<
      ClientModule['ApiError']
    >;
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(err.code).toBe('step_up_cancelled');
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('an explicit error code wins over the X-Step-Up-Required header', async () => {
    mockFetch().reply(401, apiError('mfa_invalid'), { 'X-Step-Up-Required': '1' });
    const err = (await caught(
      client.api('/api/auth/step-up', { method: 'POST', body: { code: '1' } }),
    )) as InstanceType<ClientModule['ApiError']>;
    expect(err.code).toBe('mfa_invalid');
    expect(stepUp).not.toHaveBeenCalled();
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('a 403 never signs out or prompts', async () => {
    mockFetch().reply(403, apiError('forbidden', 'Requires manage on Deployment'));
    const err = (await caught(
      client.api('/api/deployments/d1/approve', { method: 'POST' }),
    )) as InstanceType<ClientModule['ApiError']>;
    expect(err.status).toBe(403);
    expect(err.isSessionEnded).toBe(false);
    expect(signedOut).not.toHaveBeenCalled();
    expect(stepUp).not.toHaveBeenCalled();
  });

  it('silent requests suppress both reactions but still reject', async () => {
    mockFetch().reply(401, apiError('session_expired')).reply(401, apiError('step_up_required'));
    await caught(client.api('/api/auth/session', { silent: true }));
    await caught(client.api('/api/auth/step-up', { silent: true }));
    expect(signedOut).not.toHaveBeenCalled();
    expect(stepUp).not.toHaveBeenCalled();
  });

  it('422 carries code, message, request id and validation details', async () => {
    const details = { allowed: ['key', 'title'] };
    mockFetch().reply(
      422,
      apiError('field_not_allowed', 'Field "x" can\'t be queried', details, 'req-422'),
    );
    const err = (await caught(
      client.api('/api/_query', { method: 'POST', body: {} }),
    )) as InstanceType<ClientModule['ApiError']>;
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
    expect(err.message).toMatch(/reach DevHQ/);
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('an abort is re-thrown untouched so callers can ignore it', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    mockFetch().fail(abort);
    const controller = new AbortController();
    expect(await caught(client.api('/api/tasks', { signal: controller.signal }))).toBe(abort);
  });

  // F-FE-5 (phase 1) is fixed on the merged branch: these codes now end the session.
  it.each(['session_context_changed', 'invalid_token', 'account_inactive'])(
    '401 %s signs the user out (F-FE-5, fixed)',
    async (code) => {
      mockFetch().reply(401, apiError(code));
      await caught(client.api('/api/tasks'));
      expect(signedOut).toHaveBeenCalledTimes(1);
    },
  );
});

describe('api() — step-up with an abort signal', () => {
  it('aborting while the re-verification dialog is open rejects with AbortError and does not retry', async () => {
    const client = await loadClient();
    let release: (v: boolean) => void = () => undefined;
    client.setAuthHandlers({ stepUp: () => new Promise<boolean>((r) => (release = r)) });
    const f = mockFetch().reply(401, apiError('step_up_required'));
    const controller = new AbortController();
    const p = client.api('/api/backups', { method: 'POST', signal: controller.signal });
    await vi.waitFor(() => expect(f.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    const e = await caught(p);
    expect((e as Error).name).toBe('AbortError');
    release(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls).toHaveLength(1);
  });

  it('with a live signal, a verified step-up still retries', async () => {
    const client = await loadClient();
    client.setAuthHandlers({ stepUp: async () => true });
    mockFetch().reply(401, apiError('step_up_required')).reply(200, { ok: 1 });
    await expect(client.api('/api/x', { signal: new AbortController().signal })).resolves.toEqual({
      ok: 1,
    });
  });

  it('a step-up handler that throws rejects the caller with that error', async () => {
    const client = await loadClient();
    const boom = new Error('dialog crashed');
    client.setAuthHandlers({ stepUp: async () => Promise.reject(boom) });
    mockFetch().reply(401, apiError('step_up_required'));
    expect(await caught(client.api('/api/x', { signal: new AbortController().signal }))).toBe(boom);
  });

  it('an already-aborted signal rejects immediately', async () => {
    const client = await loadClient();
    client.setAuthHandlers({ stepUp: async () => true });
    const controller = new AbortController();
    const f = mockFetch().reply(401, apiError('step_up_required'));
    const fetchMockFn = f.fn;
    fetchMockFn.mockImplementationOnce(async () => {
      controller.abort();
      return new Response(JSON.stringify(apiError('step_up_required')), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    });
    expect(
      ((await caught(client.api('/api/x', { signal: controller.signal }))) as Error).name,
    ).toBe('AbortError');
  });
});

describe('client helpers', () => {
  it('isSameOrigin accepts relative and same-origin URLs only', async () => {
    const { isSameOrigin } = await loadClient();
    expect(isSameOrigin('/api/files/1')).toBe(true);
    expect(isSameOrigin(`${window.location.origin}/x`)).toBe(true);
    expect(isSameOrigin('https://evil.example/x')).toBe(false);
    expect(isSameOrigin('//evil.example/x')).toBe(false);
    expect(isSameOrigin('http://[::1')).toBe(false);
  });

  it('isUnavailable covers 404/501/503 and integration_unconfigured', async () => {
    const { ApiError } = await loadClient();
    for (const [status, code, want] of [
      [404, 'not_found', true],
      [501, 'x', true],
      [503, 'x', true],
      [400, 'integration_unconfigured', true],
      [500, 'internal', false],
      [403, 'forbidden', false],
    ] as const)
      expect(new ApiError(status, code, 'm').isUnavailable, `${status} ${code}`).toBe(want);
  });

  it('readBody tolerates empty and non-JSON bodies', async () => {
    const { readBody } = await loadClient();
    expect(await readBody(new Response(''))).toEqual({ text: '', body: null });
    expect(await readBody(new Response('<html>'))).toEqual({ text: '<html>', body: null });
    expect(await readBody(new Response('{"a":1}'))).toEqual({ text: '{"a":1}', body: { a: 1 } });
  });
});
