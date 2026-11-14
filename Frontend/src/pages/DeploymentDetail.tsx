import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
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
import { NotFound } from '../components/ui/NotFound';
import { EnvironmentPipeline } from '../components/delivery/EnvironmentPipeline';
import { DeployRiskBadge } from '../components/delivery/DeployRiskBadge';
import { lanesFromDeployments } from '../components/delivery/environments';
import {
  DataState,
  GuardedButton,
  InlineError,
  SampleDataBadge,
} from '../components/engineering/states';
import { useCiRuns, useServerLevel } from '../components/engineering/data/hooks';
import { useAuth } from '../contexts/AuthContext';
import { useReauth } from '../contexts/ReauthContext';
import { useDeployments, type DeploymentRow } from '../hooks/useDeployments';
import { api } from '../api/client';
import type { ApiDeployment } from '../api/types';
import { products } from '../data/portfolio';
import { deployMeta, memberById } from '../utils/status';
import { formatDateTime } from '../utils/date';
import { ProductionAccessStatus } from '../components/jit/ProductionAccessStatus';

type StepState = 'done' | 'failed' | 'running' | 'pending' | 'skipped';

/**
 * The lifecycle TavetaHQ actually records: request → approval → rollout.
 * Build/test steps live in CI (shown below from real runs), so they are not
 * re-drawn here with invented timings.
 */
function lifecycle(d: DeploymentRow): { label: string; state: StepState; note: string }[] {
  const prod = d.env === 'production';
  const requested = {
    label: 'Requested',
    state: 'done' as StepState,
    note: `${memberById(d.requestedBy).name} · ${formatDateTime(new Date(d.createdAt))}`,
  };
  const approval = {
    label: 'Approval',
    state: (!prod
      ? 'skipped'
      : d.approvedBy
        ? 'done'
        : d.status === 'awaiting-approval'
          ? 'pending'
          : d.status === 'rolled-back'
            ? 'failed'
            : 'skipped') as StepState,
    note: !prod
      ? 'Not required for staging'
      : d.approvedBy
        ? `Approved by ${memberById(d.approvedBy).name}`
        : d.status === 'awaiting-approval'
          ? 'Waiting for Deployment: manage, step-up and a production grant'
          : d.status === 'rolled-back'
            ? 'Rejected'
            : '—',
  };
  const rollout = {
    label: 'Rollout',
    state: (d.status === 'succeeded'
      ? 'done'
      : d.status === 'running'
        ? 'running'
        : d.status === 'failed'
          ? 'failed'
          : d.status === 'rolled-back'
            ? 'skipped'
            : 'pending') as StepState,
    note: `${deployMeta[d.status].label} · ${d.provider}`,
  };
  return [requested, approval, rollout];
}

const icon: Record<StepState, JSX.Element> = {
  done: <CircleCheckIcon className="h-4 w-4 text-ok" aria-hidden />,
  failed: <CircleXIcon className="h-4 w-4 text-bad" aria-hidden />,
  running: <LoaderCircleIcon className="h-4 w-4 animate-spin text-info" aria-hidden />,
  pending: <CircleDashedIcon className="h-4 w-4 text-subtle" aria-hidden />,
  skipped: <CircleDashedIcon className="h-4 w-4 text-subtle" aria-hidden />,
};

export function DeploymentDetail() {
  const { deployId } = useParams();
  const navigate = useNavigate();
  const { requestReauth } = useReauth();
  const { session, canDo } = useAuth();
  const { atLeast } = useServerLevel();
  const { deployments, approve, rollback, loading, error, reload, actionError } = useDeployments();
  const d = deployments.find((x) => x.id === deployId);
  const runs = useCiRuns();
  const [rerunError, setRerunError] = useState<unknown>(null);

  if (!d) {
    if (loading || error)
      return (
        <DataState
          status={loading ? 'loading' : 'error'}
          error={error}
          what="Deployment"
          onRetry={() => void reload()}
        />
      );
    return <NotFound what="Deployment" backTo="/deployments" backLabel="Back to deployments" />;
  }

  const product = products.find((p) => p.id === d.product);
  const isProd = d.env === 'production';
  const mayApprove = canDo('deploy:approve');
  const mayManage = atLeast('Deployment', 'manage');
  const mayRequest = atLeast('Deployment', 'contribute');
  const ownRequest = d.requestedBy === session?.memberId;
  const steps = lifecycle(d);
  const lanes = lanesFromDeployments(deployments, d.product);
  const sameEnv = deployments
    .filter((x) => x.product === d.product && x.env === d.env)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const position = sameEnv.findIndex((x) => x.id === d.id);
  const replacedBy = position > 0 ? sameEnv[position - 1] : undefined;
  const replaced = sameEnv[position + 1];
  const commitRuns = runs.items.filter((r) => r.sha && d.sha && r.sha.startsWith(d.sha));
  const errorHere = actionError?.id === d.id ? actionError.error : null;

  const approveThis = () =>
    requestReauth({
      title: `Approve ${d.env} deploy`,
      description: `${d.sha} will be handed to ${d.provider}. Approvals are permanently recorded.`,
      actionLabel: 'Verify & approve',
      onConfirm: () => void approve(d.id),
    });

  const rollbackThis = () =>
    requestReauth({
      title: d.status === 'awaiting-approval' ? 'Reject deployment' : 'Roll back deployment',
      description: `Marks ${d.version} on ${product?.name ?? d.product} ${d.env} as rolled back.`,
      actionLabel: d.status === 'awaiting-approval' ? 'Verify & reject' : 'Verify & roll back',
      onConfirm: () => void rollback(d.id),
    });

  /** A re-run is a new deployment record for the same commit — history is never rewritten. */
  const rerun = () => {
    const run = async () => {
      setRerunError(null);
      try {
        const created = await api<ApiDeployment>('/api/deployments', {
          method: 'POST',
          body: { product: d.product, env: d.env, version: d.version, sha: d.sha },
        });
        toast.success('Re-run requested', { description: `${d.provider} picks up ${d.sha}.` });
        navigate(`/deployments/${created.id}`);
      } catch (e) {
        setRerunError(e);
      }
    };
    if (isProd) {
      requestReauth({
        title: 'Re-run production deploy',
        description: 'Production re-runs need a fresh verification.',
        actionLabel: 'Verify & re-run',
        onConfirm: () => void run(),
      });
    } else void run();
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
            <span className="font-normal text-muted">{d.version}</span>
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
            {d.status === 'awaiting-approval' && mayManage && (
              <GuardedButton
                allowed={mayManage}
                reason="Needs Deployment: manage"
                onClick={rollbackThis}
              >
                Reject
              </GuardedButton>
            )}
            {d.status === 'awaiting-approval' && mayApprove && (
              <GuardedButton
                variant="primary"
                allowed={!ownRequest}
                reason="Two-person rule: you requested this deployment, so someone else must approve it"
                icon={<ShieldCheckIcon className="h-3.5 w-3.5" />}
                onClick={approveThis}
              >
                Approve
              </GuardedButton>
            )}
            {d.status === 'failed' && (
              <GuardedButton
                variant="primary"
                allowed={mayRequest}
                reason="Needs Deployment: contribute"
                icon={<RotateCcwIcon className="h-3.5 w-3.5" />}
                onClick={rerun}
              >
                Re-run
              </GuardedButton>
            )}
            {(d.status === 'succeeded' || d.status === 'running') && mayManage && (
              <GuardedButton
                variant="danger"
                allowed={mayManage}
                reason="Needs Deployment: manage"
                icon={<RotateCcwIcon className="h-3.5 w-3.5" />}
                onClick={rollbackThis}
              >
                Roll back
              </GuardedButton>
            )}
          </>
        }
      />

      {!!(errorHere || rerunError) && <InlineError error={errorHere ?? rerunError} />}
      {isProd && mayManage && ['awaiting-approval', 'running', 'succeeded'].includes(d.status) && (
        <ProductionAccessStatus
          scope={`production:${d.product}`}
          what={
            d.status === 'awaiting-approval'
              ? 'Approving this deploy'
              : 'Rolling back this production deploy'
          }
        />
      )}
      {d.status === 'awaiting-approval' && !mayApprove && (
        <p className="rounded-md border border-line bg-sunken/50 px-3 py-2 text-[12px] text-muted">
          Waiting for approval. Approving needs Deployment: manage — your role can view this
          deployment but not approve it.
        </p>
      )}

      <DeployRiskBadge deploymentId={d.id} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_272px]">
        <div className="space-y-4">
          <Panel title="Lifecycle" meta={<span>Recorded by TavetaHQ</span>}>
            <ol className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-y-0">
              {steps.map((s) => (
                <li
                  key={s.label}
                  className={`flex items-center gap-2 px-3.5 py-2.5 sm:flex-col sm:items-start sm:gap-1 ${s.state === 'failed' ? 'bg-bad-soft/50' : ''}`}
                >
                  {icon[s.state]}
                  <span className="flex-1 text-[12.5px] font-medium text-ink">{s.label}</span>
                  <span className="text-[11px] text-subtle">{s.note}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Environments" meta={<span>Latest deploy per lane · {product?.name}</span>}>
            <div className="space-y-2 p-2.5">
              <EnvironmentPipeline lanes={lanes} />
              <dl className="grid gap-x-4 gap-y-1 px-1 text-[12px] sm:grid-cols-2">
                <div className="flex gap-1.5">
                  <dt className="text-muted">Replaced</dt>
                  <dd className="min-w-0 truncate">
                    {replaced ? (
                      <Link
                        to={`/deployments/${replaced.id}`}
                        className="font-mono hover:underline"
                      >
                        {replaced.sha} · {replaced.version}
                      </Link>
                    ) : (
                      <span className="text-subtle">first deploy on record</span>
                    )}
                  </dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-muted">Superseded by</dt>
                  <dd className="min-w-0 truncate">
                    {replacedBy ? (
                      <Link
                        to={`/deployments/${replacedBy.id}`}
                        className="font-mono hover:underline"
                      >
                        {replacedBy.sha} · {replacedBy.version}
                      </Link>
                    ) : (
                      <span className="text-subtle">current in {d.env}</span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </Panel>

          <Panel title="CI for this commit" meta={<SampleDataBadge source={runs.source} />}>
            {runs.status !== 'ready' ? (
              <div className="p-2.5">
                <DataState
                  status={runs.status}
                  error={runs.error}
                  what="CI runs"
                  github
                  rows={2}
                  onRetry={() => void runs.reload()}
                />
              </div>
            ) : commitRuns.length === 0 ? (
              <p className="px-3.5 py-4 text-[12.5px] text-muted">
                No CI runs recorded for {d.sha}.
              </p>
            ) : (
              <table className="w-full text-[12.5px]" aria-label={`CI runs for ${d.sha}`}>
                <thead>
                  <tr className="border-b border-line text-left text-[11.5px] text-muted">
                    <th scope="col" className="px-3.5 py-2 font-medium">
                      Workflow
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Pull request
                    </th>
                    <th scope="col" className="px-3.5 py-2 text-right font-medium">
                      Started
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {commitRuns.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="px-3.5 py-2 font-medium text-ink">{r.workflow}</td>
                      <td className="px-3 py-2 capitalize text-muted">{r.status}</td>
                      <td className="px-3 py-2">
                        {r.pr ? (
                          <Link
                            to={`/pull-requests/${r.pr}?repo=${encodeURIComponent(r.repoId)}`}
                            className="font-mono text-accent hover:underline"
                          >
                            {r.repo}#{r.pr}
                          </Link>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2 text-right text-[11.5px] text-muted">
                        {formatDateTime(new Date(r.startedAt))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
          <Panel title="Details">
            <MetaList
              items={[
                {
                  label: 'Requested by',
                  value: (
                    <Link
                      to={`/team/${d.requestedBy}`}
                      className="flex items-center gap-1.5 hover:underline"
                    >
                      <Avatar id={d.requestedBy} size="xs" />
                      {memberById(d.requestedBy).name}
                    </Link>
                  ),
                },
                {
                  label: 'Approved by',
                  value: d.approvedBy ? memberById(d.approvedBy).name : '—',
                },
                { label: 'Environment', value: <span className="capitalize">{d.env}</span> },
                { label: 'Version', value: <span className="font-mono">{d.version}</span> },
                { label: 'Provider', value: d.provider },
                { label: 'Requested', value: formatDateTime(new Date(d.createdAt)) },
              ]}
            />
          </Panel>
          <p className="rounded-lg border border-line bg-sunken/50 px-3 py-2.5 text-[12px] text-muted">
            TavetaHQ records and approves deployments. {d.provider} executes them with its own
            credentials — build logs stay with the provider.
          </p>
        </div>
      </div>
    </div>
  );
}
