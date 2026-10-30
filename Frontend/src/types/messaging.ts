import type { ProductId } from './portfolio';

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
  /** Members can add other people. */
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
  text: string;
  sticker?: string;
  code?: { lang: string; content: string };
  poll?: Poll;
  file?: { name: string; size: number; type: string };
  reactions: Record<string, string[]>;
  threadOf?: string;
  edited?: boolean;
  pinned?: boolean;
  deleted?: boolean;
}
