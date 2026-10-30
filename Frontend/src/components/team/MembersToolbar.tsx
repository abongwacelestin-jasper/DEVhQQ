import {
  DownloadIcon,
  LayoutGridIcon,
  Rows3Icon,
  SearchIcon,
  ShieldAlertIcon,
  XIcon,
} from 'lucide-react';
import { MultiSelect } from '../ui/MultiSelect';
import { flagTest, type SecurityFlag, type useMembersTable } from './useMembersTable';
import { roleDetails } from '../../data/team';
import type { Member, RoleName } from '../../types/team';

export type MembersView = 'cards' | 'table';

interface MembersToolbarProps {
  t: ReturnType<typeof useMembersTable>;
  members: Member[];
  view: MembersView;
  onView: (v: MembersView) => void;
  onExport: () => void;
  picked: Member[];
  onBulkDeactivate: () => void;
}

const roleNames = Object.keys(roleDetails) as RoleName[];
export const flagLabels: Record<SecurityFlag, string> = {
  'no-mfa': 'Without MFA',
  mfa: 'MFA enabled',
  prod: 'Production access',
  overloaded: 'Over capacity',
};

/**
 * Control bar that spans the full width: the search grows to fill every spare pixel, filters
 * sit at equal height beside it, and view/export controls anchor the right edge.
 */
export function MembersToolbar({
  t,
  members,
  view,
  onView,
  onExport,
  picked,
  onBulkDeactivate,
}: MembersToolbarProps) {
  if (picked.length) {
    return (
      <div className="flex h-11 items-center gap-1.5 border-b border-line bg-accent-soft/40 px-2.5">
        <span className="text-[12px] font-semibold text-ink">{picked.length} selected</span>
        <span className="mx-1 h-4 w-px bg-line-strong" />
        <button
          onClick={onExport}
          className="h-8 rounded-md px-2.5 text-[12px] font-medium text-ink hover:bg-white"
        >
          Export
        </button>
        <button
          onClick={onBulkDeactivate}
          className="h-8 rounded-md px-2.5 text-[12px] font-medium text-bad hover:bg-bad-soft"
        >
          Deactivate
        </button>
        <button
          onClick={t.clearSelection}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[12px] text-muted hover:bg-white hover:text-ink"
        >
          <XIcon className="h-3.5 w-3.5" /> Clear
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2.5 py-2">
      <label className="relative order-1 block min-w-0 basis-full sm:basis-[260px] sm:flex-1">
        <span className="sr-only">Search members</span>
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
        <input
          value={t.q}
          onChange={(e) => t.setQ(e.target.value)}
          placeholder="Search by name, email or role"
          className="h-8 w-full rounded-md border border-line bg-white pl-8 pr-8 text-[12.5px] text-ink outline-none transition-colors duration-150 placeholder:text-subtle focus:border-accent"
        />

        {t.q && (
          <button
            onClick={() => t.setQ('')}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-subtle hover:bg-sunken hover:text-ink"
          >
            <XIcon className="h-3 w-3" />
          </button>
        )}
      </label>

      <div className="order-2 grid flex-1 grid-cols-2 gap-1.5 sm:flex-none sm:grid-cols-[repeat(4,minmax(112px,auto))]">
        <MultiSelect<RoleName>
          className="h-8"
          label="Role"
          value={t.roles}
          onChange={t.setRoles}
          options={roleNames.map((r) => ({
            value: r,
            label: r,
            dot: roleDetails[r].dot,
            count: members.filter((m) => m.role === r).length,
          }))}
        />
        <MultiSelect<Member['status']>
          className="h-8"
          label="Status"
          value={t.statuses}
          onChange={t.setStatuses}
          options={(['active', 'invited', 'deactivated'] as const).map((s) => ({
            value: s,
            label: s[0].toUpperCase() + s.slice(1),
            dot: s === 'active' ? 'bg-ok' : s === 'invited' ? 'bg-info' : 'bg-subtle',
            count: members.filter((m) => m.status === s).length,
          }))}
        />

        <MultiSelect<SecurityFlag>
          className="h-8"
          label="Security"
          value={t.flags}
          onChange={t.setFlags}
          options={(['no-mfa', 'mfa', 'overloaded'] as SecurityFlag[]).map((f) => ({
            value: f,
            label: flagLabels[f],
            dot: f === 'mfa' ? 'bg-ok' : f === 'prod' ? 'bg-warn' : 'bg-bad',
            count: members.filter(flagTest[f]).length,
          }))}
        />
        <button
          onClick={() => t.setAttention(!t.attention)}
          aria-pressed={t.attention}
          className={`inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[12px] font-medium transition-colors duration-150 ${t.attention ? 'border-warn/40 bg-warn-soft text-warn' : 'border-line bg-white text-ink hover:border-line-strong'}`}
        >
          <ShieldAlertIcon className="h-3.5 w-3.5" /> Attention
        </button>
      </div>

      <div className="order-3 flex items-center gap-1.5">
        {t.activeFilters > 0 && (
          <button
            onClick={t.resetFilters}
            className="h-8 rounded-md px-2 text-[12px] font-medium text-accent hover:bg-accent-soft/50"
          >
            Reset
          </button>
        )}
        <span className="hidden whitespace-nowrap px-1 text-[11.5px] tabular-nums text-muted md:inline">
          {t.rows.length} of {members.length}
        </span>
        <div
          role="radiogroup"
          aria-label="Layout"
          className="inline-flex h-8 rounded-md border border-line bg-sunken/50 p-0.5"
        >
          {(
            [
              { v: 'cards', icon: LayoutGridIcon, label: 'Cards' },
              { v: 'table', icon: Rows3Icon, label: 'Table' },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              role="radio"
              aria-checked={view === o.v}
              onClick={() => onView(o.v)}
              title={o.label}
              className={`inline-flex items-center gap-1 rounded px-2 text-[12px] font-medium transition-colors duration-150 ${view === o.v ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              <o.icon className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">{o.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onExport}
          aria-label="Export CSV"
          title="Export CSV"
          className="grid h-8 w-8 place-items-center rounded-md border border-line bg-white text-muted hover:border-line-strong hover:text-ink"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
