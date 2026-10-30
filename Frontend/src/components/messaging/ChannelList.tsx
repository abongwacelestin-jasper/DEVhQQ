import { Link } from 'react-router-dom';
import {
  HashIcon,
  LockIcon,
  MegaphoneIcon,
  PenSquareIcon,
  SearchIcon,
  FolderKanbanIcon,
} from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { ProductMark } from '../ui/ProductMark';
import { useMessaging } from '../../contexts/MessagingContext';
import { useAuth } from '../../contexts/AuthContext';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { relative } from '../../utils/date';
import type { Channel } from '../../types/messaging';

export type ListView = 'all' | 'unread' | 'mentions' | 'dms' | 'projects';

interface ChannelListProps {
  activeId?: string;
  q: string;
  view: ListView;
  product: string;
  onChange: (k: 'q' | 'view' | 'product', v: string) => void;
  onNew: () => void;
}

/** Left column: searchable, filterable conversations grouped by kind with unread and mention counts. */
export function ChannelList({ activeId, q, view, product, onChange, onNew }: ChannelListProps) {
  const { visible, messages, unread, mentions } = useMessaging();
  const { session } = useAuth();
  const { allowedProducts } = useProductFilter();
  const me = session?.memberId ?? 'm1';

  const last = (id: string) =>
    [...messages].reverse().find((m) => m.channelId === id && !m.threadOf);
  const dmPeer = (c: Channel) => c.members.find((x) => x !== me) ?? me;

  const list = visible
    .filter((c) => (c.kind !== 'dm' ? true : c.members.includes(me)))
    .filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q.toLowerCase()) ||
        c.topic.toLowerCase().includes(q.toLowerCase()) ||
        messages.some(
          (m) => m.channelId === c.id && m.text.toLowerCase().includes(q.toLowerCase()),
        ),
    )
    .filter((c) => !product || c.product === product)
    .filter((c) =>
      view === 'unread'
        ? unread(c.id) > 0
        : view === 'mentions'
          ? mentions(c.id) > 0
          : view === 'dms'
            ? c.kind === 'dm'
            : view === 'projects'
              ? c.kind === 'project'
              : true,
    )
    .sort((a, b) => (last(b.id)?.at ?? '').localeCompare(last(a.id)?.at ?? ''));

  const groups: { title: string; items: Channel[] }[] = [
    {
      title: 'Channels',
      items: list.filter((c) => c.kind === 'channel' || c.kind === 'announcement'),
    },
    { title: 'Projects', items: list.filter((c) => c.kind === 'project') },
    { title: 'Direct messages', items: list.filter((c) => c.kind === 'dm') },
  ].filter((g) => g.items.length > 0);

  const views: { id: ListView; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'mentions', label: 'Mentions' },
    { id: 'dms', label: 'DMs' },
    { id: 'projects', label: 'Projects' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">Messages</h1>
          <button
            onClick={onNew}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-ink px-2 text-[12px] font-semibold text-white hover:bg-ink/90"
          >
            <PenSquareIcon className="h-3.5 w-3.5" /> New
          </button>
        </div>
        <label className="relative block">
          <span className="sr-only">Search conversations</span>
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => onChange('q', e.target.value)}
            placeholder="Search people, channels, messages"
            className="h-8 w-full rounded-md border border-line bg-white pl-7 pr-2 text-[12.5px] text-ink outline-none placeholder:text-subtle focus:border-accent"
          />
        </label>
        <div
          className="flex items-center gap-1 overflow-x-auto scroll-thin"
          role="tablist"
          aria-label="Conversation filter"
        >
          {views.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              onClick={() => onChange('view', v.id === 'all' ? '' : v.id)}
              className={`h-6 shrink-0 rounded-full px-2.5 text-[11.5px] font-medium transition-colors duration-150 ${view === v.id ? 'bg-ink text-white' : 'bg-sunken text-ink hover:bg-line'}`}
            >
              {v.label}
            </button>
          ))}
          <select
            value={product}
            onChange={(e) => onChange('product', e.target.value)}
            aria-label="Product"
            className="ml-auto h-6 shrink-0 rounded-full border border-line bg-white px-1.5 text-[11.5px] text-ink"
          >
            <option value="">All products</option>
            {allowedProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <nav
        className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5 scroll-thin"
        aria-label="Conversations"
      >
        {groups.length === 0 && (
          <p className="px-2 py-6 text-center text-[12.5px] text-muted">
            No conversations match these filters.
          </p>
        )}
        {groups.map((g) => (
          <section key={g.title} className="mb-2">
            <h2 className="px-2 pb-1 pt-1.5 text-[11px] font-semibold text-muted">{g.title}</h2>
            <ul className="space-y-px">
              {g.items.map((c) => {
                const l = last(c.id);
                const n = c.members.includes(me) ? unread(c.id) : 0;
                const at = mentions(c.id);
                const active = c.id === activeId;
                const notMember = !c.members.includes(me);
                return (
                  <li key={c.id}>
                    <Link
                      to={`/messages/${c.id}`}
                      aria-current={active ? 'page' : undefined}
                      className={`grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 ${active ? 'bg-ink text-white' : 'hover:bg-sunken'}`}
                    >
                      <span className="flex h-7 w-7 items-center justify-center">
                        {c.kind === 'dm' ? (
                          <Avatar id={dmPeer(c)} size="md" />
                        ) : c.product ? (
                          <ProductMark product={c.product} size="sm" />
                        ) : (
                          <span
                            className={`flex h-7 w-7 items-center justify-center rounded-md ${active ? 'bg-white/15' : 'bg-sunken text-ink'}`}
                          >
                            {c.kind === 'announcement' ? (
                              <MegaphoneIcon className="h-3.5 w-3.5" />
                            ) : c.private ? (
                              <LockIcon className="h-3.5 w-3.5" />
                            ) : c.kind === 'project' ? (
                              <FolderKanbanIcon className="h-3.5 w-3.5" />
                            ) : (
                              <HashIcon className="h-3.5 w-3.5" />
                            )}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={`flex items-center gap-1 truncate text-[12.5px] ${n ? 'font-semibold' : 'font-medium'} ${active ? 'text-white' : 'text-ink'}`}
                        >
                          {c.kind !== 'dm' && (
                            <span className={active ? 'text-white/60' : 'text-muted'}>#</span>
                          )}
                          <span className="truncate">{c.name}</span>
                          {c.private && c.kind !== 'dm' && (
                            <LockIcon
                              className={`h-3 w-3 shrink-0 ${active ? 'text-white/60' : 'text-muted'}`}
                            />
                          )}
                        </span>
                        <span
                          className={`block truncate text-[11.5px] ${active ? 'text-white/70' : 'text-muted'}`}
                        >
                          {notMember ? 'Public · not joined' : l ? preview(l) : c.topic}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-0.5">
                        {l && (
                          <span
                            className={`text-[10.5px] tabular-nums ${active ? 'text-white/60' : 'text-muted'}`}
                          >
                            {relative(new Date(l.at)).replace(' ago', '')}
                          </span>
                        )}
                        {at > 0 ? (
                          <span className="min-w-[18px] rounded-full bg-bad px-1 text-center text-[10px] font-bold leading-4 text-white">
                            @{at}
                          </span>
                        ) : n > 0 ? (
                          <span
                            className={`min-w-[18px] rounded-full px-1 text-center text-[10px] font-bold leading-4 ${active ? 'bg-white text-ink' : 'bg-accent text-white'}`}
                          >
                            {n}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  );
}

function preview(m: {
  kind: string;
  text: string;
  poll?: { question: string };
  file?: { name: string };
}) {
  if (m.kind === 'sticker') return 'Sent a sticker';
  if (m.kind === 'code') return 'Shared a code snippet';
  if (m.kind === 'poll') return `Poll: ${m.poll?.question}`;
  if (m.kind === 'file') return `File: ${m.file?.name}`;
  return m.text || 'Message deleted';
}
