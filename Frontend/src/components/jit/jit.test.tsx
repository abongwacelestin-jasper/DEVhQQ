import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { apiError, mockFetch } from '../../test/fetchMock';
import { setupUser } from '../../test/render';
import { ApiError, api } from '../../api/client';
import { JitAccessHost } from './JitAccessHost';
import { isLive, openAccessRequest, timeLeft } from './jit';
import type { ApiGrant } from '../../api/types';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const refusal = () =>
  apiError('elevation_required', 'Request just-in-time access for production:renewberry', {
    scope: 'production:renewberry',
  });

const grant = (over: Partial<ApiGrant> = {}): ApiGrant => ({
  id: 'g1',
  memberId: 'm11',
  scope: 'production:renewberry',
  reason: 'Approve release v4.2.0',
  requestedAt: Date.now(),
  durationMs: 3_600_000,
  status: 'pending',
  ...over,
});

describe('jit helpers', () => {
  it('formats the time left and treats an elapsed grant as not live', () => {
    const now = 1_000_000;
    expect(timeLeft(now + 42 * 60_000, now)).toBe('42 min left');
    expect(timeLeft(now + 65 * 60_000, now)).toBe('1 h 05 min left');
    expect(timeLeft(now + 120 * 60_000, now)).toBe('2 h left');
    expect(timeLeft(now - 1, now)).toBe('expired');
    expect(isLive(grant({ status: 'active', expiresAt: now + 1 }), now)).toBe(true);
    expect(isLive(grant({ status: 'active', expiresAt: now }), now)).toBe(false);
    expect(isLive(grant({ status: 'revoked', expiresAt: now + 1 }), now)).toBe(false);
  });
});

describe('api() — elevation_required', () => {
  it('exposes the scope and still rejects (no retry: a grant needs approval)', async () => {
    const f = mockFetch().reply(403, refusal());
    const e = await api('/api/deployments/d-1/approve', { method: 'POST' }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).isElevationRequired).toBe(true);
    expect((e as ApiError).elevationScope).toBe('production:renewberry');
    expect(f.calls).toHaveLength(1);
  });
});

describe('JitAccessHost', () => {
  beforeEach(() => {
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it('opens "Request production access" for the refused scope and requests a grant', async () => {
    const user = setupUser();
    const f = mockFetch().route('GET', '/api/access/grants/mine', 200, []).reply(403, refusal());
    render(<JitAccessHost />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await api('/api/deployments/d-1/approve', { method: 'POST' }).catch(() => undefined);
    const dialog = await screen.findByRole('dialog', { name: 'Request production access' });
    expect(dialog).toHaveTextContent('production:renewberry');

    const submit = screen.getByRole('button', { name: 'Request access' });
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'short');
    expect(submit).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), ' — approve v4.2.0');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Duration' }), '30');

    f.reply(200, grant({ durationMs: 1_800_000 }));
    await user.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = f.calls.find((c) => c.method === 'POST' && c.url === '/api/access/grants');
    expect(post?.body).toEqual({
      scope: 'production:renewberry',
      reason: 'short — approve v4.2.0',
      durationMinutes: 30,
    });
    expect(toast.success).toHaveBeenCalledWith('Access requested', expect.anything());
  });

  it('shows the API’s refusal inline and never announces success', async () => {
    const user = setupUser();
    const f = mockFetch().route('GET', '/api/access/grants/mine', 200, []);
    render(<JitAccessHost />);
    act(() => openAccessRequest({ scope: 'production:blog' }));
    await screen.findByRole('dialog', { name: 'Request production access' });
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'Roll back the blog release');
    f.reply(403, apiError('forbidden', 'You are not assigned to this product'));
    await user.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You are not assigned');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('says so instead of offering a duplicate when a request is already pending', async () => {
    mockFetch().route('GET', '/api/access/grants/mine', 200, [grant()]);
    render(<JitAccessHost />);
    act(() => openAccessRequest({ scope: 'production:renewberry' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/waiting for approval/);
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument();
  });
});
