import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  BellOffIcon,
  FilterIcon,
  HashIcon,
  Loader2Icon,
  LockIcon,
  PanelRightIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from '../components/ui/Avatar';
import { ChannelList, type ListView } from '../components/messaging/ChannelList';
import { MessageItem } from '../components/messaging/MessageItem';
import { Composer } from '../components/messaging/Composer';
import { ChatRail, PRESENCE_NOTE, type RailTab } from '../components/messaging/ChatRail';
import { ChannelSettingsModal } from '../components/messaging/ChannelSettingsModal';
import { NewChannelModal } from '../components/messaging/NewChannelModal';
import type { RealtimeStatus } from '../components/messaging/types';
import { ChatIllustration } from '../components/illustrations/ChatIllustration';
import { DemoBadge, Unavailable } from '../components/work/Unavailable';
import { useDirectory } from '../components/team/useDirectory';
import { useMessaging } from '../contexts/MessagingContext';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { usePresence } from '../hooks/usePresence';
import { chatBackgroundStyle } from '../utils/chatBackground';
import { formatDayHeading, startOfDay } from '../utils/date';

const keys = ['q', 'view', 'product', 'find', 'type', 'from'] as const;

export function Messages() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const {
    me,
    visible,
    timeline: timelineOf,
    openChannel,
    loadOlder,
    markRead,
    availability,
    availabilityError,
    realtime,
    reload,
  } = useMessaging();
  const { memberById } = useDirectory();
  const f = useUrlFilters(keys);
  const v = f.values;
  const [railOpen, setRailOpen] = useState(() => window.innerWidth >= 1280);
  const [railTab, setRailTab] = useState<RailTab>('about');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const channel = visible.find((c) => c.id === channelId);
  const loaded = channel ? timelineOf(channel.id) : undefined;
  const messages = useMemo(() => loaded?.items ?? [], [loaded]);

  // Same-browser presence only (BroadcastChannel); the server exposes none yet.
  const myName = me ? memberById(me).name : 'Me';
  const peers = usePresence(
    { id: me ?? 'anonymous', name: myName },
    'Messages',
    channel?.id,
    false,
  );
  const online = useMemo(() => {
    const ids = new Set(peers.map((p) => p.id.split(':')[0]));
    if (me) ids.add(me);
    return ids;
  }, [peers, me]);

  const channelKey = channel?.id;
  useEffect(() => {
    if (!channelKey) return;
    openChannel(channelKey);
    setThreadId(null);
    setRailTab('about');
  }, [channelKey, openChannel]);

  const isMember = !!channel && !!me && channel.members.includes(me);
  useEffect(() => {
    if (channelKey && isMember) markRead(channelKey);
  }, [channelKey, isMember, markRead, messages.length]);

  const timeline = useMemo(() => {
    if (!channel) return [];
    return messages.filter(
      (m) =>
        !m.threadOf &&
        (!v.find ||
          `${m.text} ${m.code?.content ?? ''} ${m.poll?.question ?? ''} ${m.file?.name ?? ''}`
            .toLowerCase()
            .includes(v.find.toLowerCase())) &&
        (!v.from || m.author === v.from) &&
        (!v.type ||
          (v.type === 'pinned'
            ? m.pinned
            : v.type === 'mine'
              ? m.author === me
              : m.kind === v.type)),
    );
  }, [messages, channel, v.find, v.from, v.type, me]);

  // ── Scrolling: stick to the bottom for new messages; hold position when older ones load.
  const anchor = useRef<{ height: number; top: number; first?: string; last?: string } | null>(
    null,
  );
  const stickToBottom = useRef(true);
  useEffect(() => {
    stickToBottom.current = true;
    anchor.current = null;
  }, [channelKey]);

  const requestOlder = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !channelKey || !loaded?.nextCursor || loaded.loadingOlder) return;
    anchor.current = {
      height: el.scrollHeight,
      top: el.scrollTop,
      first: timeline[0]?.id,
      last: timeline[timeline.length - 1]?.id,
    };
    void loadOlder(channelKey);
  }, [channelKey, loaded?.nextCursor, loaded?.loadingOlder, loadOlder, timeline]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120) requestOlder();
  }, [requestOlder]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const a = anchor.current;
    const first = timeline[0]?.id;
    const last = timeline[timeline.length - 1]?.id;
    if (a && first !== a.first && last === a.last) {
      // An older page was prepended: shift by the added height so the reader's place holds.
      el.scrollTop = el.scrollHeight - a.height + a.top;
      anchor.current = null;
      return;
    }
    const mineLast = !!me && timeline[timeline.length - 1]?.author === me;
    if (stickToBottom.current || mineLast) endRef.current?.scrollIntoView({ block: 'end' });
  }, [timeline, me]);

  // ── Screen-reader announcement for messages that arrive while the conversation is open.
  const [announcement, setAnnouncement] = useState('');
  const seen = useRef<{ channel?: string; ids: Set<string> }>({ ids: new Set() });
  useEffect(() => {
    const prev = seen.current;
    const ids = new Set(timeline.map((m) => m.id));
    if (prev.channel === channelKey && prev.ids.size) {
      const newest = timeline[timeline.length - 1];
      if (
        newest &&
        !prev.ids.has(newest.id) &&
        newest.author !== me &&
        !newest.delivery &&
        newest.kind !== 'system'
      ) {
        const what = newest.text || newest.poll?.question || newest.file?.name || newest.kind;
        setAnnouncement(
          `New message from ${memberById(newest.author).name}: ${what.slice(0, 140)}`,
        );
      }
    }
    seen.current = { channel: channelKey, ids };
  }, [timeline, channelKey, me, memberById]);

  const replyCount = (id: string) => {
    const root = messages.find((m) => m.id === id);
    const loadedReplies = messages.filter((m) => m.threadOf === id && !m.deleted).length;
    return Math.max(root?.replyCount ?? 0, loadedReplies);
  };
  const openThread = (id: string | null) => {
    setThreadId(id);
    if (id) {
      setRailTab('thread');
      setRailOpen(true);
    }
  };

  const filtering = !!(v.find || v.from || v.type);
  const peer = channel?.kind === 'dm' ? channel.members.find((x) => x !== me) : undefined;

  if (availability !== 'ready') {
    return (
      <div className="flex h-[calc(100dvh-8.6rem)] min-h-[460px] items-center justify-center rounded-lg border border-line bg-white lg:h-[calc(100dvh-5.4rem)]">
        {availability === 'loading' ? (
          <p role="status" className="flex items-center gap-2 text-[12.5px] text-muted">
            <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden /> Loading conversations…
          </p>
        ) : availability === 'unavailable' ? (
          <Unavailable
            title="Messaging isn't available"
            detail="The collaboration service (channels and messages API) isn't deployed or configured on this server."
            onRetry={() => void reload()}
          >
            <ChatIllustration className="mt-3 h-20 w-auto opacity-70" />
          </Unavailable>
        ) : (
          <Unavailable
            title="Couldn't load conversations"
            detail={availabilityError ?? 'The messaging API did not respond.'}
            onRetry={() => void reload()}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-[calc(100dvh-8.6rem)] min-h-[460px] overflow-hidden rounded-lg border border-line bg-white lg:h-[calc(100dvh-5.4rem)]">
      {/* Conversation list */}
      <aside
        className={`w-full shrink-0 border-r border-line md:block md:w-[280px] ${channel ? 'hidden' : 'block'}`}
      >
        <ChannelList
          activeId={channel?.id}
          q={v.q}
          view={(v.view || 'all') as ListView}
          product={v.product}
          onChange={(k, val) => f.set(k, val)}
          onNew={() => setNewOpen(true)}
        />
      </aside>

      {/* Conversation */}
      {channel ? (
        <section
          className="relative flex min-w-0 flex-1 flex-col"
          aria-label={`Conversation ${channel.name}`}
        >
          <header className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Link
              to={`/messages${window.location.search}`}
              className="rounded-md p-1 text-muted hover:bg-sunken md:hidden"
              aria-label="Back to conversations"
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </Link>
            {peer ? (
              <Avatar id={peer} size="md" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sunken text-ink">
                {channel.private ? (
                  <LockIcon className="h-4 w-4" />
                ) : (
                  <HashIcon className="h-4 w-4" />
                )}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[13.5px] font-semibold text-ink">
                {channel.kind === 'dm' ? channel.name : `#${channel.name}`}
                {channel.archived && (
                  <span className="ml-1.5 rounded bg-sunken px-1 text-[10.5px] font-semibold text-muted">
                    Archived
                  </span>
                )}
              </h2>
              <p className="truncate text-[11.5px] text-muted">
                {peer ? (
                  <span title={PRESENCE_NOTE}>
                    {memberById(peer).role} ·{' '}
                    {online.has(peer) ? 'Online in this browser' : 'Presence unavailable'}
                  </span>
                ) : (
                  channel.topic
                )}
              </p>
            </div>
            <div className="flex items-center gap-0.5">
              {(loaded?.source === 'demo' || channel.source === 'demo') && <DemoBadge />}
              <RealtimeDot status={realtime} />
              {channel.kind !== 'dm' && (
                <button
                  onClick={() => {
                    setRailTab('about');
                    setRailOpen(true);
                  }}
                  className="hidden items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-sunken hover:text-ink sm:inline-flex"
                  aria-label="Members"
                >
                  <UsersIcon className="h-3.5 w-3.5" /> {channel.members.length}
                </button>
              )}
              <HeaderBtn
                label="Search & filter"
                active={findOpen || filtering}
                onClick={() => setFindOpen((x) => !x)}
              >
                <SearchIcon className="h-4 w-4" />
              </HeaderBtn>
              <HeaderBtn
                label={muted[channel.id] ? 'Unmute' : 'Mute'}
                active={!!muted[channel.id]}
                onClick={() => {
                  setMuted((m) => ({ ...m, [channel.id]: !m[channel.id] }));
                  toast(
                    muted[channel.id]
                      ? 'Notifications on'
                      : 'Muted for this session — mentions still notify you',
                  );
                }}
              >
                <BellOffIcon className="h-4 w-4" />
              </HeaderBtn>
              <HeaderBtn label="Channel settings" onClick={() => setSettings(true)}>
                <SettingsIcon className="h-4 w-4" />
              </HeaderBtn>
              <HeaderBtn label="Details" active={railOpen} onClick={() => setRailOpen((x) => !x)}>
                <PanelRightIcon className="h-4 w-4" />
              </HeaderBtn>
            </div>
          </header>

          {(findOpen || filtering) && (
            <div
              className="flex flex-wrap items-center gap-1.5 border-b border-line bg-sunken/40 px-3 py-1.5"
              role="search"
            >
              <FilterIcon className="h-3.5 w-3.5 text-muted" />
              <input
                value={v.find}
                onChange={(e) => f.set('find', e.target.value)}
                placeholder="Find in loaded messages"
                aria-label="Find in loaded messages"
                autoFocus
                className="h-7 min-w-0 flex-1 basis-32 rounded-md border border-line bg-white px-2 text-[12px] outline-none focus:border-accent"
              />
              <select
                value={v.type}
                onChange={(e) => f.set('type', e.target.value)}
                aria-label="Type"
                className="h-7 rounded-md border border-line bg-white px-1.5 text-[12px]"
              >
                <option value="">All types</option>
                <option value="text">Text</option>
                <option value="file">Files</option>
                <option value="code">Code</option>
                <option value="poll">Polls</option>
                <option value="sticker">Stickers</option>
                <option value="pinned">Pinned</option>
                <option value="mine">From me</option>
              </select>
              <select
                value={v.from}
                onChange={(e) => f.set('from', e.target.value)}
                aria-label="From"
                className="h-7 rounded-md border border-line bg-white px-1.5 text-[12px]"
              >
                <option value="">Anyone</option>
                {channel.members.map((id) => (
                  <option key={id} value={id}>
                    {memberById(id).name}
                  </option>
                ))}
              </select>
              <span className="text-[11.5px] tabular-nums text-muted">{timeline.length} found</span>
              <button
                onClick={() => {
                  f.setMany({ find: '', type: '', from: '' });
                  setFindOpen(false);
                }}
                className="rounded p-1 text-muted hover:text-ink"
                aria-label="Clear"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div
            ref={scrollRef}
            onScroll={onScroll}
            role="log"
            aria-label={`Messages in ${channel.kind === 'dm' ? channel.name : `#${channel.name}`}`}
            aria-busy={loaded?.status === 'loading' || loaded?.loadingOlder || undefined}
            className="min-h-0 flex-1 overflow-y-auto px-2 py-2 scroll-thin"
            style={chatBackgroundStyle(channel.background)}
          >
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {announcement}
            </p>
            {loaded?.loadingOlder && (
              <p
                role="status"
                className="flex items-center justify-center gap-1.5 py-2 text-[11.5px] text-muted"
              >
                <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading older
                messages…
              </p>
            )}
            {loaded?.status === 'ready' && loaded.nextCursor && !loaded.loadingOlder && (
              <div className="flex justify-center py-1">
                <button
                  type="button"
                  onClick={requestOlder}
                  className="rounded-full border border-line bg-white px-2.5 py-0.5 text-[11.5px] font-medium text-muted hover:text-ink"
                >
                  Load older messages
                </button>
              </div>
            )}
            {loaded?.status === 'ready' &&
              !loaded.nextCursor &&
              timeline.length > 0 &&
              !filtering && (
                <p className="py-2 text-center text-[11px] text-muted">
                  Beginning of the conversation
                </p>
              )}
            {loaded?.status === 'error' && (
              <Unavailable
                compact
                title="Couldn't load messages"
                detail={loaded.error}
                onRetry={() => openChannel(channel.id)}
              />
            )}
            {(!loaded || loaded.status === 'loading') && (
              <p
                role="status"
                className="flex h-full items-center justify-center gap-2 text-[12.5px] text-muted"
              >
                <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden /> Loading messages…
              </p>
            )}
            {loaded?.status === 'ready' && timeline.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <ChatIllustration className="h-24 w-auto" />
                <p className="mt-2 text-[12.5px] text-muted">
                  {filtering ? 'No messages match these filters.' : 'No messages yet — say hello.'}
                </p>
              </div>
            )}
            {timeline.map((m, i) => {
              const prev = timeline[i - 1];
              const newDay =
                !prev ||
                startOfDay(new Date(prev.at)).getTime() !== startOfDay(new Date(m.at)).getTime();
              const compact =
                !newDay &&
                !!prev &&
                prev.author === m.author &&
                prev.kind !== 'system' &&
                new Date(m.at).getTime() - new Date(prev.at).getTime() < 5 * 60_000;
              return (
                <React.Fragment key={m.nonce ?? m.id}>
                  {newDay && (
                    <div className="sticky top-0 z-10 my-2 flex justify-center">
                      <span className="rounded-full border border-line bg-white px-2.5 py-0.5 text-[11px] font-semibold text-ink shadow-sm">
                        {formatDayHeading(new Date(m.at))}
                      </span>
                    </div>
                  )}
                  <MessageItem
                    message={m}
                    channel={channel}
                    compact={compact}
                    replies={replyCount(m.id)}
                    onThread={channel.permissions.threads ? openThread : undefined}
                    highlight={v.find}
                  />
                </React.Fragment>
              );
            })}
            <div ref={endRef} />
          </div>

          <Composer channel={channel} />

          {railOpen && (
            <div className="absolute inset-y-0 right-0 z-20 w-full max-w-[320px] border-l border-line shadow-pop xl:hidden">
              <ChatRail
                channel={channel}
                tab={railTab}
                onTab={setRailTab}
                threadId={threadId}
                onThread={openThread}
                onSettings={() => setSettings(true)}
                onClose={() => setRailOpen(false)}
                online={online}
              />
            </div>
          )}
        </section>
      ) : (
        <section className="hidden min-w-0 flex-1 flex-col items-center justify-center bg-sunken/30 p-6 text-center md:flex">
          <ChatIllustration className="h-36 w-auto" />
          <h2 className="mt-3 text-[15px] font-semibold text-ink">Pick a conversation</h2>
          <p className="mt-1 max-w-sm text-[12.5px] text-muted">
            Channels, project rooms and direct messages. Secrets are blocked before they’re sent,
            and every channel has its own permissions.
          </p>
          <button
            onClick={() => setNewOpen(true)}
            className="mt-3 h-8 rounded-md bg-ink px-3 text-[12.5px] font-semibold text-white hover:bg-ink/90"
          >
            Start a conversation
          </button>
        </section>
      )}

      {/* Desktop rail */}
      {channel && railOpen && (
        <aside className="hidden w-[300px] shrink-0 border-l border-line xl:block">
          <ChatRail
            channel={channel}
            tab={railTab}
            onTab={setRailTab}
            threadId={threadId}
            onThread={openThread}
            onSettings={() => setSettings(true)}
            onClose={() => setRailOpen(false)}
            online={online}
          />
        </aside>
      )}

      {channel && (
        <ChannelSettingsModal
          channel={channel}
          open={settings}
          onClose={() => setSettings(false)}
        />
      )}
      <NewChannelModal open={newOpen} onClose={() => setNewOpen(false)} />
      {channelId && !channel && <MissingChannel onBack={() => navigate('/messages')} />}
    </div>
  );
}

const realtimeCopy: Record<RealtimeStatus, { label: string; dot: string }> = {
  live: { label: 'Live — new messages arrive instantly', dot: 'bg-ok' },
  connecting: { label: 'Connecting to live updates…', dot: 'bg-warn' },
  reconnecting: { label: 'Reconnecting to live updates…', dot: 'bg-warn' },
  polling: {
    label: 'Live updates unavailable — refreshing every 15 seconds',
    dot: 'bg-line-strong',
  },
  off: { label: 'Live updates off', dot: 'bg-line-strong' },
};

function RealtimeDot({ status }: { status: RealtimeStatus }) {
  const c = realtimeCopy[status];
  return (
    <span
      className="flex h-7 w-6 items-center justify-center"
      title={c.label}
      role="img"
      aria-label={c.label}
    >
      <span className={`h-2 w-2 rounded-full ${c.dot}`} aria-hidden />
    </span>
  );
}

function HeaderBtn({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`rounded-md p-1.5 transition-colors duration-150 ${active ? 'bg-sunken text-ink' : 'text-muted hover:bg-sunken hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

function MissingChannel({ onBack }: { onBack: () => void }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/90 p-6 text-center">
      <div>
        <LockIcon className="mx-auto h-6 w-6 text-muted" />
        <p className="mt-2 text-[13px] font-semibold text-ink">
          This conversation is private or no longer exists
        </p>
        <button
          onClick={onBack}
          className="mt-2 text-[12.5px] font-medium text-accent hover:underline"
        >
          Back to messages
        </button>
      </div>
    </div>
  );
}
