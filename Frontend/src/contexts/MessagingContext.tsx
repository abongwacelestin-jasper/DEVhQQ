import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import { nowISO } from '../utils/date';
import { errorMessage, isUnavailable, itemsOf } from '../components/work/apiState';
import { useRealtime, type StreamEvent } from '../components/messaging/useRealtime';
import { useDirectory } from '../components/team/useDirectory';
import {
  toChannel,
  toMessage,
  type ApiChannel,
  type ApiMessage,
  type ChatChannel,
  type ChatMessage,
  type MessagePage,
  type NewMessage,
  type RealtimeStatus,
  toPostBody,
} from '../components/messaging/types';
import type { Channel } from '../types/messaging';

/**
 * Messaging on the B-COLLAB API (WAVE4 §6).
 *
 * - Channels: `GET/POST /api/channels`, `PATCH /api/channels/:id`.
 * - Messages: `GET /api/channels/:id/messages?before=` (cursor pages, newest
 *   first from the server, kept oldest→newest here), `POST` with a client
 *   `nonce`, `PATCH/DELETE /api/messages/:id` (delete leaves a tombstone),
 *   reactions, pins and poll votes.
 * - Realtime over SSE with dedupe by id; optimistic sends reconcile on the
 *   echoed nonce and keep a retry affordance when they fail.
 *
 * A missing module (404/503) puts the whole feature in an "unavailable" state.
 * There is no local or seeded fallback.
 */

export type Availability = 'loading' | 'ready' | 'unavailable' | 'error';

interface Timeline {
  items: ChatMessage[];
  /** Cursor for the next older page; null when the beginning has been reached. */
  nextCursor: string | null;
  status: 'loading' | 'ready' | 'error';
  loadingOlder: boolean;
  error?: string;
  source?: string;
}

type ChannelInput = Omit<Channel, 'id' | 'createdAt' | 'createdBy'>;

interface MessagingValue {
  me: string | null;
  availability: Availability;
  availabilityError: string | null;
  realtime: RealtimeStatus;
  channels: ChatChannel[];
  /** Channels the signed-in member may see: public ones plus private ones they belong to. */
  visible: ChatChannel[];
  /** Every loaded message across channels (for search and previews). */
  messages: ChatMessage[];
  timeline: (channelId: string) => Timeline | undefined;
  openChannel: (channelId: string) => void;
  loadOlder: (channelId: string) => Promise<void>;
  loadThread: (channelId: string, rootId: string) => Promise<void>;
  send: (m: NewMessage) => void;
  retry: (nonce: string) => void;
  discard: (nonce: string) => void;
  react: (id: string, emoji: string) => void;
  edit: (id: string, text: string) => void;
  remove: (id: string) => void;
  togglePin: (id: string) => void;
  vote: (id: string, option: number) => void;
  createChannel: (c: ChannelInput) => Promise<ChatChannel>;
  updateChannel: (id: string, patch: Partial<Channel>) => Promise<void>;
  join: (id: string) => void;
  leave: (id: string) => void;
  markRead: (id: string) => void;
  unread: (id: string) => number;
  mentions: (id: string) => number;
  totalUnread: number;
  canPost: (c: Channel) => boolean;
  canModerate: (c: Channel) => boolean;
  reload: () => Promise<void>;
}

const MessagingContext = createContext<MessagingValue | null>(null);

const PAGE = 50;
const enc = encodeURIComponent;

function newNonce() {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `n-${rnd}`;
}

const byTime = (a: ChatMessage, b: ChatMessage) =>
  a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at);

/** Insert or replace by id (and by nonce for our own optimistic copies). Never duplicates. */
function upsert(list: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (!incoming.length) return list;
  const next = [...list];
  for (const m of incoming) {
    const at = next.findIndex(
      (x) => x.id === m.id || (!!m.nonce && !!x.nonce && x.nonce === m.nonce),
    );
    if (at >= 0) next[at] = { ...m, delivery: undefined, deliveryError: undefined };
    else next.push(m);
  }
  return next.sort(byTime);
}

function messageFrom(data: Record<string, unknown>): ApiMessage | null {
  const raw = (typeof data.message === 'object' && data.message !== null ? data.message : data) as
    Partial<ApiMessage> | undefined;
  if (!raw || typeof raw.id !== 'string' || typeof raw.channelId !== 'string') return null;
  return raw as ApiMessage;
}

function channelFrom(data: Record<string, unknown>): ApiChannel | null {
  const raw = (typeof data.channel === 'object' && data.channel !== null ? data.channel : data) as
    Partial<ApiChannel> | undefined;
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  return raw as ApiChannel;
}

export function MessagingProvider({ children }: { children: React.ReactNode }) {
  const { canDo, readyMemberId } = useAuth();
  const me = readyMemberId;
  const { members: directory } = useDirectory();

  const [availability, setAvailability] = useState<Availability>('loading');
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [timelines, setTimelines] = useState<Record<string, Timeline>>({});
  const [counts, setCounts] = useState<Record<string, { unread: number; mentions: number }>>({});
  const activeRef = useRef<string | null>(null);
  const timelinesRef = useRef(timelines);
  timelinesRef.current = timelines;
  /** Payloads of optimistic sends, kept so a failed one can be retried with the same nonce. */
  const pending = useRef(new Map<string, NewMessage>());

  const setTimeline = useCallback(
    (channelId: string, fn: (t: Timeline | undefined) => Timeline) =>
      setTimelines((all) => ({ ...all, [channelId]: fn(all[channelId]) })),
    [],
  );

  const ingest = useCallback(
    (channelId: string, incoming: ChatMessage[]) =>
      setTimeline(channelId, (t) => ({
        nextCursor: t?.nextCursor ?? null,
        status: t?.status ?? 'ready',
        loadingOlder: t?.loadingOlder ?? false,
        ...t,
        items: upsert(t?.items ?? [], incoming),
      })),
    [setTimeline],
  );

  // ── Channels ────────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    try {
      const body = await api<{ items: ApiChannel[] } | ApiChannel[]>('/api/channels');
      const list = itemsOf(body).map(toChannel);
      setChannels(list);
      setCounts(
        Object.fromEntries(
          list.map((c) => [c.id, { unread: c.unread ?? 0, mentions: c.mentions ?? 0 }]),
        ),
      );
      setAvailability('ready');
      setAvailabilityError(null);
    } catch (e) {
      setAvailability(isUnavailable(e) ? 'unavailable' : 'error');
      setAvailabilityError(errorMessage(e, "Couldn't load conversations."));
    }
  }, []);

  useEffect(() => {
    setChannels([]);
    setTimelines({});
    setCounts({});
    pending.current.clear();
    if (!me) {
      setAvailability('loading');
      return;
    }
    setAvailability('loading');
    void reload();
  }, [me, reload]);

  // ── Message pages ───────────────────────────────────────────────────────
  const fetchPage = useCallback(async (channelId: string, before?: string) => {
    const qs = new URLSearchParams({ limit: String(PAGE) });
    if (before) qs.set('before', before);
    const body = await api<MessagePage | ApiMessage[]>(
      `/api/channels/${enc(channelId)}/messages?${qs}`,
    );
    return {
      items: itemsOf(body).map(toMessage),
      nextCursor: Array.isArray(body) ? null : (body.nextCursor ?? null),
      source: Array.isArray(body) ? undefined : body.source,
    };
  }, []);

  const loadLatest = useCallback(
    async (channelId: string) => {
      setTimeline(channelId, (t) => ({
        items: t?.items ?? [],
        nextCursor: t?.nextCursor ?? null,
        loadingOlder: false,
        status: t?.items.length ? t.status : 'loading',
      }));
      try {
        const page = await fetchPage(channelId);
        setTimeline(channelId, (t) => ({
          // A refresh merges, so a cursor obtained earlier for older history survives.
          items: upsert(t?.items ?? [], page.items),
          nextCursor:
            t && t.items.length > 0 && t.status === 'ready' ? t.nextCursor : page.nextCursor,
          loadingOlder: false,
          status: 'ready',
          source: page.source,
        }));
      } catch (e) {
        setTimeline(channelId, (t) => ({
          items: t?.items ?? [],
          nextCursor: t?.nextCursor ?? null,
          loadingOlder: false,
          status: 'error',
          error: errorMessage(e, "Couldn't load messages."),
        }));
      }
    },
    [fetchPage, setTimeline],
  );

  const openChannel = useCallback(
    (channelId: string) => {
      activeRef.current = channelId;
      const t = timelinesRef.current[channelId];
      if (!t || t.status === 'error') void loadLatest(channelId);
    },
    [loadLatest],
  );

  const loadOlder = useCallback(
    async (channelId: string) => {
      const t = timelinesRef.current[channelId];
      if (!t || t.loadingOlder || !t.nextCursor) return;
      const cursor = t.nextCursor;
      setTimeline(channelId, (x) => ({ ...(x as Timeline), loadingOlder: true }));
      try {
        const page = await fetchPage(channelId, cursor);
        setTimeline(channelId, (x) => ({
          ...(x as Timeline),
          items: upsert(x?.items ?? [], page.items),
          nextCursor: page.nextCursor,
          loadingOlder: false,
        }));
      } catch (e) {
        setTimeline(channelId, (x) => ({ ...(x as Timeline), loadingOlder: false }));
        toast.error("Couldn't load older messages", { description: errorMessage(e) });
      }
    },
    [fetchPage, setTimeline],
  );

  const loadThread = useCallback(
    async (channelId: string, rootId: string) => {
      try {
        const body = await api<MessagePage | ApiMessage[]>(
          `/api/channels/${enc(channelId)}/messages?thread=${enc(rootId)}&limit=100`,
        );
        ingest(channelId, itemsOf(body).map(toMessage));
      } catch (e) {
        toast.error("Couldn't load the thread", { description: errorMessage(e) });
      }
    },
    [ingest],
  );

  // ── Realtime ────────────────────────────────────────────────────────────
  const onEvent = useCallback(
    (e: StreamEvent) => {
      if (e.type.startsWith('channel.')) {
        const raw = channelFrom(e.data);
        if (!raw) return;
        if (e.type === 'channel.deleted' || e.type === 'channel.removed') {
          setChannels((l) => l.filter((c) => c.id !== raw.id));
          return;
        }
        const c = toChannel(raw);
        // Only show channels this member can see; the server's list is the authority.
        if (c.private && me && !c.members.includes(me)) return;
        setChannels((l) =>
          l.some((x) => x.id === c.id)
            ? l.map((x) => (x.id === c.id ? { ...x, ...c } : x))
            : [...l, c],
        );
        return;
      }
      const raw = messageFrom(e.data);
      if (!raw) return;
      let msg = toMessage(raw);
      // Our own send may echo over SSE before the POST resolves: adopt the pending
      // optimistic copy's nonce so the two rows collapse into one.
      if (e.type === 'message.created' && msg.author === me) {
        const twin = timelinesRef.current[msg.channelId]?.items.find(
          (x) =>
            x.delivery === 'sending' &&
            x.kind === msg.kind &&
            x.text === msg.text &&
            (x.threadOf ?? '') === (msg.threadOf ?? ''),
        );
        if (twin?.nonce) msg = { ...msg, nonce: twin.nonce };
      }
      const known = timelinesRef.current[msg.channelId]?.items.some(
        (x) => x.id === msg.id || (!!msg.nonce && x.nonce === msg.nonce),
      );
      ingest(msg.channelId, [msg]);
      setChannels((l) =>
        l.map((c) =>
          c.id === msg.channelId && !msg.threadOf && (!c.lastMessage || c.lastMessage.at <= msg.at)
            ? { ...c, lastMessage: msg }
            : c,
        ),
      );
      if (
        e.type === 'message.created' &&
        !known &&
        msg.author !== me &&
        !msg.threadOf &&
        activeRef.current !== msg.channelId
      ) {
        const mention =
          /@(channel|everyone)\b/i.test(msg.text) || (!!me && !!msg.mentions?.includes(me));
        setCounts((all) => {
          const cur = all[msg.channelId] ?? { unread: 0, mentions: 0 };
          return {
            ...all,
            [msg.channelId]: { unread: cur.unread + 1, mentions: cur.mentions + (mention ? 1 : 0) },
          };
        });
      }
    },
    [ingest, me],
  );

  const onResync = useCallback(() => {
    void reload();
    const active = activeRef.current;
    if (active && timelinesRef.current[active]) void loadLatest(active);
  }, [reload, loadLatest]);

  const realtime = useRealtime(!!me && availability === 'ready', onEvent, onResync);

  // ── Writes ──────────────────────────────────────────────────────────────
  const findMessage = useCallback((id: string) => {
    for (const t of Object.values(timelinesRef.current)) {
      const m = t.items.find((x) => x.id === id);
      if (m) return m;
    }
    return undefined;
  }, []);

  const patchMessage = useCallback(
    (id: string, fn: (m: ChatMessage) => ChatMessage) =>
      setTimelines((all) => {
        const next = { ...all };
        for (const [cid, t] of Object.entries(all)) {
          if (t.items.some((m) => m.id === id))
            next[cid] = { ...t, items: t.items.map((m) => (m.id === id ? fn(m) : m)) };
        }
        return next;
      }),
    [],
  );

  /** Apply the server's copy of a message after a write. */
  const settle = useCallback(
    (raw: ApiMessage | undefined | null) => {
      if (raw && typeof raw.id === 'string') ingest(raw.channelId, [toMessage(raw)]);
    },
    [ingest],
  );

  const writeFailed = useCallback(
    (action: string, channelId: string | undefined, e: unknown) => {
      toast.error(`${action} failed`, { description: errorMessage(e) });
      if (channelId) void loadLatest(channelId);
    },
    [loadLatest],
  );

  /**
   * Swap the optimistic copy for the server's message. The API has no nonce
   * field, so the nonce stays a client-side tag; if the SSE echo already
   * inserted the saved id, the optimistic row is simply dropped.
   */
  const reconcile = useCallback(
    (nonce: string, raw: ApiMessage) => {
      const saved = { ...toMessage(raw), nonce };
      setTimeline(saved.channelId, (t) => ({
        ...(t as Timeline),
        items: upsert(
          (t?.items ?? []).filter((x) => x.nonce !== nonce || x.id === saved.id),
          [saved],
        ),
      }));
    },
    [setTimeline],
  );

  const deliver = useCallback(
    (nonce: string, m: NewMessage) => {
      api<ApiMessage>(`/api/channels/${enc(m.channelId)}/messages`, {
        method: 'POST',
        body: toPostBody(m),
      })
        .then((saved) => {
          pending.current.delete(nonce);
          reconcile(nonce, saved);
        })
        .catch((e: unknown) => {
          setTimeline(m.channelId, (t) => ({
            ...(t as Timeline),
            items: (t?.items ?? []).map((x) =>
              x.nonce === nonce
                ? { ...x, delivery: 'failed', deliveryError: errorMessage(e, 'Not sent.') }
                : x,
            ),
          }));
        });
    },
    [reconcile, setTimeline],
  );

  const send = useCallback(
    (m: NewMessage) => {
      if (!me) return;
      const nonce = newNonce();
      pending.current.set(nonce, m);
      const optimistic: ChatMessage = {
        reactions: {},
        ...m,
        id: nonce,
        nonce,
        at: nowISO(),
        author: me,
        file: m.attachment
          ? {
              name: m.attachment.name,
              size: m.attachment.size,
              type: m.attachment.contentType,
              fileId: m.attachment.fileId,
            }
          : undefined,
        delivery: 'sending',
      };
      ingest(m.channelId, [optimistic]);
      deliver(nonce, m);
    },
    [me, ingest, deliver],
  );

  const retry = useCallback(
    (nonce: string) => {
      const m = pending.current.get(nonce);
      if (!m) return;
      setTimeline(m.channelId, (t) => ({
        ...(t as Timeline),
        items: (t?.items ?? []).map((x) =>
          x.nonce === nonce ? { ...x, delivery: 'sending', deliveryError: undefined } : x,
        ),
      }));
      deliver(nonce, m);
    },
    [deliver, setTimeline],
  );

  const discard = useCallback(
    (nonce: string) => {
      const m = pending.current.get(nonce);
      pending.current.delete(nonce);
      if (!m) return;
      setTimeline(m.channelId, (t) => ({
        ...(t as Timeline),
        items: (t?.items ?? []).filter((x) => x.nonce !== nonce || !x.delivery),
      }));
    },
    [setTimeline],
  );

  const react = useCallback(
    (id: string, emoji: string) => {
      const m = findMessage(id);
      if (!m || !me || m.delivery) return;
      patchMessage(id, (x) => {
        const who = x.reactions[emoji] ?? [];
        const next = who.includes(me) ? who.filter((w) => w !== me) : [...who, me];
        const reactions = { ...x.reactions, [emoji]: next };
        if (next.length === 0) delete reactions[emoji];
        return { ...x, reactions };
      });
      api<ApiMessage>(`/api/messages/${enc(id)}/reactions`, { method: 'POST', body: { emoji } })
        .then(settle)
        .catch((e) => writeFailed('Reacting', m.channelId, e));
    },
    [findMessage, me, patchMessage, settle, writeFailed],
  );

  const edit = useCallback(
    (id: string, text: string) => {
      const m = findMessage(id);
      if (!m || m.delivery) return;
      patchMessage(id, (x) => ({ ...x, text, edited: true }));
      api<ApiMessage>(`/api/messages/${enc(id)}`, { method: 'PATCH', body: { text } })
        .then(settle)
        .catch((e) => writeFailed('Editing the message', m.channelId, e));
    },
    [findMessage, patchMessage, settle, writeFailed],
  );

  const remove = useCallback(
    (id: string) => {
      const m = findMessage(id);
      if (!m || m.delivery) return;
      // Tombstone: the row stays so threads and ordering survive; the content goes.
      patchMessage(id, (x) => ({
        ...x,
        deleted: true,
        text: '',
        code: undefined,
        poll: undefined,
        file: undefined,
        attachment: undefined,
        sticker: undefined,
        reactions: {},
      }));
      api<ApiMessage | undefined>(`/api/messages/${enc(id)}`, { method: 'DELETE' })
        .then(settle)
        .catch((e) => writeFailed('Deleting the message', m.channelId, e));
    },
    [findMessage, patchMessage, settle, writeFailed],
  );

  const togglePin = useCallback(
    (id: string) => {
      const m = findMessage(id);
      if (!m || m.delivery) return;
      const pinned = !m.pinned;
      patchMessage(id, (x) => ({ ...x, pinned }));
      api<ApiMessage>(`/api/messages/${enc(id)}/pin`, { method: 'POST', body: { pinned } })
        .then(settle)
        .catch((e) => writeFailed(pinned ? 'Pinning' : 'Unpinning', m.channelId, e));
    },
    [findMessage, patchMessage, settle, writeFailed],
  );

  const vote = useCallback(
    (id: string, option: number) => {
      const m = findMessage(id);
      if (!m || !me || !m.poll || m.poll.closed || m.delivery) return;
      patchMessage(id, (x) =>
        x.poll
          ? {
              ...x,
              poll: {
                ...x.poll,
                options: x.poll.options.map((o, i) => ({
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
          : x,
      );
      api<ApiMessage>(`/api/messages/${enc(id)}/vote`, { method: 'POST', body: { option } })
        .then(settle)
        .catch((e) => writeFailed('Voting', m.channelId, e));
    },
    [findMessage, me, patchMessage, settle, writeFailed],
  );

  const createChannel = useCallback(async (c: ChannelInput) => {
    const body =
      c.kind === 'dm'
        ? { kind: c.kind, members: c.members, background: c.background }
        : {
            kind: c.kind,
            name: c.name,
            topic: c.topic,
            product: c.product,
            projectId: c.projectId,
            members: c.members,
            admins: c.admins,
            private: c.private,
            background: c.background,
            permissions: c.permissions,
          };
    const created = toChannel(await api<ApiChannel>('/api/channels', { method: 'POST', body }));
    setChannels((l) => (l.some((x) => x.id === created.id) ? l : [...l, created]));
    return created;
  }, []);

  const updateChannel = useCallback(
    async (id: string, p: Partial<Channel>) => {
      const before = channels.find((c) => c.id === id);
      setChannels((l) => l.map((c) => (c.id === id ? { ...c, ...p } : c)));
      try {
        const allowed = [
          'name',
          'topic',
          'background',
          'private',
          'archived',
          'permissions',
        ] as const;
        const body = Object.fromEntries(
          allowed.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]),
        );
        const saved = await api<ApiChannel>(`/api/channels/${enc(id)}`, {
          method: 'PATCH',
          body,
        });
        if (saved && typeof saved.id === 'string')
          setChannels((l) => l.map((c) => (c.id === id ? { ...c, ...toChannel(saved) } : c)));
      } catch (e) {
        if (before) setChannels((l) => l.map((c) => (c.id === id ? before : c)));
        throw e;
      }
    },
    [channels],
  );

  const membership = useCallback(
    (id: string, action: 'join' | 'leave') => {
      if (!me) return;
      setChannels((l) =>
        l.map((c) =>
          c.id === id
            ? {
                ...c,
                members:
                  action === 'join'
                    ? Array.from(new Set([...c.members, me]))
                    : c.members.filter((x) => x !== me),
              }
            : c,
        ),
      );
      api<ApiChannel>(`/api/channels/${enc(id)}/${action}`, { method: 'POST' })
        .then((saved) => {
          if (saved && typeof saved.id === 'string')
            setChannels((l) => l.map((c) => (c.id === id ? { ...c, ...toChannel(saved) } : c)));
        })
        .catch((e) => {
          toast.error(`${action === 'join' ? 'Joining' : 'Leaving'} failed`, {
            description: errorMessage(e),
          });
          void reload();
        });
    },
    [me, reload],
  );
  const join = useCallback((id: string) => membership(id, 'join'), [membership]);
  const leave = useCallback((id: string) => membership(id, 'leave'), [membership]);

  const countsRef = useRef(counts);
  countsRef.current = counts;
  /**
   * Stable identity on purpose: the page calls this whenever the open timeline
   * grows. State only changes when there was something unread, so it can't loop.
   */
  const markRead = useCallback((id: string) => {
    const had = countsRef.current[id];
    if (had && (had.unread > 0 || had.mentions > 0))
      setCounts((all) => ({ ...all, [id]: { unread: 0, mentions: 0 } }));
    // Read state is per-member on the server; a failure only means the badge may come back.
    api(`/api/channels/${enc(id)}/read`, { method: 'POST', body: { at: nowISO() } }).catch(
      () => undefined,
    );
  }, []);

  const unread = useCallback((id: string) => counts[id]?.unread ?? 0, [counts]);
  const mentions = useCallback((id: string) => counts[id]?.mentions ?? 0, [counts]);

  const visible = useMemo(() => {
    const nameOf = new Map(directory.map((m) => [m.id, m.name]));
    return channels
      .filter(
        (c) => !c.archived && !!me && (c.members.includes(me) || (!c.private && c.kind !== 'dm')),
      )
      .map((c) => {
        if (c.kind !== 'dm') return c;
        // The server names a DM after the *creator's* peers; show the viewer's peers instead.
        const others = c.members.filter((id) => id !== me).map((id) => nameOf.get(id));
        return others.length && others.every(Boolean) ? { ...c, name: others.join(', ') } : c;
      });
  }, [channels, me, directory]);

  const messages = useMemo(() => Object.values(timelines).flatMap((t) => t.items), [timelines]);

  const totalUnread = useMemo(
    () =>
      visible
        .filter((c) => !!me && c.members.includes(me))
        .reduce((s, c) => s + (counts[c.id]?.unread ?? 0), 0),
    [visible, counts, me],
  );

  const serverFlags = useMemo(
    () => new Map(channels.map((c) => [c.id, { post: c.canPost, moderate: c.canModerate }])),
    [channels],
  );
  const canModerate = useCallback(
    (c: Channel) =>
      serverFlags.get(c.id)?.moderate ??
      (canDo('channel:moderate') || (!!me && c.admins.includes(me))),
    [canDo, me, serverFlags],
  );
  const canPost = useCallback(
    (c: Channel) => {
      if (c.archived || !me) return false;
      const flag = serverFlags.get(c.id)?.post;
      // A thread composer relaxes 'admins' to 'members' client-side; respect that override.
      if (flag !== undefined && c.permissions.post === serverPost(channels, c.id)) return flag;
      if (c.permissions.post === 'admins') return canModerate(c);
      if (c.permissions.post === 'members') return c.members.includes(me);
      return true;
    },
    [canModerate, me, serverFlags, channels],
  );

  const timeline = useCallback((id: string) => timelines[id], [timelines]);

  const value = useMemo<MessagingValue>(
    () => ({
      me,
      availability,
      availabilityError,
      realtime,
      channels,
      visible,
      messages,
      timeline,
      openChannel,
      loadOlder,
      loadThread,
      send,
      retry,
      discard,
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
      reload,
    }),
    [
      me,
      availability,
      availabilityError,
      realtime,
      channels,
      visible,
      messages,
      timeline,
      openChannel,
      loadOlder,
      loadThread,
      send,
      retry,
      discard,
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
      reload,
    ],
  );
  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
}

function serverPost(channels: ChatChannel[], id: string) {
  return channels.find((c) => c.id === id)?.permissions.post;
}

export function useMessaging() {
  const ctx = useContext(MessagingContext);
  if (!ctx) throw new Error('useMessaging must be used inside MessagingProvider');
  return ctx;
}
