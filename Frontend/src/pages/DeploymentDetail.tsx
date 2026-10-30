import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { DetailHeader } from '../components/ui/DetailHeader';
import { Panel } from '../components/ui/Panel';
import { MetaList } from '../components/ui/MetaList';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ProductMark } from '../components/ui/ProductMark';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { NotFound } from '../components/ui/NotFound';
import { useReauth } from '../contexts/ReauthContext';
import { useDeployments } from '../hooks/useDeployments';
import { api } from '../api/client';
import type { ApiDeployment } from '../api/types';
import { deployPullRequests } from '../data/operations';
import { products } from '../data/portfolio';
import { pullRequests } from '../data/engineering';
import { deployMeta, memberById } from '../utils/status';
import { repoSlug } from '../utils/slug';
import type { DeployStatus } from '../types/operations';

type StepState = 'done' | 'failed' | 'running' | 'pending' | 'skipped';
const stepNames = [
  'Checkout',
  'Install dependencies',
  'Build',
  'Run migrations',
  'Deploy',
  'Health check',
];
const stepTimes = ['4s', '38s', '1m 10s', '22s', '1m 34s', '24s'];

function stepStates(status: DeployStatus, failedStep?: string): StepState[] {
  if (status === 'succeeded' || status === 'rolled-back') return stepNames.map(() => 'done');
  if (status === 'awaiting-approval') return stepNames.map(() => 'pending');
  if (status === 'running')
    return stepNames.map((_, i) => (i < 3 ? 'done' : i === 3 ? 'running' : 'pending'));
  const f = stepNames.indexOf(failedStep ?? 'Deploy');
  return stepNames.map((_, i) => (i < f ? 'done' : i === f ? 'failed' : 'skipped'));
}

export function DeploymentDetail() {
  const { deployId } = useParams();
  const navigate = useNavigate();
  const { requestReauth } = useReauth();
  const { deployments, approve, rollback, loading } = useDeployments();
  const d = deployments.find((x) => x.id === deployId);
  if (!d) {
    if (loading) return <p className="p-6 text-[12.5px] text-muted">Loading deployment…</p>;
    return <NotFound what="Deployment" backTo="/deployments" backLabel="Back to deployments" />;
  }
  const product = products.find((p) => p.id === d.product);
  const states = stepStates(d.status, d.failedStep);
  const prNumber = deployPullRequests[d.sha];
  const pr = prNumber ? pullRequests.find((p) => p.number === prNumber) : undefined;
  const isProd = d.env === 'production';

  const logs = [
    `[00:00] ▶ ${d.provider} job started for ${d.sha}`,
    '[00:04] ✓ Checked out commit',
    '[00:42] ✓ Installed 1,284 packages (lockfile verified)',
    '[01:52] ✓ Build completed · bundle 412 kB',
    ...(d.status === 'failed'
      ? [
          '[02:14] ▶ Running migrations (3 pending)',
          '[02:31] ✗ ERROR: column "reset_token_hash" already exists',
          '[02:31] ✗ Migration 2026_10_22_add_reset_tokens failed — rolled back transaction',
          '[02:48] ■ Job failed. Nothing was deployed.',
        ]
      : d.status === 'awaiting-approval'
        ? ['[—] ⏸ Waiting for approval from Owner or Operations']
        : d.status === 'running'
          ? ['[02:14] ▶ Running migrations…']
          : [
              '[02:14] ✓ Migrations up to date',
              '[03:48] ✓ Deployed to ' + (product?.name ?? '') + ' ' + d.env,
              '[04:12] ✓ Health check 200 OK in 182ms',
            ]),
  ];

  const approveThis = () =>
    requestReauth({
      title: `Approve ${d.env} deploy`,
      description: `${d.sha} will be handed to ${d.provider}. Approvals are permanently recorded.`,
      actionLabel: 'Verify & approve',
      successMessage: 'Deployment approved',
      onConfirm: () => void approve(d.id),
    });

  const rollbackThis = () =>
    requestReauth({
      title: 'Roll back production',
      description: `Redeploys the previous release for ${product?.name}. Requires Owner or Operations.`,
      actionLabel: 'Verify & roll back',
      successMessage: 'Rollback started',
      onConfirm: () => void rollback(d.id),
    });

  /** A re-run is a new deployment record for the same commit — history is never rewritten. */
  const rerun = async () => {
    const run = async () => {
      try {
        const created = await api<ApiDeployment>('/api/deployments', {
          method: 'POST',
          body: { product: d.product, env: d.env, version: d.message, sha: d.sha },
        });
        toast.success('Re-run requested', { description: `${d.provider} picked up ${d.sha}.` });
        navigate(`/deployments/${created.id}`);
      } catch (e) {
        toast.error('Re-run failed', {
          description: e instanceof Error ? e.message : 'The deployments API did not respond.',
        });
      }
    };
    if (isProd) {
      requestReauth({
        title: 'Re-run production deploy',
        description: 'Production re-runs need a fresh MFA check.',
        actionLabel: 'Verify & re-run',
        onConfirm: () => void run(),
      });
    } else {
      await run();
    }
  };

  return (
    <div className="space-y-4">
      <DetailHeader
        crumbs={[{ label: 'Deployments', to: '/deployments' }, { label: d.id }]}
        leading={<ProductMark product={d.product} size="lg" />}
        eyebrow={
          <span>
            {product?.name} · <span className="capitalize">{d.env}</span>
          </span>
        }
        title={
          <span>
            <span className="font-mono">{d.sha}</span>{' '}
            <span className="font-normal text-muted">{d.message}</span>
          </span>
        }
        badges={
          <>
            <StatusBadge {...deployMeta[d.status]} dot />
            {isProd && <StatusBadge tone="warn" label="Production" />}
            <span className="text-[12px] text-muted">{d.provider}</span>
          </>
        }
        actions={
          <>
            {d.status === 'awaiting-approval' && (
              <>
                <Button onClick={() => void rollback(d.id)}>Reject</Button>
                <Button
                  variant="primary"
                  icon={<ShieldCheckIcon className="h-3.5 w-3.5" />}
                  onClick={approveThis}
                >
                  Approve
                </Button>
              </>
            )}
            {d.status === 'failed' && (
              <Button
                variant="primary"
                icon={<RotateCcwIcon className="h-3.5 w-3.5" />}
                onClick={() => void rerun()}
              >
                Re-run
              </Button>
            )}
            {d.status === 'succeeded' && isProd && (
              <Button
                variant="danger"
                icon={<RotateCcwIcon className="h-3.5 w-3.5" />}
                onClick={rollbackThis}
              >
                Roll back
              </Button>
            )}
            <Button
              icon={<ExternalLinkIcon className="h-3.5 w-3.5" />}
              onClick={() => toast('Opening provider logs', { description: d.provider })}
            >
              Provider logs
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_272px]">
        <div className="space-y-4">
          <Panel title="Pipeline" meta={<span>{d.duration}</span>}>
            <ol className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6">
              {stepNames.map((s, i) => {
                const st = states[i];
                return (
                  <li
                    key={s}
                    className={`flex items-center gap-2 px-3.5 py-2.5 sm:flex-col sm:items-start sm:gap-1 ${st === 'failed' ? 'bg-bad-soft/50' : ''}`}
                  >
                    {st === 'done' && <CircleCheckIcon className="h-4 w-4 text-ok" />}
                    {st === 'failed' && <CircleXIcon className="h-4 w-4 text-bad" />}
                    {st === 'running' && (
                      <LoaderCircleIcon className="h-4 w-4 animate-spin text-info" />
                    )}
                    {(st === 'pending' || st === 'skipped') && (
                      <CircleDashedIcon className="h-4 w-4 text-subtle" />
                    )}
                    <span
                      className={`flex-1 text-[12.5px] font-medium ${st === 'skipped' || st === 'pending' ? 'text-muted' : 'text-ink'}`}
                    >
                      {s}
                    </span>
                    <span className="text-[11px] tabular-nums text-subtle">
                      {st === 'done' || st === 'failed' ? stepTimes[i] : st}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Panel>

          <Panel title="Logs" meta={<span>Secrets are redacted before display</span>}>
            <pre className="max-h-72 overflow-auto bg-[#0F1115] px-3.5 py-3 font-mono text-[11.5px] leading-[1.7] text-[#D4D4D8] scroll-thin">
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.includes('✗') ? 'text-[#FCA5A5]' : l.includes('✓') ? 'text-[#A7F3D0]' : ''
                  }
                >
                  {l}
                </div>
              ))}
            </pre>
          </Panel>
        </div>

        <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
          <Panel title="Details">
            <MetaList
              items={[
                {
                  label: 'Triggered by',
                  value: (
                    <Link
                      to={`/team/${d.author}`}
                      className="flex items-center gap-1.5 hover:underline"
                    >
                      <Avatar id={d.author} size="xs" />
                      {memberById(d.author).name}
                    </Link>
                  ),
                },
                { label: 'Environment', value: <span className="capitalize">{d.env}</span> },
                { label: 'Provider', value: d.provider },
                { label: 'Started', value: `${d.ago}${d.ago === 'now' ? '' : ' ago'}` },
                { label: 'Duration', value: d.duration },
                {
                  label: 'Approval',
                  value: isProd
                    ? 'Owner · MFA'
                    : d.status === 'awaiting-approval'
                      ? 'Pending'
                      : 'Not required',
                },
              ]}
            />
          </Panel>
          {pr && (
            <Panel title="Change shipped">
              <div className="space-y-1.5 px-3.5 py-2.5 text-[12.5px]">
                <Link
                  to={`/pull-requests/${pr.number}`}
                  className="block truncate font-medium text-ink hover:underline"
                >
                  PR #{pr.number} {pr.title}
                </Link>
                {pr.taskKey && (
                  <Link
                    to={`/tasks/${pr.taskKey}`}
                    className="block font-mono text-accent hover:underline"
                  >
                    {pr.taskKey}
                  </Link>
                )}
                <Link
                  to={`/repositories/${repoSlug(pr.repo)}`}
                  className="block font-mono text-muted hover:underline"
                >
                  {pr.repo}
                </Link>
              </div>
            </Panel>
          )}
          <p className="rounded-lg border border-line bg-sunken/50 px-3 py-2.5 text-[12px] text-muted">
            DevHQ records and approves deployments. {d.provider} executes them with its own
            credentials — DevHQ never holds server access.
          </p>
        </div>
      </div>
    </div>
  );
}
