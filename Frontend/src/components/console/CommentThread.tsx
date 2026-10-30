import React, { useEffect, useState } from 'react';
import { CheckIcon, MessageSquareIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { ago } from './ConsoleBits';

export interface PayloadComment {
  id: string;
  /** Thread key: "METHOD path" so comments follow a route, not a single response. */
  thread: string;
  /** Optional JSON path the comment points at, e.g. "$.items[0].status". */
  anchor?: string;
  authorId: string;
  author: string;
  text: string;
  at: number;
  resolved?: boolean;
}

const KEY = 'devhq.console.comments';
const CHANNEL = 'devhq.console.comments';

const SEED: PayloadComment[] = [
  {
    id: 's1',
    thread: 'GET /api/tasks',
    anchor: '$[0].status',
    authorId: 'm11',
    author: 'Grace Liu',
    text: 'Tasks moved to review still show in-progress here for ~2s — cache TTL on the list endpoint?',
    at: Date.now() - 42 * 60_000,
  },
  {
    id: 's2',
    thread: 'GET /api/tasks',
    authorId: 'm4',
    author: 'Daniel Mensah',
    text: 'Yes, 5s TTL. Dropping it to 1s behind the flag in RB-231.',
    at: Date.now() - 31 * 60_000,
  },
  {
    id: 's3',
    thread: 'POST /api/deployments/:id/approve',
    authorId: 'm11',
    author: 'Grace Liu',
    text: '500 here is the migration lock timeout — retry after the lock clears, don’t re-approve.',
    at: Date.now() - 3 * 3600_000,
  },
];

function load(): PayloadComment[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PayloadComment[]) : SEED;
  } catch {
    return SEED;
  }
}

/** Normalises concrete paths to their route shape so a thread survives different ids. */
export function threadKey(method: string, url: string): string {
  const path = url
    .split('?')[0]
    .replace(/\/(?:[A-Z]{2,3}-\d+|dp-\d+|INC-\d+|[0-9a-f-]{8,})(?=\/|$)/g, '/:id');
  return `${method} ${path}`;
}

/** Inline discussion attached to a route's responses, synced across open tabs. */
export function CommentThread({
  thread,
  me,
}: {
  thread: string;
  me: { id: string; name: string };
}) {
  const [all, setAll] = useState<PayloadComment[]>(load);
  const [text, setText] = useState('');
  const [anchor, setAnchor] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = () => setAll(load());
    return () => ch.close();
  }, []);

  const commit = (next: PayloadComment[]) => {
    setAll(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage full */
    }
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(CHANNEL);
      ch.postMessage('changed');
      ch.close();
    }
  };

  const items = all.filter((c) => c.thread === thread);
  const visible = items.filter((c) => showResolved || !c.resolved);
  const resolvedCount = items.filter((c) => c.resolved).length;

  const post = (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    commit([
      ...all,
      {
        id: crypto.randomUUID(),
        thread,
        anchor: anchor.trim() || undefined,
        authorId: me.id,
        author: me.name,
        text: body,
        at: Date.now(),
      },
    ]);
    setText('');
    setAnchor('');
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11.5px] text-muted">
        <MessageSquareIcon className="h-3.5 w-3.5" />
        <span className="truncate font-mono">{thread}</span>
        {resolvedCount > 0 && (
          <label className="ml-auto flex shrink-0 items-center gap-1">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />{' '}
            {resolvedCount} resolved
          </label>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="px-3 py-6 text-center text-[12px] text-muted">
          No comments on this route yet. Flag something odd in the payload for your team.
        </p>
      ) : (
        <ul className="scroll-thin max-h-[300px] divide-y divide-line overflow-y-auto">
          {visible.map((c) => (
            <li key={c.id} className={`group px-3 py-2 ${c.resolved ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-2 text-[11.5px]">
                <span className="font-semibold text-ink">{c.author}</span>
                <span className="text-subtle">{ago(c.at)}</span>
                {c.anchor && (
                  <code className="rounded bg-sunken px-1 font-mono text-[10.5px] text-accent-ink">
                    {c.anchor}
                  </code>
                )}
                <span className="ml-auto flex gap-0.5 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    onClick={() =>
                      commit(all.map((x) => (x.id === c.id ? { ...x, resolved: !x.resolved } : x)))
                    }
                    aria-label={c.resolved ? 'Reopen' : 'Resolve'}
                    title={c.resolved ? 'Reopen' : 'Resolve'}
                    className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-sunken hover:text-ok"
                  >
                    {c.resolved ? (
                      <RotateCcwIcon className="h-3.5 w-3.5" />
                    ) : (
                      <CheckIcon className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {c.authorId === me.id && (
                    <button
                      onClick={() => commit(all.filter((x) => x.id !== c.id))}
                      aria-label="Delete comment"
                      className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-bad-soft hover:text-bad"
                    >
                      <Trash2Icon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-5 text-ink">{c.text}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={post} className="grid gap-1.5 border-t border-line p-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') post(e);
          }}
          rows={2}
          placeholder="Comment on this response…"
          aria-label="Comment"
          className="w-full resize-none rounded-md border border-line-strong bg-white px-2 py-1.5 text-[12px] outline-none focus:border-accent"
        />
        <div className="flex items-center gap-1.5">
          <input
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
            placeholder="$.path (optional)"
            aria-label="JSON path"
            spellCheck={false}
            className="h-7 min-w-0 flex-1 rounded-md border border-line bg-white px-2 font-mono text-[11px] outline-none focus:border-accent"
          />
          <button
            disabled={!text.trim()}
            className="h-7 shrink-0 rounded-md bg-ink px-2.5 text-[11.5px] font-semibold text-canvas disabled:opacity-40"
          >
            Comment
          </button>
        </div>
      </form>
    </div>
  );
}
