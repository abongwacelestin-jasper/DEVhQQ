/**
 * B-COLLAB persisted collections (Wave 4 persistence seam, store/collection.ts).
 * Handlers stay synchronous; in-place mutations are followed by `.save(key)`.
 * Notifications moved to the relational data layer (`repos.notifications`,
 * data/notifications.ts, ADR 0011).
 */

import { createCollection } from '../../store/collection.ts';
import { db } from '../../store/db.ts';
import { repos } from '../../data/index.ts';
import type { Member } from '../../types.ts';
import type {
  Channel,
  ChannelRead,
  DocComment,
  DocVersion,
  Message,
  NdaSignature,
  RecoveryToken,
  Resignation,
  WorkspaceRecord,
} from './types.ts';

export const channels = createCollection<Channel>('collab_channels');
export const messages = createCollection<Message>('collab_messages');
/** Keyed `${memberId}:${channelId}`. */
export const channelReads = createCollection<ChannelRead>('collab_channel_reads');
export const workspaces = createCollection<WorkspaceRecord>('collab_workspaces');
export const ndaSignatures = createCollection<NdaSignature>('collab_nda_signatures');
/** Keyed by token hash. */
export const recoveryTokens = createCollection<RecoveryToken>('collab_recovery_tokens');
/** Keyed by resignation id. */
export const resignations = createCollection<Resignation>('collab_resignations');
export const docVersions = createCollection<DocVersion>('collab_doc_versions');
export const docComments = createCollection<DocComment>('collab_doc_comments');

/** Writes a changed member back (members are repository rows, ADR 0011). */
export function saveMember(m: Member): Promise<void> {
  return repos.members.put(m);
}

/** Same as saveMember, for in-place doc mutations (restore / explicit save). */
export function saveDoc(id: string) {
  const docs: Map<string, unknown> & { save?: (key: string) => void } = db.docs;
  docs.save?.(id);
}

/** Monotonic, sortable ids: time prefix + random suffix. */
let lastMs = 0;
let counter = 0;
export function sortableId(prefix: string): string {
  const now = Date.now();
  counter = now === lastMs ? counter + 1 : 0;
  lastMs = now;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${now.toString(36).padStart(9, '0')}${counter.toString(36).padStart(3, '0')}${rand}`;
}
