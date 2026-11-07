import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { isUnavailable } from './apiState';

/**
 * ML task insights from the backend bridge (WAVE4 §6, ML lane):
 *
 *   GET /api/insights/tasks/:key → TaskInsight
 *
 * Results are cached per task key for the page's life and fetched a few at a
 * time. The first `404`/`503` marks the feature unavailable for the session,
 * so no further requests are made and the UI hides itself entirely.
 */
export interface TaskInsight {
  key: string;
  /** Predicted days until done, when the model gives one. */
  etaDays?: number;
  /** Predicted completion date (ISO), when the model gives one. */
  eta?: string;
  /** 0..1 probability the task finishes after its due date. */
  overdueRisk: number;
  source: 'model' | 'heuristic' | 'demo';
  model?: string;
}

const cache = new Map<string, TaskInsight | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let unavailable = false;
const CONCURRENCY = 4;

function notify() {
  listeners.forEach((l) => l());
}

/**
 * Maps the server's shape (Backend/routes/insights.routes.ts):
 *   { source, eta: { p10, p50, p90, date }, overdue: { probability, drivers }, models? }
 * to the compact TaskInsight the badges render. Returns null for anything else.
 */
function toInsight(v: unknown, key: string): TaskInsight | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const source = o.source;
  if (source !== 'model' && source !== 'heuristic' && source !== 'demo') return null;
  const overdue = o.overdue as { probability?: unknown } | undefined;
  if (typeof overdue?.probability !== 'number') return null;
  const eta = o.eta as { p50?: unknown; date?: unknown } | undefined;
  const models = Array.isArray(o.models)
    ? (o.models as { name?: unknown; version?: unknown }[])
    : [];
  const first = models.find((m) => typeof m?.name === 'string');
  return {
    key,
    etaDays: typeof eta?.p50 === 'number' ? eta.p50 : undefined,
    eta: typeof eta?.date === 'string' ? eta.date : undefined,
    overdueRisk: overdue.probability,
    source,
    model: first ? `${String(first.name)}@${String(first.version)}` : undefined,
  };
}

async function fetchBatch(keys: string[]) {
  const queue = keys.filter((k) => !cache.has(k) && !pending.has(k));
  queue.forEach((k) => pending.add(k));
  const worker = async () => {
    for (;;) {
      const key = queue.shift();
      if (!key) return;
      if (unavailable) {
        pending.delete(key);
        continue;
      }
      try {
        const body = await api<unknown>(`/api/insights/tasks/${encodeURIComponent(key)}`, {
          silent: true,
        });
        cache.set(key, toInsight(body, key));
      } catch (e) {
        if (isUnavailable(e)) unavailable = true;
        else cache.set(key, null);
      } finally {
        pending.delete(key);
      }
      notify();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  notify();
}

/** Insights for the given task keys. `available` is false once the service reported 404/503. */
export function useTaskInsights(keys: readonly string[]) {
  const [, force] = useState(0);
  const signature = keys.join('|');

  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (unavailable || !signature) return;
    void fetchBatch(signature.split('|'));
  }, [signature]);

  const get = (key: string): TaskInsight | undefined =>
    unavailable ? undefined : (cache.get(key) ?? undefined);

  return { available: !unavailable, get };
}
