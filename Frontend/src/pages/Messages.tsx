import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  BellOffIcon,
  FilterIcon,
  HashIcon,
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
import { ChatRail, type RailTab } from '../components/messaging/ChatRail';
import { ChannelSettingsModal } from '../components/messaging/ChannelSettingsModal';
import { NewChannelModal } from '../components/messaging/NewChannelModal';
import { ChatIllustration } from '../components/illustrations/ChatIllustration';
import { useMessaging } from '../contexts/MessagingContext';
import { useAuth } from '../contexts/AuthContext';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { chatBackgroundStyle } from '../utils/chatBackground';
import { formatDayHeading, startOfDay } from '../utils/date';
import { members } from '../data/team';

const keys = ['q', 'view', 'product', 'find', 'type', 'from'] as const;

export function Messages() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const { visible, messages, markRead } = useMessaging();
  const { session } = useAuth();
  const me = session?.memberId ?? 'm1';
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

  const channel = visible.find((c) => c.id === channelId);

  useEffect(() => {
    if (channel && channel.members.includes(me)) markRead(channel.id);
    setThreadId(null);
    setRailTab('about');
  }, [channel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeline = useMemo(() => {
    if (!channel) return [];
    return messages.filter(
      (m) =>
        m.channelId === channel.id &&
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

  const lastLen = useRef(0);
  useEffect(() => {
    if (timeline.length > lastLen.current) endRef.current?.scrollIntoView({ block: 'end' });
    lastLen.current = timeline.length;
  }, [timeline.length, channel?.id]);

  const replyCount = (id: string) => messages.filter((m) => m.threadOf === id && !m.deleted).length;
  const openThread = (id: string | null) => {
    setThreadId(id);
    if (id) {
      setRailTab('thread');
      setRailOpen(true);
    }
  };

  const filtering = !!(v.find || v.from || v.type);
  const peer = channel?.kind === 'dm' ? channel.members.find((x) => x !== me) : undefined;

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
                {peer
                  ? `${members.find((m) => m.id === peer)?.role} · ${members.find((m) => m.id === peer)?.lastActive === 'Now' ? 'Active now' : `Active ${members.find((m) => m.id === peer)?.lastActive} ago`}`
                  : channel.topic}
              </p>
            </div>
            <div className="flex items-center gap-0.5">
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
                    muted[channel.id] ? 'Notifications on' : 'Muted — mentions still notify you',
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
                placeholder="Find in conversation"
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
                    {members.find((m) => m.id === id)?.name}
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
            className="min-h-0 flex-1 overflow-y-auto px-2 py-2 scroll-thin"
            style={chatBackgroundStyle(channel.background)}
          >
            {timeline.length === 0 && (
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
                <React.Fragment key={m.id}>
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
