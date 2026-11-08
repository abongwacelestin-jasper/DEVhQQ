import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { mockFetch } from '../../test/fetchMock';
import {
  TURNSTILE_SCRIPT,
  getTurnstileSettings,
  resetTurnstileCache,
  type TurnstileRenderOptions,
} from '../../api/auth/turnstile';
import { useTurnstile } from './TurnstileWidget';

/** A fake window.turnstile that records render options and lets the test drive the callbacks. */
function fakeTurnstile() {
  const rendered: TurnstileRenderOptions[] = [];
  const api = {
    render: vi.fn((_el: HTMLElement, opts: TurnstileRenderOptions) => {
      rendered.push(opts);
      return `w${rendered.length}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  window.turnstile = api;
  return { api, rendered, last: () => rendered[rendered.length - 1] };
}

function Form({ onState }: { onState?: (s: ReturnType<typeof useTurnstile>) => void }) {
  const t = useTurnstile('sign-in');
  onState?.(t);
  return (
    <form>
      {t.widget}
      <output data-testid="token">{t.token ?? 'none'}</output>
      <button type="button" onClick={t.reset}>
        reset
      </button>
    </form>
  );
}

const renderForm = (onState?: (s: ReturnType<typeof useTurnstile>) => void) =>
  render(
    <ThemeProvider>
      <Form onState={onState} />
    </ThemeProvider>,
  );

beforeEach(() => resetTurnstileCache());
afterEach(() => {
  delete window.turnstile;
  document.head
    .querySelectorAll('script[src*="challenges.cloudflare.com"]')
    .forEach((s) => s.remove());
});

describe('Turnstile settings', () => {
  it('reads mode and site key from /api/auth/config', async () => {
    mockFetch().reply(200, { turnstile: { mode: 'on', siteKey: '1x00000000000000000000AA' } });
    expect(await getTurnstileSettings()).toEqual({
      mode: 'on',
      siteKey: '1x00000000000000000000AA',
    });
  });

  it('is off when the server says so, has no key, or cannot be reached', async () => {
    mockFetch()
      .reply(200, { turnstile: { mode: 'off', siteKey: null } })
      .reply(200, { turnstile: { mode: 'on', siteKey: '' } })
      .reply(404, { error: { code: 'not_found', message: 'nope' } });
    for (let i = 0; i < 3; i++) expect((await getTurnstileSettings()).mode).toBe('off');
  });
});

describe('useTurnstile / TurnstileWidget', () => {
  it('renders nothing and loads no Cloudflare script while the mode is off', async () => {
    const f = mockFetch().reply(200, { turnstile: { mode: 'off', siteKey: null } });
    renderForm();
    await waitFor(() => expect(f.calls).toHaveLength(1));
    expect(screen.queryByRole('group', { name: 'Security check' })).toBeNull();
    expect(document.querySelector(`script[src="${TURNSTILE_SCRIPT}"]`)).toBeNull();
  });

  it('injects api.js with render=explicit when on and the API is not loaded yet', async () => {
    mockFetch().reply(200, { turnstile: { mode: 'on', siteKey: 'site-key-123' } });
    renderForm();
    await waitFor(() =>
      expect(document.querySelector(`script[src="${TURNSTILE_SCRIPT}"]`)).not.toBeNull(),
    );
    expect(TURNSTILE_SCRIPT).toContain('render=explicit');
  });

  it('renders a labelled widget with the site key, action and app theme, and tracks the token', async () => {
    const ts = fakeTurnstile();
    mockFetch().reply(200, { turnstile: { mode: 'on', siteKey: 'site-key-123' } });
    renderForm();
    const group = await screen.findByRole('group', { name: 'Security check' });
    await waitFor(() => expect(ts.api.render).toHaveBeenCalledTimes(1));
    expect(ts.last()).toMatchObject({ sitekey: 'site-key-123', action: 'sign-in', theme: 'light' });
    expect(group).toHaveTextContent('Complete the security check to continue.');

    act(() => ts.last().callback('tok-1'));
    expect(screen.getByTestId('token')).toHaveTextContent('tok-1');
    expect(group).toHaveTextContent('Security check complete.');

    // Expiry clears the token (Cloudflare refreshes it on its own: refresh-expired=auto).
    act(() => ts.last()['expired-callback']());
    expect(screen.getByTestId('token')).toHaveTextContent('none');
    expect(ts.last()['refresh-expired']).toBe('auto');
  });

  it('reset() discards the token and re-runs the same widget', async () => {
    const ts = fakeTurnstile();
    mockFetch().reply(200, { turnstile: { mode: 'on', siteKey: 'k' } });
    renderForm();
    await waitFor(() => expect(ts.api.render).toHaveBeenCalled());
    act(() => ts.last().callback('tok-2'));
    act(() => screen.getByRole('button', { name: 'reset' }).click());
    expect(screen.getByTestId('token')).toHaveTextContent('none');
    expect(ts.api.reset).toHaveBeenCalledWith('w1');
  });

  it('shows a keyboard-reachable retry on error, and follows the dark theme', async () => {
    localStorage.setItem('devhq.theme', 'dark');
    const ts = fakeTurnstile();
    mockFetch().reply(200, { turnstile: { mode: 'on', siteKey: 'k' } });
    renderForm();
    await waitFor(() => expect(ts.api.render).toHaveBeenCalled());
    expect(ts.last().theme).toBe('dark');
    act(() => {
      ts.last()['error-callback']('300030');
    });
    const retry = screen.getByRole('button', { name: /try again/i });
    retry.focus();
    expect(retry).toHaveFocus();
    act(() => retry.click());
    expect(ts.api.reset).toHaveBeenCalledWith('w1');
  });

  it('removes the widget on unmount', async () => {
    const ts = fakeTurnstile();
    mockFetch().reply(200, { turnstile: { mode: 'on', siteKey: 'k' } });
    const { unmount } = renderForm();
    await waitFor(() => expect(ts.api.render).toHaveBeenCalled());
    unmount();
    expect(ts.api.remove).toHaveBeenCalledWith('w1');
  });
});
