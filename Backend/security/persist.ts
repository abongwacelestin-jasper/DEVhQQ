/**
 * Persists a changed member row (credentials included).
 *
 * Members live in the relational data layer (data/members.ts, ADR 0011):
 * a row read from `repos.members` is a copy, so every change must be written
 * back. Security code calls this one helper after every credential change.
 */

import { repos } from '../data/index.ts';
import type { Member } from '../types.ts';

export function persistMember(member: Member): Promise<void> {
  return repos.members.put(member);
}
