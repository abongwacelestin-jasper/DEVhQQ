import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FlagIcon, TriangleAlertIcon } from 'lucide-react';
import { Panel } from '../../components/ui/Panel';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { Avatar } from '../../components/ui/Avatar';
import { EnvironmentPipeline } from '../../components/delivery/EnvironmentPipeline';
import { lanesFromDeployments } from '../../components/delivery/environments';
import { DeliveryReliabilityCards } from '../../components/analytics/DeliveryReliabilityCards';
import { useWork } from '../../contexts/WorkContext';
import { useIncidents } from '../../contexts/IncidentContext';
import { useProductTab, textMatch } from '../../hooks/useProductTab';
import { useDeployments } from '../../hooks/useDeployments';
import { projects } from '../../data/work';
import { releases } from '../../data/portfolio';
import { deployMeta, firstName, memberById, projectStatusMeta } from '../../utils/status';
import { formatDateTime } from '../../utils/date';
import type { ProductId } from '../../types/portfolio';

export function ProductOverview() {
  const { product, filters } = useProductTab();
  const { tasks } = useWork();
  const { incidents } = useIncidents();
  const { deployments, loading: deploysLoading } = useDeployments();
  const lanes = lanesFromDeployments(deployments, product.id);
  const latestProd = deployments
    .filter((d) => d.product === product.id && d.env === 'production')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const match = useCallback((p: ProductId) => p === product.id, [product.id]);

  const own = tasks.filter((t) => t.product === product.id);
  const list = projects.filter(
    (p) =>
      p.product === product.id &&
      textMatch(filters.q, p.name, p.objective) &&
      (!filters.person || p.lead === filters.person),
  );
  const incident = incidents.find((i) => i.product === product.id && i.status !== 'resolved');
  const next = releases.filter((r) => r.product === product.id)[0];

  return (
    <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3.5">
        <Panel title="Environments" meta={<span>{lanes[0]?.provider ?? ''}</span>}>
          <div className="p-2.5">
            {deploysLoading && deployments.length === 0 ? (
              <p className="px-1 py-2 text-[12px] text-muted">Loading environments…</p>
            ) : (
              <EnvironmentPipeline lanes={lanes} />
            )}
          </div>
        </Panel>

        <Panel title="Active projects" meta={<span className="tabular-nums">{list.length}</span>}>
          {list.length === 0 ? (
            <p className="px-3.5 py-4 text-[12.5px] text-muted">No projects match these filters.</p>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((p) => {
                const pt = own.filter((t) => t.projectId === p.id);
                const done = pt.filter((t) => t.status === 'done').length;
                const late = pt.filter((t) => t.overdue).length;
                const pct = pt.length ? (done / pt.length) * 100 : 0;
                const meta = projectStatusMeta[p.status];
                return (
                  <li key={p.id}>
                    <Link
                      to={`/projects/${p.id}`}
                      className="grid gap-x-4 gap-y-1.5 px-3.5 py-2 transition-colors duration-150 hover:bg-sunken/50 md:grid-cols-[minmax(0,1fr)_96px_110px_200px] md:items-center"
                    >
                      <div className="min-w-0">
                        <p className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-ink">
                          <span className="truncate">{p.name}</span>
                        </p>
                        <p className="truncate text-[11.5px] text-muted">{p.objective}</p>
                      </div>
                      <StatusBadge tone={meta.tone} label={meta.label} />
                      <span className="flex items-center gap-1.5 text-[12px] text-ink">
                        <Avatar id={p.lead} size="xs" />
                        {firstName(p.lead)}
                        {late > 0 && (
                          <span className="text-[11.5px] font-semibold text-bad">
                            · {late} late
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        <ProgressBar
                          className="flex-1"
                          value={pct}
                          tone={meta.tone === 'ok' ? 'accent' : meta.tone}
                          label={`${p.name} progress`}
                        />
                        <span className="w-12 text-right text-[11.5px] tabular-nums text-ink">
                          {done}/{pt.length}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="Latest production release"
          meta={
            latestProd ? (
              <Link
                to={`/deployments/${latestProd.id}`}
                className="font-mono text-accent hover:underline"
              >
                {latestProd.id}
              </Link>
            ) : undefined
          }
        >
          {latestProd ? (
            <dl className="grid gap-x-4 gap-y-1 px-3.5 py-2.5 text-[12px] sm:grid-cols-2">
              <div className="flex gap-1.5">
                <dt className="text-muted">Release</dt>
                <dd className="font-mono text-ink">
                  {latestProd.sha} · {latestProd.version}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-muted">Status</dt>
                <dd>
                  <StatusBadge {...deployMeta[latestProd.status]} dot />
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-muted">Requested</dt>
                <dd className="text-ink">
                  {memberById(latestProd.requestedBy).name} ·{' '}
                  {formatDateTime(new Date(latestProd.createdAt))}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-muted">Approved</dt>
                <dd className="text-ink">
                  {latestProd.approvedBy ? memberById(latestProd.approvedBy).name : '—'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="px-3.5 py-4 text-[12.5px] text-muted">
              No production deployment recorded for {product.name} yet.
            </p>
          )}
        </Panel>
      </div>

      <div className="space-y-2.5">
        {incident && (
          <Link
            to={`/incidents/${incident.id}`}
            className="flex items-start gap-2.5 rounded-lg border border-bad/30 bg-bad-soft/60 px-3 py-2.5 transition-colors duration-150 hover:bg-bad-soft"
          >
            <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-bad" />
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold text-ink">
                {incident.id} · {incident.severity}
              </span>
              <span className="block truncate text-[12px] text-ink">{incident.title}</span>
              <span className="block text-[11.5px] text-muted">
                Owner {firstName(incident.owner)} · {incident.duration}
              </span>
            </span>
          </Link>
        )}
        {next && (
          <section
            className="rounded-lg border border-line bg-white px-3 py-2.5"
            aria-label="Next milestone"
          >
            <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
              <FlagIcon className="h-3.5 w-3.5 text-accent" /> Next milestone
            </h3>
            <p className="mt-1 text-[12.5px] font-semibold text-ink">{next.name}</p>
            <p className="text-[11.5px] text-muted">
              {next.scope} · due {next.due}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <ProgressBar
                className="flex-1"
                value={(next.done / next.total) * 100}
                tone="accent"
                label="Milestone progress"
              />
              <span className="text-[11.5px] tabular-nums text-ink">
                {next.done}/{next.total}
              </span>
            </div>
          </section>
        )}
        <DeliveryReliabilityCards match={match} />
      </div>
    </div>
  );
}
