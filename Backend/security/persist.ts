/**
 * Persists an in-place mutation of a member row.
 *
 * `db.members` is a plain Map today; the data lane (B-DATA) converts it to a
 * `Collection` from store/collection.ts, whose in-place mutations must be
 * followed by `.save(key)`. Security code calls this one helper after every
 * credential change so it is correct before and after that conversion.
 */

import { db } from '../store/db.ts';

interface Saveable {
  save(key: string): void;
}

function isSaveable(m: unknown): m is Saveable {
  return (
    typeof m === 'object' && m !== null && 'save' in m && typeof (m as Saveable).save === 'function'
  );
}

export function persistMember(memberId: string) {
  const members: unknown = db.members;
  if (isSaveable(members)) members.save(memberId);
}
