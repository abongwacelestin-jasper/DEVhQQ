/**
 * Persistent sign-in history that still behaves like the array routes use
 * (`db.signIns.filter(…)`, `.unshift(rec)`, `.length = 2000`).
 *
 * Every record added with `unshift`/`push` is written to the `signIns`
 * collection (append-only in practice: records are never edited). Memory holds
 * a bounded, newest-first window; truncating the array only trims that window,
 * the database keeps the full history. On boot the window is rebuilt from the
 * newest persisted rows.
 */

import type { SignInRecord } from '../types.ts';
import { createCollection } from './collection.ts';

/** Rows kept in memory (and loaded at boot). Matches the routes' own cap. */
export const SIGN_IN_WINDOW = 2000;

const store = createCollection<SignInRecord>('signIns', {
  hydrateLimit: SIGN_IN_WINDOW,
  onHydrate: (rows) => signInLog.replaceWith(rows.map(([, r]) => r)),
});

export class SignInLog extends Array<SignInRecord> {
  // Derived arrays (filter/map/slice) are plain arrays, never persisted logs.
  static override get [Symbol.species]() {
    return Array;
  }

  override unshift(...items: SignInRecord[]): number {
    for (const r of items) persist(r);
    const n = super.unshift(...items);
    trim(this);
    return n;
  }

  override push(...items: SignInRecord[]): number {
    for (const r of items) persist(r);
    const n = super.push(...items);
    trim(this);
    return n;
  }

  /** Rebuilds the window from persisted rows (newest first) without re-writing them. */
  replaceWith(rows: SignInRecord[]) {
    const sorted = [...rows].sort((a, b) => b.at.localeCompare(a.at));
    this.length = 0;
    super.push(...sorted.slice(0, SIGN_IN_WINDOW));
    // The window lives in this array; the collection is only a write-through.
    for (const key of [...store.keys()]) store.evict(key);
  }
}

function persist(r: SignInRecord) {
  store.set(r.id, r);
  store.evict(r.id); // persisted; memory copy lives in the array window
}

function trim(log: SignInLog) {
  if (log.length > SIGN_IN_WINDOW) log.length = SIGN_IN_WINDOW;
}

export const signInLog = new SignInLog();
