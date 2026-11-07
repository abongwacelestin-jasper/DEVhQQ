/**
 * Compatibility bridge to `data/team.ts` (owned by F-COLLAB).
 *
 * About 60 call sites still read the module-level `members` / `currentUserId`
 * bindings through `memberById()`. Until those read the directory from
 * `useAuth().directory` / `useAuth().member`, the auth layer keeps the legacy
 * bindings in step — but only from async callbacks after a server answer,
 * never during render. This file is the single place that writes them; delete
 * it once `data/team.ts` stops exporting mutable globals.
 */

import { setCurrentUserId, setMembers } from '../../data/team';
import type { Member } from '../../types/team';

const SIGNED_OUT_PLACEHOLDER = 'm1';

export function bindCurrentMember(memberId: string | null) {
  setCurrentUserId(memberId ?? SIGNED_OUT_PLACEHOLDER);
}

export function bindDirectory(list: Member[]) {
  setMembers(list);
}
