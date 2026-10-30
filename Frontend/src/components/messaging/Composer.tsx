import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AtSignIcon,
  BarChart3Icon,
  Code2Icon,
  ListPlusIcon,
  LockIcon,
  PaperclipIcon,
  PlusIcon,
  SendHorizonalIcon,
  SmileIcon,
  StickerIcon,
  XIcon,
} from 'lucide-react';
import { Sticker, stickerList } from './Sticker';
import { Avatar } from '../ui/Avatar';
import { useMessaging } from '../../contexts/MessagingContext';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { useAuth } from '../../contexts/AuthContext';
import { emojiSet } from '../../data/messaging';
import { members } from '../../data/team';
import type { Channel } from '../../types/messaging';

type Popover = 'emoji' | 'sticker' | 'tools' | 'mention' | null;
type Mode = 'text' | 'code' | 'poll';

const secretRe =
  /(sk_live_[A-Za-z0-9]{6,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{12,}|xox[bp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const linkRe = /https?:\/\/\S+/;

/** Message composer with emoji, stickers, code snippets, polls, files, mentions and slash commands — all gated by channel permissions. */
export function Composer({
  channel,
  threadOf,
  compact = false,
}: {
  channel: Channel;
  threadOf?: string;
  compact?: boolean;
}) {
  const { send, canPost, join, canModerate } = useMessaging();
  const { session } = useAuth();
  const { openCreateTask } = useWorkspaceUI();
  const [text, setText] = useState('');
  const [pop, setPop] = useState<Popover>(null);
  const [mode, setMode] = useState<Mode>('text');
  const [lang, setLang] = useState('ts');
  const [options, setOptions] = useState(['', '']);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const p = channel.permissions;
  const chanMembers = members.filter((m) => channel.members.includes(m.id));

  if (!canPost(channel)) {
    const isMember = channel.members.includes(session?.memberId ?? '');
    return (
      <div className="flex items-center justify-between gap-2 border-t border-line bg-sunken/50 px-3 py-2.5 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <LockIcon className="h-3.5 w-3.5" />
          {channel.archived
            ? 'This channel is archived.'
            : channel.permissions.post === 'admins'
              ? 'Only channel admins can post here. You can react and reply in threads.'
              : 'Join the channel to post.'}
        </span>
        {!channel.archived && channel.permissions.post === 'members' && !isMember && (
          <button
            onClick={() => join(channel.id)}
            className="h-7 rounded-md bg-ink px-2.5 text-[12px] font-semibold text-white hover:bg-ink/90"
          >
            Join
          </button>
        )}
      </div>
    );
  }

  const reset = () => {
    setText('');
    setMode('text');
    setOptions(['', '']);
    setError('');
    setPop(null);
  };

  const submit = () => {
    const body = text.trim();
    if (secretRe.test(body))
      return setError(
        'This looks like a secret or private key. It was not sent — store it in Integrations → credentials instead.',
      );
    if (!p.externalLinks && linkRe.test(body))
      return setError('External links are disabled in this channel by its admins.');
    if (/@(channel|everyone)\b/i.test(body) && p.mentionAll === 'admins' && !canModerate(channel))
      return setError('Only admins can notify the whole channel here.');

    if (mode === 'code') {
      if (!body) return;
      send({
        channelId: channel.id,
        kind: 'code',
        text: '',
        code: { lang, content: body },
        threadOf,
      });
      return reset();
    }
    if (mode === 'poll') {
      const opts = options.map((o) => o.trim()).filter(Boolean);
      if (!body || opts.length < 2)
        return setError('A poll needs a question and at least two options.');
      send({
        channelId: channel.id,
        kind: 'poll',
        text: '',
        poll: { question: body, options: opts.map((label) => ({ label, votes: [] })) },
        threadOf,
      });
      return reset();
    }
    if (!body) return;
    // Slash commands
    if (body.startsWith('/')) {
      const [cmd, ...rest] = body.slice(1).split(' ');
      const arg = rest.join(' ').trim();
      if (cmd === 'shrug') {
        send({ channelId: channel.id, kind: 'text', text: `${arg} ¯\\_(ツ)_/¯`.trim(), threadOf });
        return reset();
      }
      if (cmd === 'task') {
        openCreateTask({ title: arg || 'Follow up from chat' });
        return reset();
      }
      if (cmd === 'poll') {
        const [q, ...opts] = arg.split('|').map((s) => s.trim());
        if (q && opts.length >= 2) {
          send({
            channelId: channel.id,
            kind: 'poll',
            text: '',
            poll: { question: q, options: opts.map((label) => ({ label, votes: [] })) },
            threadOf,
          });
          return reset();
        }
        return setError('Use /poll Question | Option A | Option B');
      }
      if (cmd === 'code') {
        setMode('code');
        setText(arg);
        return;
      }
      return setError(`Unknown command /${cmd}. Try /task, /poll, /code or /shrug.`);
    }
    send({ channelId: channel.id, kind: 'text', text: body, threadOf });
    reset();
  };

  const insert = (s: string) => {
    setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}${s} `);
    setPop(null);
    taRef.current?.focus();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 25_000_000)
      return setError('Files over 25 MB are blocked. Share via the docs storage instead.');
    if (/\.(exe|bat|sh|ps1|cmd)$/i.test(f.name))
      return setError('Executable files are blocked for security.');
    send({
      channelId: channel.id,
      kind: 'file',
      text: text.trim(),
      file: { name: f.name, size: f.size, type: f.type || 'file' },
      threadOf,
    });
    toast.success('File shared', { description: 'Scanned for malware before delivery.' });
    reset();
  };

  return (
    <div
      className={`relative border-t border-line bg-white ${compact ? 'px-2 py-2' : 'px-3 py-2.5'}`}
    >
      {error && (
        <p
          role="alert"
          className="mb-1.5 flex items-start gap-1.5 rounded-md bg-bad-soft px-2 py-1 text-[11.5px] font-medium text-bad"
        >
          <LockIcon className="mt-0.5 h-3 w-3 shrink-0" /> <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss">
            <XIcon className="h-3 w-3" />
          </button>
        </p>
      )}
      {mode !== 'text' && (
        <div className="mb-1.5 flex items-center gap-2 text-[11.5px]">
          <span className="rounded bg-ink px-1.5 py-0.5 font-semibold text-white">
            {mode === 'code' ? 'Code snippet' : 'Poll'}
          </span>
          {mode === 'code' && (
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="h-6 rounded border border-line px-1 text-[11.5px]"
              aria-label="Language"
            >
              {['ts', 'tsx', 'js', 'sql', 'bash', 'json', 'yaml', 'css'].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          )}
          <button onClick={() => setMode('text')} className="ml-auto text-muted hover:text-ink">
            Cancel
          </button>
        </div>
      )}
      <div
        className={`rounded-lg border border-line-strong focus-within:border-accent ${mode === 'code' ? 'bg-[#0F1115]' : 'bg-white'}`}
      >
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
            if (e.target.value.endsWith('@')) setPop('mention');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && mode !== 'code') {
              e.preventDefault();
              submit();
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={mode === 'code' ? 5 : compact ? 1 : 2}
          placeholder={
            mode === 'poll'
              ? 'Ask a question…'
              : mode === 'code'
                ? 'Paste code — ⌘/Ctrl+Enter to send'
                : threadOf
                  ? 'Reply in thread…'
                  : `Message ${channel.kind === 'dm' ? channel.name : `#${channel.name}`} — try /task or /poll`
          }
          aria-label="Message"
          className={`block w-full resize-none bg-transparent px-2.5 py-2 text-[13px] outline-none placeholder:text-subtle ${mode === 'code' ? 'font-mono text-[12px] text-[#E5E7EB]' : 'text-ink'}`}
        />

        {mode === 'poll' && (
          <div className="space-y-1 px-2.5 pb-2">
            {options.map((o, i) => (
              <input
                key={i}
                value={o}
                onChange={(e) => setOptions((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`Option ${i + 1}`}
                className="h-7 w-full rounded border border-line px-2 text-[12px] outline-none focus:border-accent"
              />
            ))}
            {options.length < 6 && (
              <button
                onClick={() => setOptions((l) => [...l, ''])}
                className="text-[11.5px] font-medium text-accent"
              >
                + Add option
              </button>
            )}
          </div>
        )}
        <div
          className={`flex items-center gap-0.5 px-1.5 pb-1.5 ${mode === 'code' ? 'text-[#E5E7EB]/70' : 'text-muted'}`}
        >
          <IconBtn label="Tools" onClick={() => setPop(pop === 'tools' ? null : 'tools')}>
            <PlusIcon className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Emoji" onClick={() => setPop(pop === 'emoji' ? null : 'emoji')}>
            <SmileIcon className="h-4 w-4" />
          </IconBtn>
          {p.stickers && (
            <IconBtn label="Stickers" onClick={() => setPop(pop === 'sticker' ? null : 'sticker')}>
              <StickerIcon className="h-4 w-4" />
            </IconBtn>
          )}
          <IconBtn label="Mention" onClick={() => setPop(pop === 'mention' ? null : 'mention')}>
            <AtSignIcon className="h-4 w-4" />
          </IconBtn>
          {p.files && (
            <IconBtn label="Attach file" onClick={() => fileRef.current?.click()}>
              <PaperclipIcon className="h-4 w-4" />
            </IconBtn>
          )}
          <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
          <span className="ml-auto hidden text-[10.5px] sm:inline">
            {mode === 'code' ? '⌘↵ send' : '↵ send · ⇧↵ new line'}
          </span>
          <button
            onClick={submit}
            disabled={!text.trim()}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-md bg-ink text-white transition-opacity duration-150 disabled:opacity-30"
            aria-label="Send"
          >
            <SendHorizonalIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {pop && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            className="absolute bottom-full left-3 z-30 mb-1 origin-bottom-left rounded-lg border border-line bg-white p-1.5 shadow-pop"
          >
            {pop === 'emoji' && (
              <div className="grid w-[248px] grid-cols-8 gap-0.5">
                {emojiSet.map((e) => (
                  <button
                    key={e}
                    onClick={() => insert(e)}
                    className="rounded p-1 text-[16px] hover:bg-sunken"
                    aria-label={`Insert ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
            {pop === 'sticker' && (
              <div className="grid w-[264px] grid-cols-4 gap-1">
                {stickerList.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      send({
                        channelId: channel.id,
                        kind: 'sticker',
                        text: '',
                        sticker: s.id,
                        threadOf,
                      });
                      setPop(null);
                    }}
                    className="flex flex-col items-center rounded-md p-1 hover:bg-sunken"
                    title={s.label}
                  >
                    <Sticker id={s.id} size={52} />
                    <span className="mt-0.5 w-full truncate text-center text-[10px] text-muted">
                      {s.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {pop === 'mention' && (
              <ul className="max-h-56 w-56 overflow-y-auto scroll-thin">
                {chanMembers.map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => {
                        setText((t) => `${t.replace(/@$/, '')}@${m.name.split(' ')[0]} `);
                        setPop(null);
                        taRef.current?.focus();
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] text-ink hover:bg-sunken"
                    >
                      <Avatar id={m.id} size="xs" />{' '}
                      <span className="flex-1 truncate">{m.name}</span>
                      <span className="text-[11px] text-muted">{m.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {pop === 'tools' && (
              <ul className="w-56">
                <Tool
                  icon={Code2Icon}
                  label="Code snippet"
                  hint="Syntax-friendly block"
                  onClick={() => {
                    setMode('code');
                    setPop(null);
                  }}
                />
                <Tool
                  icon={BarChart3Icon}
                  label="Poll"
                  hint="Up to 6 options"
                  onClick={() => {
                    setMode('poll');
                    setPop(null);
                  }}
                />
                <Tool
                  icon={ListPlusIcon}
                  label="Create task"
                  hint="From what you typed"
                  onClick={() => {
                    openCreateTask({ title: text.trim().slice(0, 80) || 'Follow up from chat' });
                    setPop(null);
                  }}
                />
                {p.files && (
                  <Tool
                    icon={PaperclipIcon}
                    label="Upload file"
                    hint="Max 25 MB · scanned"
                    onClick={() => {
                      fileRef.current?.click();
                      setPop(null);
                    }}
                  />
                )}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded p-1 transition-colors duration-150 hover:bg-sunken hover:text-ink"
    >
      {children}
    </button>
  );
}

function Tool({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-sunken"
      >
        <Icon className="h-4 w-4 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium text-ink">{label}</span>
          <span className="block text-[11px] text-muted">{hint}</span>
        </span>
      </button>
    </li>
  );
}
