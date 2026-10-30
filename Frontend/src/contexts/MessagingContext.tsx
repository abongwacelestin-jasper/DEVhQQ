import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { seedChannels, seedMessages } from '../data/messaging';
import { currentUserId } from '../data/team';
import { nowISO } from '../utils/date';
import { useAuth } from './AuthContext';
import type { Channel, Message } from '../types/messaging';

type NewMessage = Omit<Message, 'id' | 'at' | 'author' | 'reactions'> & {
  reactions?: Message['reactions'];
};

interface MessagingValue {
  channels: Channel[];
  /** Channels the signed-in member may see: public ones plus private ones they belong to. */
  visible: Channel[];
  messages: Message[];
  send: (m: NewMessage) => Message;
  react: (id: string, emoji: string) => void;
  edit: (id: string, text: string) => void;
  remove: (id: string) => void;
  togglePin: (id: string) => void;
  vote: (id: string, option: number) => void;
  createChannel: (c: Omit<Channel, 'id' | 'createdAt' | 'createdBy'>) => Channel;
  updateChannel: (id: string, patch: Partial<Channel>) => void;
  join: (id: string) => void;
  leave: (id: string) => void;
  markRead: (id: string) => void;
  unread: (id: string) => number;
  mentions: (id: string) => number;
  totalUnread: number;
  canPost: (c: Channel) => boolean;
  canModerate: (c: Channel) => boolean;
}

const MessagingContext = createContext<MessagingValue | null>(null);

export function MessagingProvider({ children }: { children: React.ReactNode }) {
  const { session, canDo } = useAuth();
  const me = session?.memberId ?? currentUserId;
  const [channels, setChannels] = useState<Channel[]>(seedChannels);
  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [lastRead, setLastRead] = useState<Record<string, string>>({
    general: new Date(0).toISOString(),
  });

  const visible = useMemo(
    () =>
      channels.filter(
        (c) => !c.archived && (c.members.includes(me) || (!c.private && c.kind !== 'dm')),
      ),
    [channels, me],
  );

  const send = useCallback(
    (m: NewMessage) => {
      const msg: Message = {
        reactions: {},
        ...m,
        id: `msg${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        at: nowISO(),
        author: me,
      };
      setMessages((l) => [...l, msg]);
      setLastRead((r) => ({ ...r, [m.channelId]: msg.at }));
      return msg;
    },
    [me],
  );

  const patch = useCallback(
    (id: string, fn: (m: Message) => Message) =>
      setMessages((l) => l.map((m) => (m.id === id ? fn(m) : m))),
    [],
  );

  const react = useCallback(
    (id: string, emoji: string) =>
      patch(id, (m) => {
        const who = m.reactions[emoji] ?? [];
        const next = who.includes(me) ? who.filter((x) => x !== me) : [...who, me];
        const reactions = { ...m.reactions, [emoji]: next };
        if (next.length === 0) delete reactions[emoji];
        return { ...m, reactions };
      }),
    [patch, me],
  );
  const edit = useCallback(
    (id: string, text: string) => patch(id, (m) => ({ ...m, text, edited: true })),
    [patch],
  );
  const remove = useCallback(
    (id: string) =>
      patch(id, (m) => ({
        ...m,
        deleted: true,
        text: '',
        code: undefined,
        poll: undefined,
        file: undefined,
        sticker: undefined,
        reactions: {},
      })),
    [patch],
  );
  const togglePin = useCallback(
    (id: string) => patch(id, (m) => ({ ...m, pinned: !m.pinned })),
    [patch],
  );
  const vote = useCallback(
    (id: string, option: number) =>
      patch(id, (m) =>
        m.poll && !m.poll.closed
          ? {
              ...m,
              poll: {
                ...m.poll,
                options: m.poll.options.map((o, i) => ({
                  ...o,
                  votes:
                    i === option
                      ? o.votes.includes(me)
                        ? o.votes.filter((v) => v !== me)
                        : [...o.votes, me]
                      : o.votes.filter((v) => v !== me),
                })),
              },
            }
          : m,
      ),
    [patch, me],
  );

  const createChannel = useCallback(
    (c: Omit<Channel, 'id' | 'createdAt' | 'createdBy'>) => {
      const ch: Channel = {
        ...c,
        id: `ch${Date.now()}`,
        createdAt: nowISO(),
        createdBy: me,
        members: Array.from(new Set([me, ...c.members])),
        admins: Array.from(new Set([me, ...c.admins])),
      };
      setChannels((l) => [...l, ch]);
      setMessages((l) => [
        ...l,
        {
          id: `sys${Date.now()}`,
          channelId: ch.id,
          author: me,
          at: nowISO(),
          kind: 'system',
          text: `created ${ch.kind === 'dm' ? 'this conversation' : `#${ch.name}`}`,
          reactions: {},
        },
      ]);
      return ch;
    },
    [me],
  );
  const updateChannel = useCallback(
    (id: string, p: Partial<Channel>) =>
      setChannels((l) => l.map((c) => (c.id === id ? { ...c, ...p } : c))),
    [],
  );
  const join = useCallback(
    (id: string) => {
      setChannels((l) =>
        l.map((c) =>
          c.id === id ? { ...c, members: Array.from(new Set([...c.members, me])) } : c,
        ),
      );
      setMessages((l) => [
        ...l,
        {
          id: `sys${Date.now()}`,
          channelId: id,
          author: me,
          at: nowISO(),
          kind: 'system',
          text: 'joined the channel',
          reactions: {},
        },
      ]);
    },
    [me],
  );
  const leave = useCallback(
    (id: string) => {
      setChannels((l) =>
        l.map((c) => (c.id === id ? { ...c, members: c.members.filter((x) => x !== me) } : c)),
      );
      setMessages((l) => [
        ...l,
        {
          id: `sys${Date.now()}`,
          channelId: id,
          author: me,
          at: nowISO(),
          kind: 'system',
          text: 'left the channel',
          reactions: {},
        },
      ]);
    },
    [me],
  );

  const markRead = useCallback(
    (id: string) =>
      setLastRead((r) => ({ ...r, [id]: new Date(Date.now() + 86_400_000 * 365).toISOString() })),
    [],
  );
  const unread = useCallback(
    (id: string) => {
      const since = lastRead[id] ?? new Date(NOW_MINUS_HOUR).toISOString();
      return messages.filter(
        (m) => m.channelId === id && !m.threadOf && m.author !== me && m.at > since && !m.deleted,
      ).length;
    },
    [messages, lastRead, me],
  );
  const mentions = useCallback(
    (id: string) => {
      const since = lastRead[id] ?? new Date(NOW_MINUS_HOUR).toISOString();
      return messages.filter(
        (m) =>
          m.channelId === id &&
          m.author !== me &&
          m.at > since &&
          /@(kofi|amara|daniel|grace|channel)/i.test(m.text),
      ).length;
    },
    [messages, lastRead, me],
  );

  const totalUnread = useMemo(
    () => visible.filter((c) => c.members.includes(me)).reduce((s, c) => s + unread(c.id), 0),
    [visible, unread, me],
  );

  const canModerate = useCallback(
    (c: Channel) => canDo('channel:moderate') || c.admins.includes(me),
    [canDo, me],
  );
  const canPost = useCallback(
    (c: Channel) => {
      if (c.archived) return false;
      if (c.permissions.post === 'admins') return canModerate(c);
      if (c.permissions.post === 'members') return c.members.includes(me);
      return true;
    },
    [canModerate, me],
  );

  const value = useMemo(
    () => ({
      channels,
      visible,
      messages,
      send,
      react,
      edit,
      remove,
      togglePin,
      vote,
      createChannel,
      updateChannel,
      join,
      leave,
      markRead,
      unread,
      mentions,
      totalUnread,
      canPost,
      canModerate,
    }),
    [
      channels,
      visible,
      messages,
      send,
      react,
      edit,
      remove,
      togglePin,
      vote,
      createChannel,
      updateChannel,
      join,
      leave,
      markRead,
      unread,
      mentions,
      totalUnread,
      canPost,
      canModerate,
    ],
  );
  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
}

/** Messages older than ~5h count as already read on first load, so the demo opens with a realistic unread count. */
const NOW_MINUS_HOUR = new Date(2026, 9, 23, 10, 30).getTime();

export function useMessaging() {
  const ctx = useContext(MessagingContext);
  if (!ctx) throw new Error('useMessaging must be used inside MessagingProvider');
  return ctx;
}
