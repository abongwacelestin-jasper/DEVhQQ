/**
 * Just-in-time production access in the web app.
 *
 * The server decides: production-impacting actions answer `403
 * elevation_required` with the scope (`production:<product>`) when the member
 * holds no approved, unexpired grant. The app only offers to request one, shows
 * what is pending or active, and lets approvers decide — always through the
 * grant API (`/api/access/grants*`), never by changing local state alone.
 *
 * Opening the request dialog and refreshing grant lists are signalled through
 * this small module so pages need no extra provider.
 */
import { api } from '../../api/client';
import type { ApiGrant, ApiProduct } from '../../api/types';

/** Durations the API accepts (15–480 minutes). */
export const GRANT_DURATIONS = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 480, label: '8 hours' },
] as const;

export const REASON_MIN = 10;
export const REASON_MAX = 500;

/** Roles that may approve a grant (Backend/auth/jit.ts APPROVER_ROLES). */
export const APPROVER_ROLES = ['Owner', 'Operations'];

export function productionScope(product: ApiProduct | string): string {
  return `production:${product}`;
}

/** A grant that is approved and whose time-box has not elapsed by `now`. */
export function isLive(g: ApiGrant, now = Date.now()): boolean {
  return g.status === 'active' && (g.expiresAt ?? 0) > now;
}

/** "42 min left", "1 h 05 min left", "expired". */
export function timeLeft(expiresAt: number | undefined, now = Date.now()): string {
  const ms = (expiresAt ?? 0) - now;
  if (ms <= 0) return 'expired';
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} min left`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')} min left` : `${h} h left`;
}

export function durationLabel(ms: number): string {
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} min` : `${Math.round((min / 60) * 10) / 10} h`;
}

export function myGrants(signal?: AbortSignal): Promise<ApiGrant[]> {
  return api<ApiGrant[]>('/api/access/grants/mine', { signal });
}

export function requestGrant(input: {
  scope: string;
  reason: string;
  durationMinutes: number;
}): Promise<ApiGrant> {
  return api<ApiGrant>('/api/access/grants', { method: 'POST', body: input });
}

export function decideGrant(id: string, decision: 'approve' | 'revoke'): Promise<ApiGrant> {
  return api<ApiGrant>(`/api/access/grants/${encodeURIComponent(id)}/${decision}`, {
    method: 'POST',
  });
}

// ── signals ─────────────────────────────────────────────────────────
export interface AccessRequestIntent {
  scope: string;
  /** What the member tried to do, shown in the dialog ("Approving this deploy …"). */
  message?: string;
}

const openers = new Set<(intent: AccessRequestIntent) => void>();
const changed = new Set<() => void>();

/** Opens the "Request production access" dialog (rendered by JitAccessHost). */
export function openAccessRequest(intent: AccessRequestIntent): void {
  openers.forEach((fn) => fn(intent));
}

export function onAccessRequest(fn: (intent: AccessRequestIntent) => void): () => void {
  openers.add(fn);
  return () => openers.delete(fn);
}

/** Tell every grant list on screen to re-read (after a request, approval or revocation). */
export function grantsChanged(): void {
  changed.forEach((fn) => fn());
}

export function onGrantsChanged(fn: () => void): () => void {
  changed.add(fn);
  return () => changed.delete(fn);
}
