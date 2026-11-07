import type { ChannelPermissions } from '../types/messaging';

/**
 * Messaging presentation constants. Channels and messages come from the
 * B-COLLAB API (`/api/channels`, `/api/channels/:id/messages`); no seeds here.
 */

export const defaultPermissions: Readonly<ChannelPermissions> = {
  post: 'members',
  threads: true,
  reactions: true,
  files: true,
  stickers: true,
  externalLinks: false,
  mentionAll: 'admins',
  retentionDays: 365,
  memberInvites: true,
};

export const emojiSet: readonly string[] = [
  '👍',
  '👎',
  '❤️',
  '🎉',
  '😂',
  '😮',
  '😢',
  '🙏',
  '🔥',
  '👀',
  '✅',
  '❌',
  '🚀',
  '💯',
  '🙌',
  '👋',
  '🤔',
  '😅',
  '🐛',
  '🔒',
  '⚡',
  '☕',
  '📌',
  '🧪',
  '🎯',
  '💡',
  '⏳',
  '🛠️',
  '📦',
  '🌱',
  '🥳',
  '😎',
];

export const retentionOptions: readonly number[] = [30, 90, 365, 730];
