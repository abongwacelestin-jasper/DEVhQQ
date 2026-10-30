import { useCallback } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { CodeIcon, PlusIcon, SirenIcon } from 'lucide-react';
import { PageHero } from '../../components/ui/PageHero';
import { ProductMark } from '../../components/ui/ProductMark';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Button } from '../../components/ui/Button';
import { NotFound } from '../../components/ui/NotFound';
import { FilterBar, type SelectFilter } from '../../components/filters/FilterBar';
import { useWork } from '../../contexts/WorkContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { useIncidents } from '../../contexts/IncidentContext';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { useUrlFilters } from '../../hooks/useUrlFilters';
import { products } from '../../data/portfolio';
import { pullRequests } from '../../data/engineering';
import { deployments, environments } from '../../data/operations';
import { members } from '../../data/team';
import { healthMeta, memberById, priorityMeta, taskStatusMeta } from '../../utils/status';
import { parseWhen } from '../../utils/date';
import type { ProductTabContext } from '../../hooks/useProductTab';

const keys = ['q', 'person', 'priority', 'status'] as const;

const tabs = [
  { to: '', label: 'Overview' },
  { to: 'work', label: 'Work' },
  { to: 'code', label: 'Code' },
  { to: 'deployments', label: 'Deployments' },
  { to: 'incidents', label: 'Incidents' },
  { to: 'analytics', label: 'Analytics' },
  { to: 'people', label: 'People' },
];

const envDot = {
  healthy: 'bg-ok',
  failed: 'bg-bad',
  pending: 'bg-warn',
  degraded: 'bg-bad',
} as const;

const statusOptions: Record<string, { value: string; label: string }[]> = {
  work: Object.entries(taskStatusMeta).map(([value, m]) => ({ value, label: m.label })),
  deployments: [
    { value: 'succeeded', label: 'Succeeded' },
    { value: 'failed', label: 'Failed' },
    { value: 'awaiting-approval', label: 'Awaiting approval' },
    { value: 'running', label: 'Running' },
  ],

  incidents: [
    { value: 'investigating', label: 'Investigating' },
    { value: 'monitoring', label: 'Monitoring' },
    { value: 'resolved', label: 'Resolved' },
  ],

  code: [
    { value: 'review-required', label: 'Review required' },
    { value: 'changes-requested', label: 'Changes requested' },
    { value: 'approved', label: 'Approved' },
  ],
};

export function ProductLayout() {
  const { productId } = useParams();
  const { pathname } = useLocation();
  const { tasks } = useWork();
  const { incidents, setDeclareOpen } = useIncidents();
  const { canSeeProduct, canDo } = useAuth();
  const { inRange } = useDateRange();
  const { openCreateTask } = useWorkspaceUI();
  const f = useUrlFilters(keys);
  const apply = useCallback(
    (vals: Record<string, string>) =>
      f.setMany(Object.fromEntries(keys.map((k) => [k, vals[k] ?? '']))),
    [f],
  );

  const product = products.find((p) => p.id === productId);
  if (!product || !canSeeProduct(product.id))
    return <NotFound what="Product" backTo="/" backLabel="Back to overview" />;

  const tab = pathname.split('/')[3] ?? '';
  const h = healthMeta[product.health];
  const own = tasks.filter((t) => t.product === product.id);
  const open = own.filter((t) => t.status !== 'done');
  const reviews = pullRequests.filter(
    (p) => p.product === product.id && p.review === 'review-required',
  ).length;
  const deploys = deployments.filter(
    (d) => d.product === product.id && inRange(parseWhen(d.ago)),
  ).length;
  const lanes = environments.filter((e) => e.product === product.id);
  const openIncidents = incidents.filter(
    (i) => i.product === product.id && i.status !== 'resolved',
  ).length;
  const team = members.filter((m) => m.status === 'active' && m.products.includes(product.id));

  const selects: SelectFilter[] = [
    { key: 'person', label: 'Person', options: team.map((m) => ({ value: m.id, label: m.name })) },
  ];
  if (tab === '' || tab === 'work')
    selects.push({
      key: 'priority',
      label: 'Priority',
      options: Object.entries(priorityMeta).map(([value, m]) => ({ value, label: m.label })),
    });
  if (statusOptions[tab])
    selects.push({ key: 'status', label: 'Status', options: statusOptions[tab] });

  const ctx: ProductTabContext = { product, filters: f.values };

  return (
    <div className="space-y-3.5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12px] text-muted">
        <Link to="/" className="hover:text-ink hover:underline">
          Portfolio
        </Link>
        <span className="text-line-strong">/</span>
        <span className="font-medium text-ink">{product.name}</span>
      </nav>

      <PageHero
        tint={
          product.health === 'healthy'
            ? 'accent'
            : product.health === 'degraded'
              ? 'bad'
              : 'neutral'
        }
        illustration={<ProductMark product={product.id} size="xl" />}
        eyebrow={
          <>
            {product.tagline} · led by{' '}
            <Link to={`/team/${product.lead}`} className="font-medium text-ink hover:underline">
              {memberById(product.lead).name}
            </Link>
          </>
        }
        title={product.name}
        badges={
          <>
            <StatusBadge tone={h.tone} label={h.label} dot />
            {openIncidents > 0 && (
              <StatusBadge
                tone="bad"
                label={`${openIncidents} open incident${openIncidents > 1 ? 's' : ''}`}
              />
            )}
            <span className="ml-1 flex items-center gap-2" aria-label="Environment status">
              {lanes.map((l) => (
                <span
                  key={l.env}
                  className="flex items-center gap-1 text-[11.5px] text-ink"
                  title={`${l.env}: ${l.status}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${envDot[l.status]}`} />
                  {l.env[0].toUpperCase() + l.env.slice(1, 4)}
                </span>
              ))}
            </span>
          </>
        }
        description={product.healthReasons.join(' · ')}
        actions={
          <>
            {canDo('task:create') && (
              <Button
                size="sm"
                variant="primary"
                icon={<PlusIcon className="h-3.5 w-3.5" />}
                onClick={() => openCreateTask()}
              >
                New task
              </Button>
            )}
            <Link
              to={`/products/${product.id}/ide`}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[12px] font-medium text-ink hover:border-line-strong"
            >
              <CodeIcon className="h-3.5 w-3.5" /> Open IDE
            </Link>
            {canDo('incident:declare') && (
              <Button
                size="sm"
                icon={<SirenIcon className="h-3.5 w-3.5" />}
                onClick={() => setDeclareOpen(true)}
              >
                Declare incident
              </Button>
            )}
          </>
        }
        stats={[
          { label: 'Open tasks', value: open.length, to: `/products/${product.id}/work` },
          {
            label: 'Overdue',
            value: open.filter((t) => t.overdue).length,
            tone: open.some((t) => t.overdue) ? 'bad' : undefined,
          },
          {
            label: 'Reviews waiting',
            value: reviews,
            tone: reviews ? 'warn' : undefined,
            to: `/products/${product.id}/code`,
          },
          { label: 'Deploys in range', value: deploys, to: `/products/${product.id}/deployments` },
          {
            label: 'Uptime 30d',
            value: `${product.uptime}%`,
            tone: product.uptime < 99.5 ? 'warn' : 'ok',
          },
        ]}
      />

      <nav
        aria-label={`${product.name} sections`}
        className="-mx-3 overflow-x-auto px-3 scroll-thin sm:mx-0 sm:px-0"
      >
        <ul className="flex min-w-max gap-0.5 border-b border-line">
          {tabs.map((t) => (
            <li key={t.label}>
              <NavLink
                to={`/products/${product.id}${t.to ? `/${t.to}` : ''}`}
                end
                className={({ isActive }) =>
                  `relative block px-3 py-2 text-[12.5px] font-medium transition-colors duration-150 ${
                    isActive
                      ? 'text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-ink'
                      : 'text-muted hover:text-ink'
                  }`
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {tab !== 'analytics' && (
        <FilterBar
          id={`product-${tab || 'overview'}`}
          values={f.values}
          onChange={(k, val) => f.set(k as (typeof keys)[number], val)}
          onApply={apply}
          onReset={f.reset}
          activeCount={f.activeCount}
          count={tab === 'people' ? team.length : own.length}
          noun={tab === 'people' ? 'people' : tab === 'deployments' ? 'records' : 'tasks'}
          search={{ key: 'q', placeholder: `Search ${product.name}…` }}
          selects={selects}
        />
      )}

      <Outlet context={ctx} />
    </div>
  );
}
