import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CircleCheckIcon,
  CircleXIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  InfoIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
} from 'lucide-react';
import { DetailHeader } from '../components/ui/DetailHeader';
import { Panel } from '../components/ui/Panel';
import { MetaList } from '../components/ui/MetaList';
import { StatusBadge } from '../components/ui/StatusBadge';
import { NotFound } from '../components/ui/NotFound';
import { inputClass } from '../components/ui/Modal';
import { Person } from '../components/engineering/Person';
import {
  DataState,
  GuardedButton,
  InlineError,
  SampleDataBadge,
} from '../components/engineering/states';
import { ago, duration, pullHref, runMeta, safeHref } from '../components/engineering/format';
import { usePull, usePulls, useServerLevel } from '../components/engineering/data/hooks';
import type { ApiPullDetail, ApiReviewDecision } from '../components/engineering/data/types';
import { useWork } from '../contexts/WorkContext';
import { useAuth } from '../contexts/AuthContext';
import { ciMeta, reviewMeta } from '../utils/status';

const decisionLabel: Record<ApiReviewDecision, string> = {
  approve: 'approved',
  'request-changes': 'requested changes',
  comment: 'commented',
};

export function PullRequestDetail() {
  const { prNumber } = useParams();
  const [params] = useSearchParams();
  const number = Number(prNumber);
  const repoParam = params.get('repo') ?? undefined;

  if (!Number.isInteger(number) || number <= 0)
    return (
      <NotFound what="Pull request" backTo="/pull-requests" backLabel="Back to pull requests" />
    );
  return repoParam ? (
    <PullView repoId={repoParam} number={number} />
  ) : (
    <ResolveRepo number={number} />
  );
}

/** Old links carry only the number: find which repository it belongs to. */
function ResolveRepo({ number }: { number: number }) {
  const list = usePulls({});
  const matches = list.items.filter((p) => p.number === number);
  if (list.status !== 'ready')
    return (
      <DataState
        status={list.status}
        error={list.error}
        what="Pull requests"
        github
        onRetry={list.reload}
      />
    );
  if (matches.length === 1) return <PullView repoId={matches[0].repoId} number={number} />;
  if (matches.length === 0)
    return (
      <NotFound what="Pull request" backTo="/pull-requests" backLabel="Back to pull requests" />
    );
  return (
    <Panel title={`#${number} exists in several repositories`}>
      <ul className="divide-y divide-line">
        {matches.map((p) => (
          <li key={p.repoId}>
            <Link to={pullHref(p)} className="block px-3.5 py-2 text-[12.5px] hover:bg-sunken/50">
              <span className="font-mono text-muted">{p.repo}</span> · {p.title}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PullView({ repoId, number }: { repoId: string; number: number }) {
  const res = usePull(repoId, number);
  const { tasks } = useWork();

  if (res.status === 'not-found')
    return (
      <NotFound what="Pull request" backTo="/pull-requests" backLabel="Back to pull requests" />
    );
  if (res.status !== 'ready' || !res.data)
    return (
      <div className="space-y-4">
        <DetailHeader
          crumbs={[{ label: 'Pull requests', to: '/pull-requests' }, { label: `#${number}` }]}
          title={`#${number}`}
        />
        <DataState
          status={res.status}
          error={res.error}
          what="Pull requests"
          github
          onRetry={res.reload}
        />
      </div>
    );

  const pr = res.data;
  const task = pr.taskKey ? tasks.find((t) => t.key === pr.taskKey) : undefined;
  const checks = pr.checks ?? [];
  const href = safeHref(pr.url);

  return (
    <div className="space-y-4">
      <DetailHeader
        crumbs={[
          { label: 'Pull requests', to: '/pull-requests' },
          { label: pr.repo, to: `/repositories/${encodeURIComponent(pr.repoId)}` },
          { label: `#${pr.number}` },
        ]}
        eyebrow={
          <span className="font-mono">
            {pr.repo} · #{pr.number}
          </span>
        }
        title={pr.title}
        badges={
          <>
            <StatusBadge {...reviewMeta[pr.review]} dot />
            <StatusBadge {...ciMeta[pr.ci]} />
            {pr.additions !== undefined && (
              <span className="font-mono text-[12px] text-ok">+{pr.additions}</span>
            )}
            {pr.deletions !== undefined && (
              <span className="font-mono text-[12px] text-bad">−{pr.deletions}</span>
            )}
            <SampleDataBadge source={pr.source} />
          </>
        }
        actions={
          href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12.5px] font-medium text-white hover:bg-ink/90"
            >
              <ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden />
              Open in GitHub
            </a>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_272px]">
        <div className="space-y-4">
          <Panel
            title="Checks"
            meta={
              checks.length ? (
                <span>
                  {checks.filter((c) => c.status === 'passed').length}/{checks.length} passing
                </span>
              ) : undefined
            }
          >
            {checks.length === 0 ? (
              <p className="px-3.5 py-3 text-[12.5px] text-muted">No check runs reported.</p>
            ) : (
              <ul className="divide-y divide-line">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-center gap-2.5 px-3.5 py-2">
                    {c.status === 'passed' && (
                      <CircleCheckIcon className="h-4 w-4 text-ok" aria-hidden />
                    )}
                    {c.status === 'failed' && (
                      <CircleXIcon className="h-4 w-4 text-bad" aria-hidden />
                    )}
                    {(c.status === 'running' || c.status === 'queued') && (
                      <LoaderCircleIcon className="h-4 w-4 animate-spin text-info" aria-hidden />
                    )}
                    {c.status === 'cancelled' && (
                      <CircleXIcon className="h-4 w-4 text-subtle" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                      {c.workflow}
                    </span>
                    <span className="sr-only">{runMeta[c.status].label}</span>
                    <span className="text-[11.5px] tabular-nums text-muted">
                      {duration(c.durationMs)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <ReviewPanel pr={pr} review={res.review} />

          {pr.taskKey && (
            <Panel
              title="Linked task"
              meta={
                <Link
                  to={`/tasks/${pr.taskKey}`}
                  className="font-medium text-accent hover:underline"
                >
                  {pr.taskKey} →
                </Link>
              }
            >
              <p className="px-3.5 py-3 text-[13px] font-semibold text-ink">
                {task?.title ?? 'Task not visible in your scope.'}
              </p>
            </Panel>
          )}

          <Timeline pr={pr} />
        </div>

        <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
          <Panel title="Details">
            <MetaList
              items={[
                { label: 'Author', value: <Person id={pr.author} /> },
                {
                  label: 'Reviewers',
                  value: pr.reviewers.length ? (
                    <span className="flex flex-wrap justify-end gap-1">
                      {pr.reviewers.map((r) => (
                        <Person key={r} id={r} showName={false} />
                      ))}
                    </span>
                  ) : (
                    '—'
                  ),
                },
                {
                  label: 'Repository',
                  value: (
                    <Link
                      to={`/repositories/${encodeURIComponent(pr.repoId)}`}
                      className="truncate font-mono hover:underline"
                    >
                      {pr.repo}
                    </Link>
                  ),
                },
                {
                  label: 'Branch',
                  value: (
                    <span className="flex items-center gap-1 truncate font-mono text-[11.5px]">
                      <GitBranchIcon className="h-3 w-3 shrink-0" aria-hidden />
                      {pr.branch}
                      {pr.base && <span className="text-muted">→ {pr.base}</span>}
                    </span>
                  ),
                },
                { label: 'Opened', value: ago(pr.createdAt) },
              ]}
            />
          </Panel>
          <div className="flex gap-2 rounded-lg border border-line bg-sunken/50 px-3 py-2.5 text-[12px] text-muted">
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <p>
              Reviews submitted here are posted to GitHub through the DevHQ GitHub App. Merges and
              branch rules stay in GitHub.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewPanel({
  pr,
  review,
}: {
  pr: ApiPullDetail;
  review: (decision: ApiReviewDecision, body: string) => Promise<ApiPullDetail | null>;
}) {
  const { session } = useAuth();
  const { atLeast, loaded } = useServerLevel();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<ApiReviewDecision | null>(null);
  const [error, setError] = useState<unknown>(null);
  const bodyId = useId();

  const canReview = loaded && atLeast('Repository', 'contribute');
  const own = !!session?.memberId && pr.author === session.memberId;
  const closed = pr.state !== 'open';
  const noAccess = loaded ? 'Needs Repository: contribute' : 'Checking your permissions…';

  const submit = async (decision: ApiReviewDecision) => {
    if (decision !== 'approve' && !body.trim()) {
      setError(new Error('Add a comment explaining your review.'));
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      await review(decision, body.trim());
      setBody('');
      toast.success(`Review submitted`, { description: `You ${decisionLabel[decision]}.` });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  if (closed)
    return (
      <Panel title="Review">
        <p className="px-3.5 py-3 text-[12.5px] text-muted">
          This pull request is {pr.state}; reviews are closed.
        </p>
      </Panel>
    );

  return (
    <Panel title="Review">
      <form
        className="space-y-2 px-3.5 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit('comment');
        }}
      >
        <label htmlFor={bodyId} className="text-[12px] font-medium text-ink">
          Comment
        </label>
        <textarea
          id={bodyId}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={5000}
          disabled={!canReview}
          placeholder={canReview ? 'Leave a review comment' : noAccess}
          className={`${inputClass} h-auto py-1.5`}
        />
        <div className="flex flex-wrap gap-1.5">
          <GuardedButton
            type="button"
            size="sm"
            variant="primary"
            allowed={canReview && !own}
            reason={own ? 'You can’t approve your own pull request' : noAccess}
            icon={<CircleCheckIcon className="h-3.5 w-3.5" />}
            disabled={!!busy}
            onClick={() => void submit('approve')}
          >
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </GuardedButton>
          <GuardedButton
            type="button"
            size="sm"
            allowed={canReview && !own}
            reason={own ? 'You can’t request changes on your own pull request' : noAccess}
            icon={<CircleXIcon className="h-3.5 w-3.5 text-bad" />}
            disabled={!!busy}
            onClick={() => void submit('request-changes')}
          >
            Request changes
          </GuardedButton>
          <GuardedButton
            type="submit"
            size="sm"
            variant="ghost"
            allowed={canReview}
            reason={noAccess}
            icon={<MessageSquareIcon className="h-3.5 w-3.5" />}
            disabled={!!busy}
          >
            Comment
          </GuardedButton>
        </div>
        <InlineError error={error} />
      </form>
    </Panel>
  );
}

function Timeline({ pr }: { pr: ApiPullDetail }) {
  const events = useMemo(() => {
    const list: { at: string; icon: typeof GitPullRequestIcon; text: ReactNode }[] = [
      {
        at: pr.createdAt,
        icon: GitPullRequestIcon,
        text: (
          <>
            <Person id={pr.author} link={false} /> opened this pull request
          </>
        ),
      },
    ];
    (pr.commits ?? []).forEach((c) =>
      list.push({
        at: c.at,
        icon: GitCommitHorizontalIcon,
        text: (
          <>
            <span className="font-mono">{c.sha.slice(0, 7)}</span> {c.message}
          </>
        ),
      }),
    );
    (pr.reviews ?? []).forEach((r) =>
      list.push({
        at: r.at,
        icon: r.decision === 'approve' ? CircleCheckIcon : MessageSquareIcon,
        text: (
          <>
            <Person id={r.by} link={false} /> {decisionLabel[r.decision]}
            {r.body && <span className="block text-muted">{r.body}</span>}
          </>
        ),
      }),
    );
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [pr]);

  return (
    <Panel title="Timeline">
      <ol className="space-y-2.5 px-3.5 py-3">
        {events.map((e, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-ink">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-muted">
              <e.icon className="h-3 w-3" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 pt-0.5">{e.text}</span>
            <span className="pt-0.5 text-[11.5px] text-subtle">{ago(e.at)}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
