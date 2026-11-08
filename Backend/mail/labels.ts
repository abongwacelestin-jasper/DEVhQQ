/**
 * Human wording for everything an email shows: product display names, enum
 * labels with a colour tone, first names and dates. Raw enum values
 * (`high`, `in-progress`, `investigating`) never reach a recipient; an
 * unknown value is humanised rather than shown as-is.
 *
 * The labels match the web app (Frontend/src/utils/status.ts and
 * Frontend/src/data/portfolio.ts).
 */

import type { Tone } from './layout.ts';

export interface Label {
  label: string;
  tone: Tone;
}

/** Display names, as the app shows them. */
export const PRODUCT_NAMES: Record<string, string> = {
  renewberry: 'RenewBerry',
  blog: 'Blog',
  mirror: 'Mirror Acture',
};

export interface ProductRef {
  /** Product id when known (it selects the product mark). */
  id?: string;
  name: string;
}

/** Accepts a product id (`renewberry`) or a display name (`RenewBerry`, `Renewberry`). */
export function product(p: string): ProductRef {
  const key = p.trim().toLowerCase();
  if (PRODUCT_NAMES[key]) return { id: key, name: PRODUCT_NAMES[key] };
  const byName = Object.entries(PRODUCT_NAMES).find(([, n]) => n.toLowerCase() === key);
  if (byName) return { id: byName[0], name: byName[1] };
  return { name: humanize(p) };
}

/** `in-progress` → `In progress`; `SEV1` stays as it is. */
export function humanize(v: string): string {
  const s = v.trim().replace(/[-_]+/g, ' ');
  if (/^[A-Z0-9 ]+$/.test(s)) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function lookup(table: Record<string, Label>, v: string): Label {
  return table[v.trim().toLowerCase()] ?? { label: humanize(v), tone: 'neutral' };
}

const PRIORITY: Record<string, Label> = {
  urgent: { label: 'Urgent', tone: 'bad' },
  high: { label: 'High', tone: 'warn' },
  medium: { label: 'Medium', tone: 'neutral' },
  low: { label: 'Low', tone: 'neutral' },
};

const TASK_STATUS: Record<string, Label> = {
  backlog: { label: 'Backlog', tone: 'neutral' },
  todo: { label: 'To do', tone: 'neutral' },
  'in-progress': { label: 'In progress', tone: 'info' },
  review: { label: 'In review', tone: 'accent' },
  done: { label: 'Done', tone: 'ok' },
};

const SEVERITY: Record<string, Label> = {
  sev1: { label: 'SEV1 · Critical', tone: 'bad' },
  sev2: { label: 'SEV2 · Major', tone: 'warn' },
  sev3: { label: 'SEV3 · Minor', tone: 'info' },
};

const INCIDENT_STATUS: Record<string, Label> = {
  investigating: { label: 'Investigating', tone: 'bad' },
  identified: { label: 'Identified', tone: 'warn' },
  monitoring: { label: 'Monitoring', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'ok' },
};

const ENVIRONMENT: Record<string, Label> = {
  production: { label: 'Production', tone: 'warn' },
  staging: { label: 'Staging', tone: 'info' },
};

export const priorityLabel = (v: string) => lookup(PRIORITY, v);
export const taskStatusLabel = (v: string) => lookup(TASK_STATUS, v);
export const severityLabel = (v: string) => lookup(SEVERITY, v);
export const incidentStatusLabel = (v: string) => lookup(INCIDENT_STATUS, v);
export const environmentLabel = (v: string) => lookup(ENVIRONMENT, v);

/** "Kofi Mensah" → "Kofi"; a single word stays whole. */
export function firstName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[0] : name.trim();
}

// ─── dates ───────────────────────────────────────────────────────────────

function fmt(d: Date, opts: Intl.DateTimeFormatOptions, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: timeZone || 'UTC' }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(d);
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar day (`YYYY-MM-DD`) of an instant in a time zone; date-only strings are taken as given. */
function calendarDay(at: string | number | Date, timeZone?: string): string | undefined {
  if (typeof at === 'string' && DATE_ONLY.test(at)) return at;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return undefined;
  return fmt(d, { year: 'numeric', month: '2-digit', day: '2-digit' }, timeZone)
    .split('/')
    .reverse()
    .join('-');
}

/** "in 7 days", "tomorrow", "today", "yesterday", "3 days ago". */
export function relativeDays(
  at: string | number | Date,
  now: string | number | Date,
  timeZone?: string,
): string | undefined {
  const a = calendarDay(at, timeZone);
  const b = calendarDay(now, timeZone);
  if (!a || !b) return undefined;
  const days = Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000,
  );
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/**
 * "Sat 14 Nov 2026", plus " · in 7 days" when `now` is given. Date-only
 * strings (a task's due date) are calendar days and are not shifted by the
 * time zone; instants are shown in the member's zone when known.
 */
export function formatDay(
  at: string | number | Date,
  opts: { timeZone?: string; now?: string | number | Date } = {},
): string {
  const dateOnly = typeof at === 'string' && DATE_ONLY.test(at);
  const d = new Date(dateOnly ? `${at as string}T12:00:00Z` : at);
  if (Number.isNaN(d.getTime())) return String(at);
  const day = fmt(
    d,
    { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
    dateOnly ? 'UTC' : opts.timeZone,
  ).replace(/,/g, '');
  const rel = opts.now !== undefined ? relativeDays(at, opts.now, opts.timeZone) : undefined;
  return rel ? `${day} · ${rel}` : day;
}

/** "Sat 7 Nov 2026, 15:03 WAT" in the member's time zone when known (UTC otherwise). */
export function formatInstant(at: string | number | Date, timeZone?: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return String(at);
  const day = fmt(
    d,
    { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
    timeZone,
  ).replace(/,/g, '');
  const time = fmt(d, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }, timeZone);
  return `${day}, ${time}`;
}

/** "15:03" in the member's time zone. */
export function formatTime(at: string | number | Date, timeZone?: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return String(at);
  return fmt(d, { hour: '2-digit', minute: '2-digit' }, timeZone);
}
