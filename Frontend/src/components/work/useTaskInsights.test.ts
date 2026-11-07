import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockFetch } from '../../test/fetchMock';

type Mod = typeof import('./useTaskInsights');

/** The hook caches per module; a fresh module per test keeps tests independent. */
async function load(): Promise<Mod> {
  vi.resetModules();
  return import('./useTaskInsights');
}

const modelBody = {
  key: 'RB-1',
  source: 'model',
  eta: { p10: 1, p50: 3, p90: 6, date: '2026-11-10' },
  overdue: { probability: 0.42, drivers: ['estimate'] },
  models: [
    { name: 'task-eta', version: '3' },
    { name: 'overdue', version: '1' },
  ],
};

describe('useTaskInsights — toInsight mapping', () => {
  let mod: Mod;
  beforeEach(async () => {
    mod = await load();
  });

  it('maps the server shape to the compact insight', async () => {
    const f = mockFetch().reply(200, modelBody);
    const { result } = renderHook(() => mod.useTaskInsights(['RB-1']));
    await waitFor(() => expect(result.current.get('RB-1')).toBeDefined());
    expect(result.current.get('RB-1')).toEqual({
      key: 'RB-1',
      etaDays: 3,
      eta: '2026-11-10',
      overdueRisk: 0.42,
      source: 'model',
      model: 'task-eta@3',
    });
    expect(f.calls[0].url).toBe('/api/insights/tasks/RB-1');
    expect(result.current.available).toBe(true);
  });

  it('accepts heuristic and demo sources without models or ETA', async () => {
    mockFetch()
      .route('GET', '/api/insights/tasks/A-1', 200, {
        source: 'heuristic',
        overdue: { probability: 0.1 },
      })
      .route('GET', '/api/insights/tasks/A-2', 200, {
        source: 'demo',
        overdue: { probability: 0 },
        eta: { p50: 'x' },
      });
    const { result } = renderHook(() => mod.useTaskInsights(['A-1', 'A-2']));
    await waitFor(() => expect(result.current.get('A-2')).toBeDefined());
    expect(result.current.get('A-1')).toEqual({
      key: 'A-1',
      etaDays: undefined,
      eta: undefined,
      overdueRisk: 0.1,
      source: 'heuristic',
      model: undefined,
    });
    expect(result.current.get('A-2')?.etaDays).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an unknown source', { source: 'guess', overdue: { probability: 0.5 } }],
    ['no overdue probability', { source: 'model', overdue: {} }],
    ['a non-numeric probability', { source: 'model', overdue: { probability: '0.5' } }],
  ])('rejects %s (no insight shown)', async (_label, body) => {
    const f = mockFetch().reply(200, body);
    const { result } = renderHook(() => mod.useTaskInsights(['RB-9']));
    await waitFor(() => expect(f.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.get('RB-9')).toBeUndefined();
    expect(result.current.available).toBe(true);
  });
});

describe('useTaskInsights — fetching and availability', () => {
  let mod: Mod;
  beforeEach(async () => {
    mod = await load();
  });

  it('caches per key: a re-render or second consumer does not refetch', async () => {
    const f = mockFetch().route('GET', '/api/insights/tasks/RB-1', 200, modelBody);
    const first = renderHook(() => mod.useTaskInsights(['RB-1']));
    await waitFor(() => expect(first.result.current.get('RB-1')).toBeDefined());
    first.rerender();
    const second = renderHook(() => mod.useTaskInsights(['RB-1']));
    expect(second.result.current.get('RB-1')?.overdueRisk).toBe(0.42);
    expect(f.calls).toHaveLength(1);
  });

  it('URL-encodes the key', async () => {
    const f = mockFetch().reply(200, modelBody);
    renderHook(() => mod.useTaskInsights(['A/B 1']));
    await waitFor(() => expect(f.calls).toHaveLength(1));
    expect(f.calls[0].url).toBe('/api/insights/tasks/A%2FB%201');
  });

  it('requests are silent: a 401 never triggers sign-out or step-up from a badge', async () => {
    const client = await import('../../api/client'); // same module graph as `mod`
    const signedOut = vi.fn();
    const stepUp = vi.fn(async () => true);
    client.setAuthHandlers({ signedOut, stepUp });
    const f = mockFetch()
      .route('GET', '/api/insights/tasks/S-1', 401, apiError('session_expired'))
      .route('GET', '/api/insights/tasks/S-2', 401, apiError('step_up_required'));
    renderHook(() => mod.useTaskInsights(['S-1', 'S-2']));
    await waitFor(() => expect(f.calls).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(signedOut).not.toHaveBeenCalled();
    expect(stepUp).not.toHaveBeenCalled();
  });

  it('a 503 marks the feature unavailable and stops all further requests', async () => {
    const f = mockFetch().reply(503, apiError('integration_unconfigured'));
    const { result, rerender } = renderHook(({ keys }) => mod.useTaskInsights(keys), {
      initialProps: { keys: ['RB-1'] },
    });
    await waitFor(() => expect(result.current.available).toBe(false));
    rerender({ keys: ['RB-1', 'RB-2', 'RB-3'] });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls).toHaveLength(1);
    expect(result.current.get('RB-1')).toBeUndefined();
  });

  it('other errors hide only that task and are not retried', async () => {
    const f = mockFetch()
      .route('GET', '/api/insights/tasks/OK-1', 200, modelBody)
      .route('GET', '/api/insights/tasks/BAD-1', 500, apiError('internal'));
    const { result, rerender } = renderHook(({ keys }) => mod.useTaskInsights(keys), {
      initialProps: { keys: ['OK-1', 'BAD-1'] },
    });
    await waitFor(() => expect(result.current.get('OK-1')).toBeDefined());
    expect(result.current.get('BAD-1')).toBeUndefined();
    expect(result.current.available).toBe(true);
    rerender({ keys: ['BAD-1', 'OK-1'] });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls).toHaveLength(2);
  });

  it('fetches at most four at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchFn = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(JSON.stringify(modelBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchFn);
    const keys = Array.from({ length: 10 }, (_, i) => `K-${i}`);
    const { result } = renderHook(() => mod.useTaskInsights(keys));
    await waitFor(() => expect(result.current.get('K-9')).toBeDefined());
    expect(fetchFn).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('no keys → no requests', async () => {
    const f = mockFetch();
    renderHook(() => mod.useTaskInsights([]));
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls).toHaveLength(0);
  });
});
