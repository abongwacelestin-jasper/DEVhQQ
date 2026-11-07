import type { Channel, Message } from '../../types/messaging';

/**
 * Wire + view types for messaging on the B-COLLAB API
 * (`Backend/routes/messaging.routes.ts`, `Backend/domain/collab/types.ts`).
 * `types/messaging.ts` is shared read-only, so API-only fields are added here.
 */

export interface Attachment {
  fileId: string;
  name: string;
  size: number;
  contentType: string;
}

/** Client-side delivery state of an optimistic message (absent once the server confirms it). */
export type Delivery = 'sending' | 'failed';

export interface ChatMessage extends Message {
  /** Client-only tag linking an optimistic copy to the saved message. Never sent to the API. */
  nonce?: string;
  /** Attachment metadata; bytes live in object storage under `fileId`. */
  file?: { name: string; size: number; type: string; fileId?: string };
  /** Member ids the server parsed from `@memberId` tokens. */
  mentions?: string[];
  replyCount?: number;
  lastReplyAt?: string;
  editedAt?: string;
  pinnedBy?: string;
  deletedBy?: string;
  deletedAt?: string;
  delivery?: Delivery;
  deliveryError?: string;
  source?: string;
}

export interface ChatChannel extends Channel {
  joined?: boolean;
  /** Server-computed for the caller: the authority for composer/moderation affordances. */
  canPost?: boolean;
  canModerate?: boolean;
  unread?: number;
  mentions?: number;
  lastMessageAt?: string;
  lastMessage?: ChatMessage;
  lastReadAt?: string;
  source?: string;
}

/** `GET /api/channels/:id/messages` — oldest→newest page, `nextCursor` for the page before it. */
export interface MessagePage {
  items: ApiMessage[];
  nextCursor?: string | null;
  parent?: ApiMessage;
  source?: string;
}

/** Server message: same as `ChatMessage` but reactions may be omitted. */
export type ApiMessage = Omit<ChatMessage, 'reactions' | 'delivery' | 'deliveryError'> & {
  reactions?: Record<string, string[]>;
};

export type ApiChannel = Omit<ChatChannel, 'lastMessage'> & { lastMessage?: ApiMessage };

export type NewMessage = Pick<ChatMessage, 'channelId' | 'kind' | 'text'> &
  Partial<Pick<ChatMessage, 'code' | 'poll' | 'sticker' | 'threadOf'>> & {
    attachment?: Attachment;
  };

/** Exactly the fields `POST /api/channels/:id/messages` accepts (the validator rejects others). */
export function toPostBody(m: NewMessage) {
  return {
    kind: m.kind === 'system' ? 'text' : m.kind,
    ...(m.text ? { text: m.text } : {}),
    ...(m.threadOf ? { threadOf: m.threadOf } : {}),
    ...(m.code ? { code: m.code } : {}),
    ...(m.poll
      ? { poll: { question: m.poll.question, options: m.poll.options.map((o) => o.label) } }
      : {}),
    ...(m.sticker ? { sticker: m.sticker } : {}),
    ...(m.attachment
      ? {
          file: {
            name: m.attachment.name,
            size: m.attachment.size,
            type: m.attachment.contentType,
            fileId: m.attachment.fileId,
          },
        }
      : {}),
  };
}

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'off';

export function toMessage(m: ApiMessage): ChatMessage {
  return { ...m, text: m.text ?? '', reactions: m.reactions ?? {} };
}

export function toChannel(c: ApiChannel): ChatChannel {
  return {
    ...c,
    topic: c.topic ?? '',
    members: c.members ?? [],
    admins: c.admins ?? [],
    lastMessage: c.lastMessage ? toMessage(c.lastMessage) : undefined,
  };
}
