import { useState } from 'react';
import { toast } from 'sonner';
import { CircleCheckIcon, PlusIcon, ShieldCheckIcon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Segmented } from '../components/ui/Segmented';
import { ProductMark } from '../components/ui/ProductMark';
import { Avatar } from '../components/ui/Avatar';
import { EnvironmentPipeline } from '../components/delivery/EnvironmentPipeline';
import { DeploymentsTable } from '../components/delivery/DeploymentsTable';
import { DeployFrequencyChart } from '../components/delivery/DeployFrequencyChart';
import { DeployTopology } from '../components/delivery/DeployTopology';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useReauth } from '../contexts/ReauthContext';
import { useDeployments } from '../hooks/useDeployments';
import { environments } from '../data/operations';
import { products } from '../data/portfolio';
import { memberById } from '../utils/status';
import type { DeployStatus, Deployment } from '../types/operations';

type Filter = 'all' | DeployStatus;

const policy = [
  'CI checks passing on the release commit',
  'Staging deploy succeeded for the same commit',
  'Approval from Owner or Operations',
  'MFA re-confirmation at approval time',
];

export function Deployments() {
  const { matches } = useProductFilter();
  const { requestReauth } = useReauth();
  const { deployments: rows, approve, rollback } = useDeployments();
  const [filter, setFilter] = useState<Filter>('all');

  const scoped = rows.filter((d) => matches(d.product));
  const awaiting = scoped.filter((d) => d.status === 'awaiting-approval');
  const visible = scoped.filter((d) => filter === 'all' || d.status === filter);

  const decide = (d: Deployment, ok: boolean) => {
    if (ok) void approve(d.id);
    else void rollback(d.id);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Deployments"
        description="Every deployment attempt across providers in one history. Execution stays with GitHub Actions and Coolify — DevHQ records, approves and correlates."
        actions={
          <button
            onClick={() =>
              toast('Record a deployment', {
                description: 'Manual records are marked as source: DevHQ.',
              })
            }
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:border-line-strong"
          >
            <PlusIcon className="h-4 w-4" /> Record deployment
          </button>
        }
      />

      {awaiting.map((d) => (
        <div
          key={d.id}
          className="flex flex-col gap-3 rounded-xl border border-warn/30 bg-warn-soft/60 px-4 py-3.5 md:flex-row md:items-center"
        >
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <ProductMark product={d.product} size="md" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                Approval needed · {products.find((p) => p.id === d.product)?.name}{' '}
                <span className="capitalize">{d.env}</span>
              </p>
              <p className="mt-0.5 truncate font-mono text-xs text-muted">
                {d.sha} {d.message}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                <span className="flex items-center gap-1">
                  <Avatar id={d.author} size="xs" /> {memberById(d.author).name}
                </span>
                <span className="flex items-center gap-1 text-ok">
                  <CircleCheckIcon className="h-3 w-3" /> CI passing
                </span>
                <span>
                  {d.provider} · requested {d.ago === 'now' ? 'just now' : `${d.ago} ago`}
                </span>
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => decide(d, false)}
              className="h-9 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-sunken"
            >
              Reject
            </button>
            <button
              onClick={() =>
                requestReauth({
                  title: `Approve ${d.env} deploy`,
                  description: `${d.sha} will be handed to ${d.provider}.`,
                  actionLabel: 'Verify & approve',
                  onConfirm: () => decide(d, true),
                })
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-white hover:bg-ink/90"
            >
              <ShieldCheckIcon className="h-4 w-4" /> Approve
            </button>
          </div>
        </div>
      ))}

      <DeployTopology productIds={products.filter((p) => matches(p.id)).map((p) => p.id)} />

      <section aria-label="Environments" className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Environments</h2>
        {products
          .filter((p) => matches(p.id))
          .map((p) => (
            <div
              key={p.id}
              className="grid gap-3 rounded-xl border border-line bg-surface p-3 lg:grid-cols-[180px_1fr] lg:items-center"
            >
              <div className="flex items-center gap-2.5 px-1">
                <ProductMark product={p.id} size="md" />
                <div>
                  <p className="text-sm font-semibold text-ink">{p.name}</p>
                  <p className="text-[11px] text-subtle">
                    {environments.find((e) => e.product === p.id)?.provider}
                  </p>
                </div>
              </div>
              <EnvironmentPipeline lanes={environments.filter((e) => e.product === p.id)} />
            </div>
          ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel
          title="History"
          className="xl:col-span-2"
          bodyClassName="flex flex-col"
          meta={<span>{visible.length} records</span>}
        >
          <div className="border-b border-line px-4 py-2.5">
            <Segmented<Filter>
              label="Filter by status"
              value={filter}
              onChange={setFilter}
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
          </div>
          <DeploymentsTable rows={visible} showProvider />
        </Panel>
        <div className="grid content-start gap-5 md:grid-cols-2 xl:grid-cols-1">
          <Panel title="Frequency" meta={<span>7 days</span>}>
            <DeployFrequencyChart height={100} />
          </Panel>
          <Panel title="Production release policy">
            <ul className="space-y-2.5 px-4 py-3.5">
              {policy.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-ink">
                  <CircleCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                  {p}
                </li>
              ))}
              <li className="pt-1 text-xs text-muted">
                A merged PR does not mean production is updated — these remain separate states.
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
