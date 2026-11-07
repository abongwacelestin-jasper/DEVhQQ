import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { PageHero } from '../components/ui/PageHero';
import { StatusBadge } from '../components/ui/StatusBadge';
import { DataAuthorityDiagram } from '../components/admin/DataAuthorityDiagram';
import { IntegrationsIllustration } from '../components/illustrations/IntegrationsIllustration';
import { DataState, SampleDataBadge } from '../components/engineering/states';
import { useIntegrations } from '../components/engineering/data/hooks';
import type { ApiIntegration } from '../components/engineering/data/types';
import {
  categoryIcon,
  integrationKinds,
  kindMeta,
  statusMeta,
  type IntegrationCategory,
} from '../components/integrations/catalogue';
import { formatDay } from '../utils/date';

type StatusFilter = 'all' | 'active' | 'attention' | 'available';

/** A row is either a real API integration or a known kind with no API row. */
interface Row {
  key: string;
  to: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  status: keyof typeof statusMeta;
  account?: string;
  lastEventAt?: string;
  api?: ApiIntegration;
}

const statusFilters: { id: StatusFilter; label: string; test: (r: Row) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'active', label: 'Connected', test: (r) => r.status === 'connected' },
  {
    id: 'attention',
    label: 'Needs attention',
    test: (r) => r.status === 'degraded' || r.status === 'error',
  },
  {
    id: 'available',
    label: 'Not connected',
    test: (r) => !r.api || r.status === 'available' || r.status === 'disconnected',
  },
];

const cols = 'md:grid-cols-[minmax(0,2.2fr)_140px_minmax(0,1.6fr)_110px_132px]';

function toRow(i: ApiIntegration): Row {
  const meta = kindMeta(i.kind, i.name);
  return {
    key: i.id,
    to: `/integrations/${encodeURIComponent(i.id)}`,
    name: i.name || meta.name,
    category: meta.category,
    description: i.description || meta.description,
    status: i.status,
    account: i.account,
    lastEventAt: i.lastEventAt,
    api: i,
  };
}

export function Integrations() {
  const { items, status: loadStatus, error, source, reload } = useIntegrations();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<IntegrationCategory | 'all'>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [showFlow, setShowFlow] = useState(false);
  const ready = loadStatus === 'ready';

  const all = useMemo<Row[]>(() => {
    if (!ready) return [];
    const fromApi = items.map(toRow);
    const kindsWithRows = new Set(items.map((i) => i.kind));
    const missing: Row[] = integrationKinds
      .filter((k) => !kindsWithRows.has(k.kind))
      .map((k) => ({
        key: `kind:${k.kind}`,
        to: `/integrations/${encodeURIComponent(k.kind)}`,
        name: k.name,
        category: k.category,
        description: k.description,
        status: 'not-connected',
      }));
    return [...fromApi, ...missing];
  }, [items, ready]);

  const connected = all.filter((r) => r.api && r.status === 'connected');
  const attention = all.filter((r) => r.status === 'degraded' || r.status === 'error');
  const categories = Array.from(new Set(all.map((r) => r.category)));

  const rows = useMemo(() => {
    const test = statusFilters.find((s) => s.id === status)?.test ?? (() => true);
    const needle = q.trim().toLowerCase();
    return all.filter(
      (r) =>
        (cat === 'all' || r.category === cat) &&
        test(r) &&
        (!needle || `${r.name} ${r.description} ${r.account ?? ''}`.toLowerCase().includes(needle)),
    );
  }, [all, q, cat, status]);

  return (
    <div className="space-y-3.5">
      <PageHero
        illustration={<IntegrationsIllustration className="h-[84px] w-auto" />}
        title="Integrations"
        description="DevHQ sits above your tools, not instead of them. Each connection states what it syncs and which tool stays authoritative."
        badges={
          <>
            <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ok">
              <ShieldCheckIcon className="h-3.5 w-3.5" /> Credentials encrypted · Owners only ·
              webhooks signed
            </span>
            <SampleDataBadge source={source} />
          </>
        }
        stats={
          ready
            ? [
                { label: 'Connected', value: connected.length },
                {
                  label: 'Needs attention',
                  value: attention.length,
                  tone: attention.length ? 'warn' : 'ok',
                },
                { label: 'Known kinds', value: all.length },
              ]
            : [
                { label: 'Connected', value: '—' },
                { label: 'Needs attention', value: '—' },
              ]
        }
      />

      {attention.length > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/30 bg-warn-soft/60 px-3.5 py-2 text-[12.5px] text-ink"
        >
          <TriangleAlertIcon className="h-4 w-4 shrink-0 text-warn" aria-hidden />
          <span className="min-w-0 flex-1">
            <b>{attention.map((d) => d.name).join(', ')}</b>{' '}
            {attention.length === 1 ? 'needs' : 'need'} attention.
          </span>
          <Link to={attention[0].to} className="font-semibold text-ink underline">
            Investigate
          </Link>
        </div>
      )}

      {!ready ? (
        <DataState
          status={loadStatus}
          error={error}
          what="Integrations"
          onRetry={() => void reload()}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <label className="relative block lg:w-72">
              <span className="sr-only">Search integrations</span>
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or account"
                className="h-8 w-full rounded-md border border-line bg-white pl-8 pr-2 text-[12.5px] outline-none focus:border-accent"
              />
            </label>
            <div
              role="group"
              aria-label="Category"
              className="flex gap-1 overflow-x-auto scroll-thin"
            >
              {(['all', ...categories] as const).map((c) => {
                const Icon = c === 'all' ? null : categoryIcon[c];
                return (
                  <button
                    key={c}
                    aria-pressed={cat === c}
                    onClick={() => setCat(c)}
                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors duration-150 ${cat === c ? 'bg-ink text-white' : 'text-ink hover:bg-sunken'}`}
                  >
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    {c === 'all' ? 'All categories' : c}
                  </button>
                );
              })}
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              aria-label="Status"
              className="h-8 rounded-md border border-line bg-white px-2 text-[12.5px] text-ink lg:ml-auto"
            >
              {statusFilters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <section
            className="overflow-hidden rounded-lg border border-line bg-white"
            aria-label="Integrations"
          >
            <div
              aria-hidden
              className={`hidden gap-4 border-b border-line bg-sunken/50 px-4 py-2 text-[11.5px] font-medium text-muted md:grid ${cols}`}
            >
              <span>Integration</span>
              <span>Category</span>
              <span>Account</span>
              <span>Last event</span>
              <span className="text-right">Status</span>
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-[12.5px] text-muted">
                No integrations match these filters.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((r) => {
                  const Icon = categoryIcon[r.category];
                  return (
                    <li key={r.key}>
                      <Link
                        to={r.to}
                        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-150 hover:bg-sunken/50 focus-visible:bg-sunken/50 ${cols}`}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-sunken/60">
                            <Icon className="h-4 w-4 text-ink" />
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-ink">
                              {r.name}
                              <SampleDataBadge source={r.api?.source} />
                            </span>
                            <span className="block truncate text-[12px] text-muted">
                              {r.description || '—'}
                            </span>
                          </span>
                        </span>
                        <span className="hidden truncate text-[12.5px] text-ink md:block">
                          {r.category}
                        </span>
                        <span className="hidden truncate font-mono text-[12px] text-muted md:block">
                          {r.account ?? '—'}
                        </span>
                        <span className="hidden text-[12px] tabular-nums text-muted md:block">
                          {r.lastEventAt ? formatDay(new Date(r.lastEventAt)) : '—'}
                        </span>
                        <span className="flex items-center justify-end gap-2">
                          <StatusBadge {...statusMeta[r.status]} dot />
                          <ChevronRightIcon className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <button
          onClick={() => setShowFlow((v) => !v)}
          aria-expanded={showFlow}
          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-sunken/50"
        >
          <span>
            <span className="block text-[13px] font-semibold text-ink">
              Where each piece of data lives
            </span>
            <span className="block text-[12px] text-muted">
              Which tool is authoritative, and what DevHQ only mirrors.
            </span>
          </span>
          <ChevronDownIcon
            className={`h-4 w-4 text-muted transition-transform duration-200 ${showFlow ? 'rotate-180' : ''}`}
          />
        </button>
        {showFlow && (
          <div className="overflow-x-auto border-t border-line p-3 scroll-thin">
            <DataAuthorityDiagram />
          </div>
        )}
      </section>
    </div>
  );
}
