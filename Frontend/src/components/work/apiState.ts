/**
 * Shared helpers for collaboration features that depend on backend modules
 * which may not be deployed yet (B-COLLAB, ML, STORAGE).
 *
 * The rule: a missing module (`404`) or an unconfigured integration (`503`)
 * is shown as a designed "unavailable" state. Nothing falls back to seed data.
 */

import { ApiError } from '../../api/client';

export type Availability = 'loading' | 'ready' | 'unavailable' | 'error';

/** `404` = route not deployed, `503` = integration unconfigured / service down. */
export function isUnavailable(e: unknown): e is ApiError {
  return e instanceof ApiError && (e.status === 404 || e.status === 503 || e.status === 501);
}

export function errorMessage(e: unknown, fallback = 'The API did not respond.') {
  if (e instanceof ApiError) return e.message || fallback;
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}

/** True for an AbortController cancellation (fetch rejects with a DOMException named AbortError). */
export function isAbort(e: unknown) {
  return e instanceof Error && e.name === 'AbortError';
}

/** Payloads from non-production fallbacks carry `source:'demo'`; the UI must badge them. */
export function isDemo(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'source' in payload &&
    (payload as { source?: unknown }).source === 'demo'
  );
}

/** Lists come back as `{items, nextCursor?}` per the WAVE4 §6 contract; tolerate bare arrays too. */
export function itemsOf<T>(body: { items: T[] } | T[] | null | undefined): T[] {
  if (!body) return [];
  return Array.isArray(body) ? body : body.items;
}
