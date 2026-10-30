import type { RoleKey } from '../data/roles';

export type SessionEventKind =
  'start' | 'mfa' | 'idle-warning' | 'lock' | 'unlock' | 'hidden' | 'visible' | 'end';
export type SessionEndReason =
  'signed-out' | 'tab-closed' | 'revoked' | 'expired' | 'account-closed';

export interface SessionEvent {
  at: string;
  kind: SessionEventKind;
  note?: string;
}

/** One sign-in, tracked from the moment it starts until it is closed. */
export interface SessionRecord {
  id: string;
  memberId: string;
  roleKey: RoleKey;
  method: 'demo' | 'password' | 'sso';
  device: string;
  location: string;
  ip: string;
  startedAt: string;
  lastSeenAt: string;
  endedAt?: string;
  endReason?: SessionEndReason;
  /** Milliseconds spent locked or idle. */
  idleMs: number;
  events: SessionEvent[];
}
