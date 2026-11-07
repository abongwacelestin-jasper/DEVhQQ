import { members } from '../../data/team';
import type { Tone } from '../../types/portfolio';
import type { ApiCiRunStatus } from './data/types';

/**
 * Formatting helpers for GitHub-backed rows. Timestamps from GitHub are real
 * wall-clock times, so they are measured against `Date.now()`, not the
 * workspace's simulated clock.
 */
export function ago(iso: string | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  if (m < 60 * 24 * 30) return `${Math.round(m / 1440)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function duration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** A member when the id maps to one; otherwise the raw GitHub login. Never guesses. */
export function person(id: string | undefined) {
  if (!id) return null;
  const m = members.find((x) => x.id === id);
  return m
    ? { member: true as const, id: m.id, name: m.name }
    : { member: false as const, id, name: id };
}

export const runMeta: Record<ApiCiRunStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'info' },
  passed: { label: 'Passed', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** True for `https://github.com/...`-style links the server hands us; anything else isn't rendered as a link. */
export const safeHref = (url: string | undefined) =>
  url && /^https:\/\//.test(url) ? url : undefined;

/** Detail route for a PR; the repo id rides in the query so the route stays `/pull-requests/:prNumber`. */
export const pullHref = (p: { number: number; repoId: string }) =>
  `/pull-requests/${p.number}?repo=${encodeURIComponent(p.repoId)}`;
