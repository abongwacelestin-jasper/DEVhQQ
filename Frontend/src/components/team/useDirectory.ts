import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from '../../api/client';
import { toMember } from '../../api/adapters';
import type { ApiMember } from '../../api/types';
import { useAuth } from '../../contexts/AuthContext';
import type { Member } from '../../types/team';

/**
 * The member directory from `GET /api/team`, shared by every collaboration view.
 *
 * One request per signed-in member (a small external store, not a global the
 * render path writes to), so the message list, mention picker and assignment
 * modals agree on who exists without each fetching the team.
 */
interface Snapshot {
  owner: string | null;
  members: Member[];
  loading: boolean;
  error: string | null;
}

let snapshot: Snapshot = { owner: null, members: [], loading: false, error: null };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

function load(owner: string, force = false): Promise<void> {
  if (!force && snapshot.owner === owner && (snapshot.members.length || inflight)) {
    return inflight ?? Promise.resolve();
  }
  emit({
    owner,
    members: snapshot.owner === owner ? snapshot.members : [],
    loading: true,
    error: null,
  });
  const p = api<ApiMember[] | { items: ApiMember[] }>('/api/team')
    .then((body) => {
      if (snapshot.owner !== owner) return;
      const list = Array.isArray(body) ? body : body.items;
      emit({ owner, members: list.map(toMember), loading: false, error: null });
    })
    .catch((e: unknown) => {
      if (snapshot.owner !== owner) return;
      emit({
        owner,
        members: snapshot.members,
        loading: false,
        error: e instanceof Error ? e.message : "Couldn't load the team directory.",
      });
    })
    .finally(() => {
      if (inflight === p) inflight = null;
    });
  inflight = p;
  return p;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const getSnapshot = () => snapshot;

/** Placeholder for ids the directory doesn't know (deleted members, other orgs). */
export function unknownMember(id: string): Member {
  return {
    id,
    name: 'Former member',
    initials: '?',
    email: '',
    role: 'Developer',
    products: [],
    productionAccess: false,
    mfa: false,
    status: 'deactivated',
    lastActive: '—',
    openTasks: 0,
    capacity: 0,
    color: '#475569',
  };
}

export function useDirectory() {
  const { session } = useAuth();
  const owner = session?.memberId ?? null;
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!owner) {
      if (snapshot.owner !== null) emit({ owner: null, members: [], loading: false, error: null });
      return;
    }
    void load(owner);
  }, [owner]);

  const current = snap.owner === owner ? snap : null;
  const members = useMemo(() => current?.members ?? [], [current]);
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const memberById = useCallback((id: string) => byId.get(id) ?? unknownMember(id), [byId]);
  const reload = useCallback(() => (owner ? load(owner, true) : Promise.resolve()), [owner]);

  return {
    /** The signed-in member's id, or null while signed out. Never a fallback id. */
    me: owner,
    members,
    memberById,
    loading: current?.loading ?? !!owner,
    error: current?.error ?? null,
    reload,
  };
}
