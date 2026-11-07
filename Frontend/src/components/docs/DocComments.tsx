import { useMemo, useState } from 'react';
import { CheckIcon, MessageSquareIcon, QuoteIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { DemoBadge, Unavailable } from '../work/Unavailable';
import { relative } from '../../utils/date';
import type { Member } from '../../types/team';
import type { Availability } from '../work/apiState';
import type { ApiDocComment, ApiDocCommentAnchor } from './useDocCollab';

interface DocCommentsProps {
  status: Availability;
  comments: ApiDocComment[];
  demo: boolean;
  error: string | null;
  /** Current doc body — anchors whose quote is gone are flagged as outdated. */
  body: string;
  /** Text the reader selected in the doc; the next comment anchors to it. */
  pendingAnchor: ApiDocCommentAnchor | null;
  onClearAnchor: () => void;
  memberById: (id: string) => Member;
  onAdd: (input: {
    text: string;
    anchor?: ApiDocCommentAnchor;
    parentId?: string;
  }) => Promise<boolean>;
  onResolve: (id: string, resolved: boolean) => void;
  onRetry: () => void;
}

type Filter = 'open' | 'resolved' | 'all';

/** Inline comment threads: anchored to a quote, replies nested, resolve/reopen. */
export function DocComments({
  status,
  comments,
  demo,
  error,
  body,
  pendingAnchor,
  onClearAnchor,
  memberById,
  onAdd,
  onResolve,
  onRetry,
}: DocCommentsProps) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');

  const threads = useMemo(() => {
    const roots = comments.filter((c) => !c.parentId);
    const replies = new Map<string, ApiDocComment[]>();
    comments
      .filter((c) => c.parentId)
      .forEach((c) => replies.set(c.parentId!, [...(replies.get(c.parentId!) ?? []), c]));
    return roots.map((root) => ({ root, replies: replies.get(root.id) ?? [] }));
  }, [comments]);

  if (status === 'loading')
    return (
      <div className="space-y-2 p-3" aria-busy="true">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  if (status === 'unavailable')
    return (
      <Unavailable
        compact
        title="Comments aren't available"
        detail="The doc-collab service isn't deployed on this server, so inline comments can't be stored."
        onRetry={onRetry}
      />
    );
  if (status === 'error')
    return (
      <Unavailable
        compact
        title="Couldn't load comments"
        detail={error ?? undefined}
        onRetry={onRetry}
      />
    );

  const shown = threads.filter(({ root }) =>
    filter === 'all' ? true : filter === 'open' ? !root.resolved : !!root.resolved,
  );

  const submit = async () => {
    const text = note.trim();
    if (!text || busy) return;
    setBusy(true);
    const ok = await onAdd({ text, anchor: pendingAnchor ?? undefined });
    setBusy(false);
    if (ok) {
      setNote('');
      onClearAnchor();
    }
  };

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center gap-1" role="group" aria-label="Show comments">
        {(['open', 'resolved', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`h-6 rounded-full px-2.5 text-[11.5px] font-medium capitalize ${filter === f ? 'bg-ink text-white' : 'bg-sunken text-ink hover:bg-line'}`}
          >
            {f}
          </button>
        ))}
        {demo && <DemoBadge className="ml-auto" />}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="mb-3"
      >
        {pendingAnchor ? (
          <div className="mb-1 flex items-start gap-1.5 rounded-md border-l-[3px] border-accent bg-accent-soft/40 px-2 py-1 text-[11.5px] text-ink">
            <QuoteIcon className="mt-0.5 h-3 w-3 shrink-0 text-accent" aria-hidden />
            <span className="line-clamp-3 flex-1">{pendingAnchor.quote}</span>
            <button
              type="button"
              onClick={onClearAnchor}
              aria-label="Remove quote"
              className="text-muted hover:text-ink"
            >
              <XIcon className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <p className="mb-1 text-[11px] text-muted">Select text in the doc to comment on it.</p>
        )}
        <div className="flex gap-1.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={pendingAnchor ? 'Comment on the selection' : 'Add a comment'}
            aria-label="New comment"
            maxLength={4000}
            className="h-8 min-w-0 flex-1 rounded-md border border-line px-2 text-[12.5px] outline-none focus:border-accent"
          />
          <Button size="md" variant="primary" type="submit" disabled={!note.trim() || busy}>
            Post
          </Button>
        </div>
      </form>

      <ul className="space-y-2" aria-label="Comment threads">
        {shown.length === 0 && (
          <li className="py-4 text-center text-[12px] text-muted">
            <MessageSquareIcon className="mx-auto mb-1 h-4 w-4" aria-hidden />
            {filter === 'resolved' ? 'No resolved threads.' : 'No open comments.'}
          </li>
        )}
        {shown.map(({ root, replies }) => (
          <Thread
            key={root.id}
            root={root}
            replies={replies}
            outdated={!!root.anchor?.quote && !body.includes(root.anchor.quote)}
            memberById={memberById}
            onReply={(text) => onAdd({ text, parentId: root.id })}
            onResolve={() => onResolve(root.id, !root.resolved)}
          />
        ))}
      </ul>
    </div>
  );
}

function Thread({
  root,
  replies,
  outdated,
  memberById,
  onReply,
  onResolve,
}: {
  root: ApiDocComment;
  replies: ApiDocComment[];
  outdated: boolean;
  memberById: (id: string) => Member;
  onReply: (text: string) => Promise<boolean>;
  onResolve: () => void;
}) {
  const [reply, setReply] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const text = reply.trim();
    if (!text || busy) return;
    setBusy(true);
    const ok = await onReply(text);
    setBusy(false);
    if (ok) {
      setReply('');
      setOpen(false);
    }
  };

  return (
    <li
      id={`doc-comment-${root.id}`}
      tabIndex={-1}
      className={`rounded-md border border-line p-2 outline-none focus:ring-2 focus:ring-accent ${root.resolved ? 'opacity-60' : ''}`}
    >
      {root.anchor?.quote && (
        <p
          className="mb-1 line-clamp-2 border-l-2 border-line-strong pl-1.5 text-[11.5px] italic text-muted"
          title={outdated ? 'This text has since changed in the doc' : undefined}
        >
          {root.anchor.quote}
          {outdated && <span className="ml-1 not-italic font-semibold text-warn">· outdated</span>}
        </p>
      )}
      <Comment c={root} memberById={memberById} />
      {replies.length > 0 && (
        <ul className="mt-1.5 space-y-1.5 border-l border-line pl-2">
          {replies.map((r) => (
            <li key={r.id}>
              <Comment c={r} memberById={memberById} />
            </li>
          ))}
        </ul>
      )}
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="mt-1.5 flex gap-1"
        >
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            autoFocus
            aria-label="Reply"
            placeholder="Reply"
            maxLength={4000}
            className="h-7 min-w-0 flex-1 rounded-md border border-line px-2 text-[12px] outline-none focus:border-accent"
          />
          <Button size="sm" variant="primary" type="submit" disabled={!reply.trim() || busy}>
            Reply
          </Button>
        </form>
      )}
      <p className="mt-1 flex gap-3">
        {!root.resolved && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[11.5px] font-medium text-accent hover:underline"
          >
            Reply
          </button>
        )}
        <button
          type="button"
          onClick={onResolve}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
        >
          {root.resolved ? (
            <RotateCcwIcon className="h-3 w-3" aria-hidden />
          ) : (
            <CheckIcon className="h-3 w-3" aria-hidden />
          )}
          {root.resolved ? 'Reopen' : 'Resolve'}
        </button>
        {root.resolved && root.resolvedBy && (
          <span className="text-[11px] text-muted">by {memberById(root.resolvedBy).name}</span>
        )}
      </p>
    </li>
  );
}

function Comment({ c, memberById }: { c: ApiDocComment; memberById: (id: string) => Member }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
        <Avatar id={c.by} size="xs" />
        <b className="font-semibold text-ink">{memberById(c.by).name.split(' ')[0]}</b> ·{' '}
        <time dateTime={c.at}>{relative(new Date(c.at))}</time>
      </p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] text-ink">{c.text}</p>
    </div>
  );
}
