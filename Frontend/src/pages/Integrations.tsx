import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BellIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  GitBranchIcon,
  KeyRoundIcon,
  RadarIcon,
  RocketIcon,
  SearchIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { PageHero } from '../components/ui/PageHero';
import { StatusBadge } from '../components/ui/StatusBadge';
import { DataAuthorityDiagram } from '../components/admin/DataAuthorityDiagram';
import { IntegrationsIllustration } from '../components/illustrations/IntegrationsIllustration';
import { integrations } from '../data/team';
import type { Integration } from '../types/team';
import type { Tone } from '../types/portfolio';

type Category = Integration['category'];
type StatusFilter = 'all' | 'active' | 'attention' | 'available';

const statusMeta: Record<Integration['status'], { label: string; tone: Tone }> = {
  connected: { label: 'Connected', tone: 'ok' },
  degraded: { label: 'Degraded', tone: 'warn' },
  'not-connected': { label: 'Not connected', tone: 'neutral' },
  planned: { label: 'Planned', tone: 'info' },
};

const categoryIcon: Record<Category, React.ComponentType<{ className?: string }>> = {
  'Source control': GitBranchIcon,
  Deployment: RocketIcon,
  Monitoring: RadarIcon,
  Identity: KeyRoundIcon,
  Storage: DatabaseIcon,
  Notifications: BellIcon,
};
const categories = Object.keys(categoryIcon) as Category[];

const statusFilters: { id: StatusFilter; label: string; test: (i: Integration) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'active', label: 'Connected', test: (i) => i.status === 'connected' },
  { id: 'attention', label: 'Needs attention', test: (i) => i.status === 'degraded' },
  {
    id: 'available',
    label: 'Available',
    test: (i) => i.status === 'not-connected' || i.status === 'planned',
  },
];

/** Shared column template so headers and every row line up exactly. */
const cols = 'md:grid-cols-[minmax(0,2.2fr)_140px_minmax(0,2fr)_96px_132px]';

export function Integrations() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [showFlow, setShowFlow] = useState(false);

  const live = integrations.filter((i) => i.status === 'connected' || i.status === 'degraded');
  const degraded = integrations.filter((i) => i.status === 'degraded');
  const rows = useMemo(() => {
    const test = statusFilters.find((s) => s.id === status)!.test;
    return integrations.filter(
      (i) =>
        (cat === 'all' || i.category === cat) &&
        test(i) &&
        (!q ||
          `${i.name} ${i.detail} ${i.syncs.join(' ')}`.toLowerCase().includes(q.toLowerCase())),
    );
  }, [q, cat, status]);

  return (
    <div className="space-y-3.5">
      <PageHero
        illustration={<IntegrationsIllustration className="h-[84px] w-auto" />}
        title="Integrations"
        description="DevHQ sits above your tools, not instead of them. Each connection states what it syncs and which tool stays authoritative."
        badges={
          <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ok">
            <ShieldCheckIcon className="h-3.5 w-3.5" /> Credentials encrypted · Owners only ·
            webhooks signed
          </span>
        }
        stats={[
          { label: 'Connected', value: `${live.length}/${integrations.length}` },
          { label: 'Degraded', value: degraded.length, tone: degraded.length ? 'warn' : 'ok' },
          { label: 'Categories', value: categories.length },
          { label: 'Data synced', value: live.reduce((n, i) => n + i.syncs.length, 0) },
        ]}
      />

      {degraded.length > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/30 bg-warn-soft/60 px-3.5 py-2 text-[12.5px] text-ink"
        >
          <TriangleAlertIcon className="h-4 w-4 shrink-0 text-warn" />
          <span className="min-w-0 flex-1">
            <b>{degraded.map((d) => d.name).join(', ')}</b> {degraded.length === 1 ? 'is' : 'are'}{' '}
            degraded — {degraded[0].detail}.
          </span>
          <Link to={`/integrations/${degraded[0].id}`} className="font-semibold text-ink underline">
            Investigate
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative block lg:w-72">
          <span className="sr-only">Search integrations</span>
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or data"
            className="h-8 w-full rounded-md border border-line bg-white pl-8 pr-2 text-[12.5px] outline-none focus:border-accent"
          />
        </label>
        <div
          role="tablist"
          aria-label="Category"
          className="flex gap-1 overflow-x-auto scroll-thin"
        >
          {(['all', ...categories] as const).map((c) => {
            const Icon = c === 'all' ? null : categoryIcon[c];
            return (
              <button
                key={c}
                role="tab"
                aria-selected={cat === c}
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
          className={`hidden gap-4 border-b border-line bg-sunken/50 px-4 py-2 text-[11.5px] font-medium text-muted md:grid ${cols}`}
        >
          <span>Integration</span>
          <span>Category</span>
          <span>What it syncs</span>
          <span>Last sync</span>
          <span className="text-right">Status</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-muted">
            No integrations match these filters.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((i) => {
              const Icon = categoryIcon[i.category];
              return (
                <li key={i.id}>
                  <Link
                    to={`/integrations/${i.id}`}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-150 hover:bg-sunken/50 ${cols}`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-sunken/60">
                        <Icon className="h-4 w-4 text-ink" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-ink">
                          {i.name}
                        </span>
                        <span className="block truncate text-[12px] text-muted">{i.detail}</span>
                      </span>
                    </span>
                    <span className="hidden truncate text-[12.5px] text-ink md:block">
                      {i.category}
                    </span>
                    <span className="col-span-2 hidden min-w-0 flex-wrap gap-1 md:col-span-1 md:flex">
                      {i.syncs.length ? (
                        i.syncs.slice(0, 3).map((s) => (
                          <span
                            key={s}
                            className="rounded bg-sunken px-1.5 py-px text-[11px] text-muted"
                          >
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-[12px] text-subtle">—</span>
                      )}
                      {i.syncs.length > 3 && (
                        <span className="text-[11px] text-muted">+{i.syncs.length - 3}</span>
                      )}
                    </span>
                    <span className="hidden text-[12px] tabular-nums text-muted md:block">
                      {i.lastSync}
                    </span>
                    <span className="flex items-center justify-end gap-2">
                      <StatusBadge {...statusMeta[i.status]} dot />
                      <ChevronRightIcon className="h-4 w-4 shrink-0 text-subtle" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
