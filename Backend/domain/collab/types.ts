/**
 * Collaboration domain types (B-COLLAB). Shapes mirror the frontend
 * (types/messaging.ts, types/workspace.ts, types/docs.ts,
 * contexts/OffboardingContext.tsx) so F-COLLAB can swap local state for the API
 * without translation.
 */

import type { ProductId } from '../../types.ts';

export type ChannelKind = 'channel' | 'project' | 'announcement' | 'dm';
export type PostPolicy = 'everyone' | 'members' | 'admins';
export type ChatBackground = 'plain' | 'dots' | 'grid' | 'waves' | 'doodles' | 'paper';

export interface ChannelPermissions {
  post: PostPolicy;
  threads: boolean;
  reactions: boolean;
  files: boolean;
  stickers: boolean;
  externalLinks: boolean;
  mentionAll: 'admins' | 'everyone';
  retentionDays: number;
  memberInvites: boolean;
}

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  topic: string;
  product?: ProductId;
  projectId?: string;
  members: string[];
  admins: string[];
  private: boolean;
  createdBy: string;
  createdAt: string;
  background: ChatBackground;
  permissions: ChannelPermissions;
  archived?: boolean;
}

export type MessageKind = 'text' | 'sticker' | 'code' | 'poll' | 'file' | 'system';

export interface Poll {
  question: string;
  options: { label: string; votes: string[] }[];
  closed?: boolean;
}

export interface Message {
  id: string;
  channelId: string;
  author: string;
  at: string;
  kind: MessageKind;
  /** Plain text / markdown, stored exactly as sent. Never rendered as HTML by the server. */
  text: string;
  sticker?: string;
  code?: { lang: string; content: string };
  poll?: Poll;
  /** Attachment metadata only; bytes live in object storage (STORAGE lane, `fileId`). */
  file?: { name: string; size: number; type: string; fileId?: string };
  reactions: Record<string, string[]>;
  /** Parent message id for thread replies (accepted as `parentId` on input too). */
  threadOf?: string;
  mentions?: string[];
  edited?: boolean;
  editedAt?: string;
  pinned?: boolean;
  pinnedBy?: string;
  deleted?: boolean;
  deletedBy?: string;
  deletedAt?: string;
}

export interface ChannelRead {
  memberId: string;
  channelId: string;
  lastReadAt: string;
}

export type ModuleKey =
  'projects' | 'engineering' | 'delivery' | 'operations' | 'automation' | 'assistant';

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  color: string;
  template: string;
  modules: ModuleKey[];
  mfaRequired: boolean;
  ownerId: string;
  members: { memberId: string; role: 'owner' | 'admin' | 'member' }[];
  products: ProductId[];
  createdAt: string;
  updatedAt: string;
  pendingDeletionAt?: string;
}

export type NotificationKind =
  'mention' | 'assignment' | 'approval' | 'doc-comment' | 'offboarding' | 'security';

export interface Notification {
  id: string;
  memberId: string;
  kind: NotificationKind;
  title: string;
  /** Short plain-text excerpt — never more than 200 characters. */
  body: string;
  /** In-app path, e.g. `/messages/general?m=msg-…`. */
  link: string;
  refId: string;
  actor: string;
  at: string;
  readAt?: string;
  emailedAt?: string;
}

export interface NdaSignature {
  id: string;
  memberId: string;
  version: string;
  signedName: string;
  signedAt: string;
  ip: string;
  /** SHA-256 (hex) of the canonical agreement text for `version`. */
  textHash: string;
  commitment?: {
    hours: number;
    days: string[];
    duration: string;
    areas: string[];
    start?: string;
  };
}

export interface RecoveryToken {
  /** SHA-256 of the raw token — the raw value only ever leaves in the email. */
  hash: string;
  memberId: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
  ip: string;
}

export type ResignationStatus = 'pending' | 'accepted' | 'withdrawn' | 'completed';

export interface Resignation {
  id: string;
  memberId: string;
  lastDay: string;
  reason: string;
  note?: string;
  handoverTo: string;
  submittedAt: string;
  startedBy: string;
  status: ResignationStatus;
  decidedBy?: string;
  decidedAt?: string;
  checklist: { id: string; label: string; done: boolean; doneBy?: string; doneAt?: string }[];
  /** Filled on completion: what was actually revoked. */
  revoked?: { sessions: number; grants: number; tokens: 'revoked' | 'event-emitted' };
}

export interface DocVersion {
  id: string;
  docId: string;
  /** 1-based, increasing per doc. */
  number: number;
  at: string;
  by: string;
  summary: string;
  title: string;
  body: string;
  status: 'draft' | 'in-review' | 'published';
  /** The doc's `updatedAt` this snapshot captured — used to dedupe publish snapshots. */
  sourceUpdatedAt: string;
}

export interface DocCommentAnchor {
  /** The quoted text the comment is attached to. */
  quote: string;
  /** Character offsets into the body at the time of commenting (advisory). */
  start?: number;
  end?: number;
  /** Nearest heading, so the UI can re-anchor after edits. */
  heading?: string;
}

export interface DocComment {
  id: string;
  docId: string;
  at: string;
  by: string;
  text: string;
  anchor?: DocCommentAnchor;
  parentId?: string;
  resolved?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  editedAt?: string;
}
