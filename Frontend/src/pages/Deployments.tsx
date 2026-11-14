import { lazy, Suspense, useMemo, useState } from 'react';
import { CircleCheckIcon, PlusIcon, ShieldCheckIcon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Segmented } from '../components/ui/Segmented';
import { ProductMark } from '../components/ui/ProductMark';
import { Avatar } from '../components/ui/Avatar';
import { SearchInput } from '../components/ui/SearchInput';
import { StatCard, StatStrip } from '../components/ui/StatCard';
import { EnvironmentPipeline } from '../components/delivery/EnvironmentPipeline';
import { DeploymentsTable } from '../components/delivery/DeploymentsTable';
import { RecordDeploymentModal } from '../components/delivery/RecordDeploymentModal';
import { lanesFromDeployments } from '../components/delivery/environments';
import {
  DataState,
  GuardedButton,
  InlineError,
  LoadingRows,
} from '../components/engineering/states';
import { useServerLevel } from '../components/engineering/data/hooks';
import { useAuth } from '../contexts/AuthContext';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useReauth } from '../contexts/ReauthContext';
import { useDeployments, type DeploymentRow } from '../hooks/useDeployments';
import { useProductCatalogue } from '../hooks/useProductCatalogue';
import { memberById, productById } from '../utils/status';
import type { DeployStatus } from '../types/operations';
import type { ProductId } from '../types/portfolio';

// The chart is below the fold; keep it out of the page's first chunk.
const DeployFrequencyChart = lazy(() => import('../components/delivery/DeployFrequencyChart'));

type Filter = 'all' | DeployStatus;

const policy = [
  'Production requests wait for approval',
  'Approver needs Deployment: manage and is never the requester',
  'Fresh step-up verification at approval time',
  'Approver holds a just-in-time production grant (Owner exempt)',
  'Every transition is written to the audit log',
];

const WEEK_MS = 7 * 86_400_000;

const hit = (haystack: (string | number | undefined | null)[], term: string) =>
  !term || haystack.join(' ').toLowerCase().includes(term.trim().toLowerCase());

export function Deployments() {
  const { matches } = useProductFilter();
  const { requestReauth } = useReauth();
  const { session, canDo } = useAuth();
  const { atLeast } = useServerLevel();
  const {
    deployments: rows,
    approve,
    rollback,
    loading,
    error,
    reload,
    actionError,
  } = useDeployments();
  const [recordOpen, setRecordOpen] = useState(false);
  const mayApprove = canDo('deploy:approve');
  const mayManage = atLeast('Deployment', 'manage');
  const mayRecord = atLeast('Deployment', 'contribute');
  const catalogue = useProductCatalogue();
  const [status, setStatus] = useState<Filter>('all');
  const [q, setQ] = useState({ history: '', approvals: '', environments: '' });
  const set = (key: keyof typeof q) => (value: string) => setQ((s) => ({ ...s, [key]: value }));

  const nameOf = (id: ProductId) =>
    catalogue.find((p) => p.id === id)?.name ?? productById(id).name;

  const scoped = rows.filter((d) => matches(d.product));
  const awaiting = scoped.filter((d) => d.status === 'awaiting-approval');
  const week = scoped.filter((d) => Date.now() - new Date(d.createdAt).getTime() < WEEK_MS);
  const failedWeek = week.filter((d) => d.status === 'failed' || d.status === 'rolled-back');
  const succeededWeek = week.filter((d) => d.status === 'succeeded');
  const successRate = week.length
    ? Math.round(((week.length - failedWeek.length) / week.length) * 100)
    : null;

  const visible = scoped
    .filter((d) => status === 'all' || d.status === status)
    .filter((d) =>
      hit([d.product, nameOf(d.product), d.env, d.sha, d.message, d.status], q.history),
    );
  const approvalHits = awaiting.filter((d) =>
    hit([d.product, nameOf(d.product), d.env, d.sha, d.message, d.author], q.approvals),
  );

  /** Latest known deployment per environment, straight from the API rows. */
  const lanesByProduct = useMemo(() => {
    const productsInScope = Array.from(new Set(scoped.map((d) => d.product)));
    return productsInScope.map((productId) => ({
      productId,
      lanes: lanesFromDeployments(scoped, productId),
    }));
  }, [scoped]);

  const envHits = lanesByProduct.filter((p) =>
    hit(
      [
        p.productId,
        nameOf(p.productId),
        ...p.lanes.map((l) => `${l.env} ${l.sha} ${l.version} ${l.provider}`),
      ],
      q.environments,
    ),
  );

  const decide = (d: DeploymentRow, ok: boolean) => {
    if (ok) void approve(d.id);
    else void rollback(d.id);
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="Deployments"
        description="Every deployment attempt across providers in one history. Execution stays with GitHub Actions and Coolify — TavetaHQ records, approves and correlates."
        actions={
          <GuardedButton
            id="record-deploy-trigger"
            allowed={mayRecord}
            reason="Needs Deployment: contribute"
            icon={<PlusIcon className="h-3.5 w-3.5" />}
            onClick={() => setRecordOpen(true)}
          >
            Record deployment
          </GuardedButton>
        }
      />

      {actionError && <InlineError error={actionError.error} />}
      {loading && rows.length === 0 && <LoadingRows rows={3} label="Loading deployments" />}
      {!loading && error && rows.length === 0 && (
        <DataState status="error" error={error} what="Deployments" onRetry={() => void reload()} />
      )}

      <StatStrip>
        <StatCard label="Deployments" value={scoped.length} note="In your scope" />
        <StatCard
          label="Awaiting"
          value={awaiting.length}
          note="Need a human decision"
          tone={awaiting.length ? 'warn' : 'neutral'}
        />
        <StatCard
          label="Failed · 7d"
          value={failedWeek.length}
          note="Failed or rolled back"
          tone={failedWeek.length ? 'bad' : 'ok'}
        />
        <StatCard label="Succeeded · 7d" value={succeededWeek.length} note="Last seven days" />
        <StatCard
          label="Success rate"
          value={successRate === null ? '—' : `${successRate}%`}
          note={`${week.length} in 7 days`}
          tone={
            successRate === null
              ? 'neutral'
              : successRate >= 90
                ? 'ok'
                : successRate >= 75
                  ? 'warn'
                  : 'bad'
          }
        />
        <StatCard
          label="Production"
          value={scoped.filter((d) => d.env === 'production').length}
          note="Prod records on file"
        />
      </StatStrip>

      <Panel
        title="Awaiting approval"
        meta={
          <span className={awaiting.length ? 'font-semibold text-warn' : 'text-muted'}>
            {awaiting.length} pending
          </span>
        }
        filter={
          <SearchInput
            value={q.approvals}
            onChange={set('approvals')}
            placeholder="Filter by product, env, commit or author…"
            label="Filter pending approvals"
          />
        }
      >
        {approvalHits.length === 0 ? (
          <p className="px-3.5 py-4 text-center text-[12px] text-muted">
            {awaiting.length === 0 ? 'Nothing waiting for approval.' : 'No matches.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {approvalHits.map((d) => (
              <li
                key={d.id}
                className="flex flex-col gap-2 px-3.5 py-2 md:flex-row md:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <ProductMark product={d.product} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold text-ink">
                      {nameOf(d.product)} <span className="capitalize">{d.env}</span>
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted">
                      {d.sha} {d.message}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10.5px] text-muted">
                      <span className="flex items-center gap-1">
                        <Avatar id={d.author} size="xs" /> {memberById(d.author).name}
                      </span>
                      <span>
                        {d.provider} · requested {d.ago === 'now' ? 'just now' : `${d.ago} ago`}
                      </span>
                    </p>
                  </div>
                </div>
                {mayApprove || mayManage ? (
                  <div className="flex shrink-0 gap-1.5">
                    {mayManage && (
                      <GuardedButton
                        size="sm"
                        allowed={mayManage}
                        reason="Needs Deployment: manage"
                        onClick={() =>
                          requestReauth({
                            title: `Reject ${d.env} deploy`,
                            description: `${d.sha} will be marked rolled back and not executed.`,
                            actionLabel: 'Verify & reject',
                            onConfirm: () => decide(d, false),
                          })
                        }
                      >
                        Reject
                      </GuardedButton>
                    )}
                    {mayApprove && (
                      <GuardedButton
                        size="sm"
                        variant="primary"
                        allowed={d.requestedBy !== session?.memberId}
                        reason="Two-person rule: you requested this deployment"
                        icon={<ShieldCheckIcon className="h-3.5 w-3.5" />}
                        onClick={() =>
                          requestReauth({
                            title: `Approve ${d.env} deploy`,
                            description: `${d.sha} will be handed to ${d.provider}.`,
                            actionLabel: 'Verify & approve',
                            onConfirm: () => decide(d, true),
                          })
                        }
                      >
                        Approve
                      </GuardedButton>
                    )}
                  </div>
                ) : (
                  <span className="shrink-0 text-[11px] text-muted">
                    Approval needs Deployment: manage
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Environments"
        meta={<span>Latest deploy per lane</span>}
        filter={
          <SearchInput
            value={q.environments}
            onChange={set('environments')}
            placeholder="Filter by product, env or commit…"
            label="Filter environments"
          />
        }
      >
        {envHits.length === 0 ? (
          <p className="px-3.5 py-4 text-center text-[12px] text-muted">
            {lanesByProduct.length === 0
              ? 'No deployments recorded yet.'
              : 'No environments match this filter.'}
          </p>
        ) : (
          <div className="divide-y divide-line">
            {envHits.map((p) => (
              <div
                key={p.productId}
                className="grid gap-2 px-3.5 py-2.5 lg:grid-cols-[160px_1fr] lg:items-center"
              >
                <div className="flex items-center gap-2">
                  <ProductMark product={p.productId} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold text-ink">
                      {nameOf(p.productId)}
                    </p>
                    <p className="text-[10.5px] text-subtle">{p.lanes[0]?.provider ?? '—'}</p>
                  </div>
                </div>
                <EnvironmentPipeline lanes={p.lanes} />
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel
          title="History"
          className="xl:col-span-2"
          bodyClassName="flex flex-col"
          meta={
            <span>
              {visible.length} of {scoped.length}
            </span>
          }
          filter={
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<Filter>
                label="Filter by status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'all', label: 'All' },
                  {
                    value: 'failed',
                    label: 'Failed',
                    count: scoped.filter((d) => d.status === 'failed').length,
                  },
                  { value: 'awaiting-approval', label: 'Awaiting', count: awaiting.length },
                  { value: 'succeeded', label: 'Succeeded' },
                ]}
              />
              <div className="min-w-[160px] flex-1">
                <SearchInput
                  value={q.history}
                  onChange={set('history')}
                  placeholder="Search product, env, commit…"
                  label="Filter deployment history"
                />
              </div>
            </div>
          }
        >
          <DeploymentsTable rows={visible} showProvider />
        </Panel>
        <div className="grid content-start gap-3 md:grid-cols-2 xl:grid-cols-1">
          <Panel title="Frequency" meta={<span>7 days · from deployment records</span>}>
            <Suspense fallback={<LoadingRows rows={2} label="Loading chart" />}>
              <DeployFrequencyChart rows={scoped} days={7} height={90} />
            </Suspense>
          </Panel>
          <Panel title="Production release policy">
            <ul className="space-y-1.5 px-3.5 py-2.5">
              {policy.map((p) => (
                <li key={p} className="flex items-start gap-2 text-[12px] text-ink">
                  <CircleCheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
                  {p}
                </li>
              ))}
              <li className="pt-1 text-[11px] text-muted">
                A merged PR does not mean production is updated — these remain separate states.
              </li>
            </ul>
          </Panel>
        </div>
      </div>
      <RecordDeploymentModal
        open={recordOpen}
        onClose={() => {
          setRecordOpen(false);
          document.getElementById('record-deploy-trigger')?.focus();
        }}
      />
    </div>
  );
}
