import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  CheckIcon,
  CopyIcon,
  FileIcon,
  ListPlusIcon,
  MessageSquareReplyIcon,
  PencilIcon,
  PinIcon,
  SmilePlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Sticker } from './Sticker';
import { useMessaging } from '../../contexts/MessagingContext';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { useAuth } from '../../contexts/AuthContext';
import { emojiSet } from '../../data/messaging';
import { memberById } from '../../utils/status';
import { formatTime } from '../../utils/date';
import type { Channel, Message } from '../../types/messaging';

interface MessageItemProps {
  message: Message;
  channel: Channel;
  compact?: boolean;
  replies?: number;
  onThread?: (id: string) => void;
  highlight?: string;
}

const tokenRe = /(@[A-Za-z]+|\b(?:RB|BL|MA)-\d+\b|\bINC-\d+\b|(?:^|\s)#\d{2,3}\b|https?:\/\/\S+)/g;

export function MessageItem({
  message: m,
  channel,
  compact = false,
  replies = 0,
  onThread,
  highlight,
}: MessageItemProps) {
  const { react, edit, remove, togglePin, vote, canModerate } = useMessaging();
  const { openCreateTask } = useWorkspaceUI();
  const { session } = useAuth();
  const me = session?.memberId ?? 'm1';
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const author = memberById(m.author);
  const mine = m.author === me;
  const mod = canModerate(channel);

  if (m.kind === 'system') {
    return (
      <p className="py-1 text-center text-[11.5px] text-muted">
        <b className="font-semibold text-ink">{author.name}</b> {m.text} ·{' '}
        {formatTime(new Date(m.at))}
      </p>
    );
  }

  const saveEdit = () => {
    if (draft.trim() && draft !== m.text) edit(m.id, draft.trim());
    setEditing(false);
  };

  return (
    <article
      className={`group relative grid grid-cols-[32px_minmax(0,1fr)] gap-x-2.5 rounded-md px-2 transition-colors duration-150 hover:bg-white/80 ${compact ? 'py-0.5' : 'pt-2 pb-1'} ${m.pinned ? 'bg-warn-soft/40' : ''}`}
    >
      <div className="pt-0.5">
        {compact ? (
          <span className="block w-8 pt-0.5 text-right text-[10px] tabular-nums text-transparent group-hover:text-muted">
            {formatTime(new Date(m.at))}
          </span>
        ) : (
          <Avatar id={m.author} size="md" />
        )}
      </div>
      <div className="min-w-0">
        {!compact && (
          <p className="flex items-baseline gap-1.5">
            <span className="text-[12.5px] font-semibold text-ink">{author.name}</span>
            <span className="text-[11px] text-muted">{author.role}</span>
            <time className="text-[11px] tabular-nums text-muted">
              {formatTime(new Date(m.at))}
            </time>
            {m.pinned && <PinIcon className="h-3 w-3 text-warn" aria-label="Pinned" />}
          </p>
        )}

        {m.deleted ? (
          <p className="text-[12.5px] italic text-muted">Message deleted</p>
        ) : editing ? (
          <div className="mt-0.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                }
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
              rows={2}
              className="w-full resize-none rounded-md border border-accent bg-white px-2 py-1.5 text-[12.5px] text-ink outline-none"
            />

            <p className="text-[11px] text-muted">Enter to save · Esc to cancel</p>
          </div>
        ) : (
          <>
            {m.text && (
              <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-ink">
                {renderText(m.text, channel.permissions.externalLinks, highlight)}
                {m.edited && <span className="ml-1 text-[11px] text-muted">(edited)</span>}
              </p>
            )}
            {m.kind === 'sticker' && m.sticker && (
              <div className="mt-1">
                <Sticker id={m.sticker} size={104} />
              </div>
            )}
            {m.kind === 'code' && m.code && (
              <div className="mt-1 overflow-hidden rounded-md border border-line bg-[#0F1115]">
                <div className="flex items-center justify-between border-b border-[#ffffff1a] px-2.5 py-1 text-[11px] text-[#E5E7EB]/70">
                  <span className="font-mono">{m.code.lang}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(m.code?.content ?? '');
                      toast.success('Snippet copied');
                    }}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    <CopyIcon className="h-3 w-3" /> Copy
                  </button>
                </div>
                <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed text-[#E5E7EB] scroll-thin">
                  {m.code.content}
                </pre>
              </div>
            )}
            {m.kind === 'file' && m.file && (
              <div className="mt-1 inline-flex max-w-full items-center gap-2.5 rounded-md border border-line bg-white px-2.5 py-1.5">
                <span className="flex h-8 w-8 items-center justify-center rounded bg-accent-soft text-accent">
                  <FileIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink">
                    {m.file.name}
                  </span>
                  <span className="text-[11px] text-muted">
                    {formatSize(m.file.size)} · scanned, no malware
                  </span>
                </span>
              </div>
            )}
            {m.kind === 'poll' && m.poll && (
              <div className="mt-1 max-w-md rounded-lg border border-line bg-white p-2.5">
                <p className="text-[12.5px] font-semibold text-ink">{m.poll.question}</p>
                <ul className="mt-1.5 space-y-1">
                  {m.poll.options.map((o, i) => {
                    const total = m.poll!.options.reduce((s, x) => s + x.votes.length, 0) || 1;
                    const pct = Math.round((o.votes.length / total) * 100);
                    const voted = o.votes.includes(me);
                    return (
                      <li key={o.label}>
                        <button
                          onClick={() => vote(m.id, i)}
                          className={`relative flex w-full items-center justify-between overflow-hidden rounded-md border px-2 py-1 text-left text-[12px] ${voted ? 'border-accent' : 'border-line hover:border-line-strong'}`}
                        >
                          <span
                            className={`absolute inset-y-0 left-0 ${voted ? 'bg-accent-soft' : 'bg-sunken'}`}
                            style={{ width: `${pct}%` }}
                            aria-hidden
                          />
                          <span className="relative flex items-center gap-1 font-medium text-ink">
                            {voted && <CheckIcon className="h-3 w-3 text-accent" />}
                            {o.label}
                          </span>
                          <span className="relative tabular-nums text-muted">
                            {o.votes.length} · {pct}%
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}

        {Object.keys(m.reactions).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(m.reactions).map(([emoji, who]) => (
              <button
                key={emoji}
                onClick={() => channel.permissions.reactions && react(m.id, emoji)}
                title={who.map((w) => memberById(w).name).join(', ')}
                className={`inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-[12px] transition-colors duration-150 ${who.includes(me) ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-white text-ink hover:border-line-strong'}`}
              >
                <span>{emoji}</span>
                <span className="text-[11px] font-semibold tabular-nums">{who.length}</span>
              </button>
            ))}
          </div>
        )}

        {replies > 0 && onThread && (
          <button
            onClick={() => onThread(m.id)}
            className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-accent hover:underline"
          >
            <MessageSquareReplyIcon className="h-3.5 w-3.5" /> {replies}{' '}
            {replies === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>

      {!m.deleted && !editing && (
        <div className="absolute -top-3 right-2 hidden items-center gap-0.5 rounded-md border border-line bg-white p-0.5 shadow-sm group-hover:flex group-focus-within:flex">
          {channel.permissions.reactions && (
            <>
              {['👍', '🎉', '👀'].map((e) => (
                <button
                  key={e}
                  onClick={() => react(m.id, e)}
                  className="rounded px-1 py-0.5 text-[13px] hover:bg-sunken"
                  aria-label={`React ${e}`}
                >
                  {e}
                </button>
              ))}
              <button
                onClick={() => setPicker((v) => !v)}
                className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"
                aria-label="More reactions"
              >
                <SmilePlusIcon className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {channel.permissions.threads && onThread && !m.threadOf && (
            <button
              onClick={() => onThread(m.id)}
              className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"
              aria-label="Reply in thread"
            >
              <MessageSquareReplyIcon className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() =>
              openCreateTask({
                title: (m.text || m.poll?.question || 'Follow up from chat').slice(0, 80),
              })
            }
            className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"
            aria-label="Create task from message"
          >
            <ListPlusIcon className="h-3.5 w-3.5" />
          </button>
          {mod && (
            <button
              onClick={() => togglePin(m.id)}
              className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"
              aria-label={m.pinned ? 'Unpin' : 'Pin'}
            >
              <PinIcon className="h-3.5 w-3.5" />
            </button>
          )}
          {mine && m.kind === 'text' && (
            <button
              onClick={() => {
                setDraft(m.text);
                setEditing(true);
              }}
              className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"
              aria-label="Edit"
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
          )}
          {(mine || mod) && (
            <button
              onClick={() => {
                remove(m.id);
                toast('Message deleted', {
                  description: mine ? undefined : 'Moderator action recorded in the audit log.',
                });
              }}
              className="rounded p-1 text-muted hover:bg-bad-soft hover:text-bad"
              aria-label="Delete"
            >
              <Trash2Icon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <AnimatePresence>
        {picker && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            className="absolute right-2 top-5 z-20 grid w-[232px] origin-top-right grid-cols-8 gap-0.5 rounded-lg border border-line bg-white p-1.5 shadow-pop"
            onMouseLeave={() => setPicker(false)}
          >
            {emojiSet.map((e) => (
              <button
                key={e}
                onClick={() => {
                  react(m.id, e);
                  setPicker(false);
                }}
                className="rounded p-1 text-[15px] hover:bg-sunken"
                aria-label={`React ${e}`}
              >
                {e}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

function renderText(text: string, allowLinks: boolean, highlight?: string) {
  const parts = text.split(tokenRe);
  return parts.map((p, i) => {
    if (!p) return null;
    const t = p.trim();
    if (/^@[A-Za-z]+$/.test(p))
      return (
        <span key={i} className="rounded bg-accent-soft px-0.5 font-medium text-accent-ink">
          {p}
        </span>
      );
    if (/^(RB|BL|MA)-\d+$/.test(p))
      return (
        <Link
          key={i}
          to={`/tasks/${p}`}
          className="font-mono text-[12px] font-medium text-accent hover:underline"
        >
          {p}
        </Link>
      );
    if (/^INC-\d+$/.test(p))
      return (
        <Link
          key={i}
          to={`/incidents/${p}`}
          className="font-mono text-[12px] font-medium text-bad hover:underline"
        >
          {p}
        </Link>
      );
    if (/^#\d{2,3}$/.test(t))
      return (
        <React.Fragment key={i}>
          {p.startsWith(' ') ? ' ' : ''}
          <Link
            to={`/pull-requests/${t.slice(1)}`}
            className="font-medium text-accent hover:underline"
          >
            {t}
          </Link>
        </React.Fragment>
      );
    if (/^https?:\/\//.test(p))
      return allowLinks ? (
        <a
          key={i}
          href={p}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-accent underline"
        >
          {p}
        </a>
      ) : (
        <span
          key={i}
          className="text-muted line-through"
          title="External links are disabled in this channel"
        >
          {p}
        </span>
      );
    if (highlight && highlight.length > 1) {
      const re = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
      return p.split(re).map((s, j) =>
        re.test(s) && s.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={`${i}-${j}`} className="rounded bg-warn-soft px-0.5 text-ink">
            {s}
          </mark>
        ) : (
          <React.Fragment key={`${i}-${j}`}>{s}</React.Fragment>
        ),
      );
    }
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

export function formatSize(b: number) {
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  if (b > 1000) return `${Math.round(b / 1000)} KB`;
  return `${b} B`;
}
