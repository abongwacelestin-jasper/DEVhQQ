import { Link } from 'react-router-dom';
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { ProductMark } from '../ui/ProductMark';
import { MemberRowMenu } from './MemberRowMenu';
import { MfaBadge, ProdBadge, RoleBadge, StatusBadge, WorkloadMeter } from './MemberBadges';
import type { MemberAction } from './useMemberActions';
import type { SortKey, useMembersTable } from './useMembersTable';
import type { Member } from '../../types/team';

interface MembersDataTableProps {
  t: ReturnType<typeof useMembersTable>;
  leadIds: Set<string>;
  actionsFor: (m: Member) => MemberAction[];
}

const th =
  'h-8 whitespace-nowrap px-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-subtle';
const td = 'h-9 whitespace-nowrap px-2.5 align-middle';

/**
 * Strict columnar table: every attribute in its own column, one line per row, uniform 36px
 * row height. Scrolls horizontally on narrow screens rather than stacking.
 */
export function MembersDataTable({ t, leadIds, actionsFor }: MembersDataTableProps) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[1040px] border-collapse text-[12px]">
        <thead className="border-b border-line bg-sunken/60">
          <tr>
            <th className="h-8 w-9 pl-3 pr-1">
              <input
                type="checkbox"
                checked={t.allSelected}
                onChange={t.toggleAll}
                aria-label="Select all"
                className="h-3.5 w-3.5 align-middle accent-[rgb(var(--c-accent))]"
              />
            </th>
            <SortTh label="Member" k="name" t={t} className="w-[19%]" />
            <th className={`${th} w-[19%]`}>Email</th>
            <SortTh label="Role" k="role" t={t} />
            <th className={th}>Status</th>
            <th className={th}>MFA</th>
            <th className={th}>Production</th>
            <th className={th}>Products</th>
            <SortTh label="Workload" k="load" t={t} />
            <SortTh label="Last active" k="lastActive" t={t} />
            <th className={`${th} w-[124px] text-right`}>Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {t.rows.map((m) => {
            const checked = t.selected.has(m.id);
            const actions = actionsFor(m);
            return (
              <tr
                key={m.id}
                className={`group transition-colors duration-100 ${checked ? 'bg-accent-soft/40' : 'hover:bg-sunken/40'}`}
              >
                <td className="h-9 w-9 pl-3 pr-1 align-middle">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => t.toggle(m.id)}
                    aria-label={`Select ${m.name}`}
                    className="h-3.5 w-3.5 align-middle accent-[rgb(var(--c-accent))]"
                  />
                </td>
                <td className={td}>
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar id={m.id} size="xs" />
                    <Link
                      to={`/team/${m.id}`}
                      className="truncate font-semibold text-ink hover:underline"
                    >
                      {m.name}
                    </Link>
                    {leadIds.has(m.id) && (
                      <span className="shrink-0 rounded border border-accent/30 px-1 text-[9.5px] font-semibold text-accent">
                        Lead
                      </span>
                    )}
                  </span>
                </td>
                <td className={`${td} max-w-0 truncate text-muted`} title={m.email}>
                  {m.email}
                </td>
                <td className={td}>
                  <RoleBadge m={m} />
                </td>
                <td className={td}>
                  <StatusBadge m={m} />
                </td>
                <td className={td}>
                  <MfaBadge m={m} />
                </td>
                <td className={td}>
                  <ProdBadge m={m} />
                </td>
                <td className={td}>
                  <span className="flex -space-x-1">
                    {m.products.map((p) => (
                      <span key={p} className="rounded-md ring-2 ring-white">
                        <ProductMark product={p} size="sm" />
                      </span>
                    ))}
                  </span>
                </td>
                <td className={td}>
                  <WorkloadMeter m={m} />
                </td>
                <td className={`${td} tabular-nums text-muted`}>{m.lastActive}</td>
                <td className={`${td} text-right`}>
                  <span className="inline-flex items-center justify-end gap-0.5">
                    <span className="hidden items-center gap-0.5 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100 md:inline-flex [@media(hover:none)]:opacity-100">
                      {actions.map((a) => (
                        <button
                          key={a.label}
                          onClick={a.onClick}
                          aria-label={`${a.label} — ${m.name}`}
                          title={a.label}
                          className={`grid h-6 w-6 place-items-center rounded-md transition-colors duration-100 ${a.danger ? 'text-bad hover:bg-bad-soft' : 'text-muted hover:bg-white hover:text-ink hover:shadow-sm'}`}
                        >
                          <a.icon className="h-3.5 w-3.5" />
                        </button>
                      ))}
                    </span>
                    <span className="md:hidden">
                      <MemberRowMenu
                        label={`Actions for ${m.name}`}
                        items={actions.map((a) => ({
                          label: a.label,
                          onSelect: a.onClick,
                          danger: a.danger,
                        }))}
                      />
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortTh({
  label,
  k,
  t,
  className = '',
}: {
  label: string;
  k: SortKey;
  t: ReturnType<typeof useMembersTable>;
  className?: string;
}) {
  const active = t.sort.key === k;
  const Icon = t.sort.dir === 1 ? ArrowUpIcon : ArrowDownIcon;
  return (
    <th
      className={`${th} ${className}`}
      aria-sort={active ? (t.sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <button
        onClick={() => t.toggleSort(k)}
        className={`inline-flex items-center gap-1 uppercase hover:text-ink ${active ? 'text-ink' : ''}`}
      >
        {label}
        {active && <Icon className="h-3 w-3" />}
      </button>
    </th>
  );
}
