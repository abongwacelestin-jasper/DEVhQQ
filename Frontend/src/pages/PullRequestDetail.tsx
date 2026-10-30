import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BellRingIcon,
  CircleCheckIcon,
  CircleXIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  InfoIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
} from 'lucide-react';
import { DetailHeader } from '../components/ui/DetailHeader';
import { Panel } from '../components/ui/Panel';
import { MetaList } from '../components/ui/MetaList';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { NotFound } from '../components/ui/NotFound';
import { TraceChain } from '../components/work/TraceChain';
import { pullRequests, traces } from '../data/engineering';
import { useWork } from '../contexts/WorkContext';
import { ciMeta, firstName, memberById, reviewMeta } from '../utils/status';
import { repoSlug } from '../utils/slug';

type CheckState = 'pass' | 'fail' | 'running';

export function PullRequestDetail() {
  const { prNumber } = useParams();
  const pr = pullRequests.find((p) => String(p.number) === prNumber);
  const { tasks } = useWork();
  if (!pr)
    return (
      <NotFound what="Pull request" backTo="/pull-requests" backLabel="Back to pull requests" />
    );

  const task = tasks.find((t) => t.key === pr.taskKey);
  const trace = traces.find((t) => t.taskKey === pr.taskKey);
  const checks: { name: string; state: CheckState; time: string }[] = [
    { name: 'build', state: 'pass', time: '1m 12s' },
    { name: 'typecheck', state: 'pass', time: '38s' },
    { name: 'lint', state: pr.ci === 'failing' ? 'fail' : 'pass', time: '21s' },
    { name: 'unit-tests', state: 'pass', time: '2m 04s' },
    {
      name: 'e2e (staging)',
      state: pr.ci === 'running' ? 'running' : 'pass',
      time: pr.ci === 'running' ? '—' : '4m 40s',
    },
  ];

  const timeline = [
    {
      icon: GitPullRequestIcon,
      text: (
        <>
          <b>{firstName(pr.author)}</b> opened this pull request
        </>
      ),
      when: pr.age,
    },
    {
      icon: BellRingIcon,
      text: <>Review requested from {pr.reviewers.map((r) => firstName(r)).join(', ')}</>,
      when: pr.age,
    },
    {
      icon: GitCommitHorizontalIcon,
      text: (
        <>
          3 commits pushed to <span className="font-mono">{pr.branch}</span>
        </>
      ),
      when: '1d',
    },
    ...(pr.review === 'changes-requested'
      ? [
          {
            icon: MessageSquareIcon,
            text: (
              <>
                <b>{firstName(pr.reviewers[0])}</b> requested changes
              </>
            ),
            when: '1d',
          },
        ]
      : []),
    ...(pr.review === 'approved'
      ? [
          {
            icon: CircleCheckIcon,
            text: (
              <>
                <b>{firstName(pr.reviewers[0])}</b> approved
              </>
            ),
            when: '2d',
          },
        ]
      : []),
    ...(pr.review === 'merged'
      ? [
          {
            icon: GitMergeIcon,
            text: (
              <>
                Merged into <span className="font-mono">main</span>
              </>
            ),
            when: pr.age,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <DetailHeader
        crumbs={[
          { label: 'Pull requests', to: '/pull-requests' },
          { label: pr.repo, to: `/repositories/${repoSlug(pr.repo)}` },
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
            <span className="font-mono text-[12px] text-ok">+{pr.additions}</span>
            <span className="font-mono text-[12px] text-bad">−{pr.deletions}</span>
          </>
        }
        actions={
          <>
            {pr.review === 'review-required' && (
              <Button
                icon={<BellRingIcon className="h-3.5 w-3.5" />}
                onClick={() =>
                  toast.success('Reviewers nudged', { description: 'Sent in DevHQ and Slack.' })
                }
              >
                Nudge reviewers
              </Button>
            )}
            <Button
              variant="primary"
              icon={<ExternalLinkIcon className="h-3.5 w-3.5" />}
              onClick={() =>
                toast('Opening GitHub', { description: `github.com/${pr.repo}/pull/${pr.number}` })
              }
            >
              Open in GitHub
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_272px]">
        <div className="space-y-4">
          <Panel
            title="Checks"
            meta={
              <span>
                {checks.filter((c) => c.state === 'pass').length}/{checks.length} passing
              </span>
            }
          >
            <ul className="divide-y divide-line">
              {checks.map((c) => (
                <li key={c.name} className="flex items-center gap-2.5 px-3.5 py-2">
                  {c.state === 'pass' && <CircleCheckIcon className="h-4 w-4 text-ok" />}
                  {c.state === 'fail' && <CircleXIcon className="h-4 w-4 text-bad" />}
                  {c.state === 'running' && (
                    <LoaderCircleIcon className="h-4 w-4 animate-spin text-info" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                    {c.name}
                  </span>
                  {c.state === 'fail' && (
                    <span className="hidden text-[12px] text-bad sm:inline">
                      Missing translation key session.timeout
                    </span>
                  )}
                  <span className="text-[11.5px] tabular-nums text-muted">{c.time}</span>
                </li>
              ))}
            </ul>
          </Panel>

          {task && (
            <Panel
              title="Linked task"
              meta={
                <Link to={`/tasks/${task.key}`} className="font-medium text-accent hover:underline">
                  {task.key} →
                </Link>
              }
            >
              <div className="px-3.5 pb-2.5 pt-3">
                <p className="text-[13px] font-semibold text-ink">{task.title}</p>
                {trace && (
                  <div className="mt-3">
                    <TraceChain steps={trace.steps} />
                  </div>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Timeline">
            <ol className="space-y-2.5 px-3.5 py-3">
              {timeline.map((e, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-ink">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-muted">
                    <e.icon className="h-3 w-3" />
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">{e.text}</span>
                  <span className="pt-0.5 text-[11.5px] text-subtle">{e.when}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
          <Panel title="Details">
            <MetaList
              items={[
                {
                  label: 'Author',
                  value: (
                    <Link
                      to={`/team/${pr.author}`}
                      className="flex items-center gap-1.5 hover:underline"
                    >
                      <Avatar id={pr.author} size="xs" />
                      {memberById(pr.author).name}
                    </Link>
                  ),
                },
                {
                  label: 'Reviewers',
                  value: (
                    <span className="flex -space-x-1">
                      {pr.reviewers.map((r) => (
                        <Link key={r} to={`/team/${r}`}>
                          <Avatar id={r} size="xs" ring />
                        </Link>
                      ))}
                    </span>
                  ),
                },
                {
                  label: 'Repository',
                  value: (
                    <Link
                      to={`/repositories/${repoSlug(pr.repo)}`}
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
                      <GitBranchIcon className="h-3 w-3 shrink-0" />
                      {pr.branch}
                    </span>
                  ),
                },
                { label: 'Opened', value: `${pr.age} ago` },
              ]}
            />
          </Panel>
          <div className="flex gap-2 rounded-lg border border-line bg-sunken/50 px-3 py-2.5 text-[12px] text-muted">
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              DevHQ has read-only access to pull requests. Reviews and merges happen in GitHub,
              which stays the source of truth.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
