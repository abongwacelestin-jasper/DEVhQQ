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

function isInsight(v: unknown): v is TaskInsight {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.overdueRisk === 'number' &&
    (o.source === 'model' || o.source === 'heuristic' || o.source === 'demo')
  );
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
        cache.set(key, isInsight(body) ? { ...body, key } : null);
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
