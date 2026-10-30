import { Link } from 'react-router-dom';
import { ClockIcon } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { ProductMark } from '../ui/ProductMark';
import { MemberRowMenu } from './MemberRowMenu';
import { MfaBadge, ProdBadge, RoleBadge, StatusBadge, WorkloadMeter } from './MemberBadges';
import type { MemberAction } from './useMemberActions';
import type { useMembersTable } from './useMembersTable';
import { productById } from '../../utils/status';
import type { Member } from '../../types/team';

interface MemberCardsProps {
  t: ReturnType<typeof useMembersTable>;
  leadIds: Set<string>;
  actionsFor: (m: Member) => MemberAction[];
}

/** Default people view: compact profile cards on a shared grid so every row aligns. */
export function MemberCards({ t, leadIds, actionsFor }: MemberCardsProps) {
  return (
    <ul className="grid gap-2.5 p-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {t.rows.map((m) => {
        const checked = t.selected.has(m.id);
        const actions = actionsFor(m);
        return (
          <li
            key={m.id}
            className={`group grid grid-rows-[auto_auto_1fr_auto] rounded-lg border bg-white transition-colors duration-150 ${checked ? 'border-accent/50 ring-1 ring-accent/30' : 'border-line hover:border-line-strong'}`}
          >
            {/* Identity */}
            <div className="flex items-start gap-2.5 px-3 pt-3">
              <span className="relative shrink-0">
                <Avatar id={m.id} size="md" />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${m.status === 'active' ? (m.lastActive === 'Now' ? 'bg-ok' : 'bg-line-strong') : m.status === 'invited' ? 'bg-info' : 'bg-subtle'}`}
                  aria-hidden
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-1.5">
                  <Link
                    to={`/team/${m.id}`}
                    className="truncate text-[13px] font-semibold leading-5 text-ink hover:underline"
                  >
                    {m.name}
                  </Link>
                  {leadIds.has(m.id) && (
                    <span className="shrink-0 rounded border border-accent/30 px-1 text-[9.5px] font-semibold text-accent">
                      Lead
                    </span>
                  )}
                </p>
                <p className="truncate text-[11.5px] leading-4 text-muted">{m.email}</p>
              </div>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => t.toggle(m.id)}
                aria-label={`Select ${m.name}`}
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 accent-[rgb(var(--c-accent))] transition-opacity duration-100 ${checked || t.selected.size ? 'opacity-100' : 'opacity-0 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100'}`}
              />
            </div>

            {/* Badges — one line */}
            <div className="mt-2.5 flex min-w-0 items-center gap-1 overflow-hidden px-3">
              <RoleBadge m={m} />
              {m.status !== 'active' && <StatusBadge m={m} />}
            </div>

            {/* Attribute grid — fixed label/value columns so every card lines up */}
            <dl className="mx-3 mt-2.5 grid grid-cols-2 gap-px self-start overflow-hidden rounded-md border border-line bg-line text-[11px]">
              <div className="flex h-8 items-center justify-between gap-2 bg-white px-2">
                <dt className="text-subtle">MFA</dt>
                <dd>
                  <MfaBadge m={m} />
                </dd>
              </div>
              <div className="flex h-8 items-center justify-between gap-2 bg-white px-2">
                <dt className="text-subtle">Prod</dt>
                <dd>
                  <ProdBadge m={m} />
                </dd>
              </div>
              <div className="col-span-2 flex h-8 items-center gap-3 bg-white px-2">
                <dt className="shrink-0 text-subtle">Load</dt>
                <dd className="min-w-0 flex-1">
                  <WorkloadMeter m={m} wide />
                </dd>
              </div>
            </dl>

            {/* Footer pinned to the bottom edge */}
            <div className="mt-2.5 flex h-9 items-center gap-2 border-t border-line px-3">
              <span className="flex -space-x-1">
                {m.products.map((p) => (
                  <span
                    key={p}
                    className="rounded-md ring-2 ring-white"
                    title={productById(p).name}
                  >
                    <ProductMark product={p} size="sm" />
                  </span>
                ))}
              </span>
              <span className="ml-1 inline-flex min-w-0 items-center gap-1 text-[11px] tabular-nums text-muted">
                <ClockIcon className="h-3 w-3 shrink-0" />{' '}
                <span className="truncate">{m.lastActive}</span>
              </span>
              <span className="ml-auto flex items-center gap-0.5">
                <span className="hidden items-center gap-0.5 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100 md:flex [@media(hover:none)]:opacity-100">
                  {actions.map((a) => (
                    <button
                      key={a.label}
                      onClick={a.onClick}
                      aria-label={`${a.label} — ${m.name}`}
                      title={a.label}
                      className={`grid h-6 w-6 place-items-center rounded-md transition-colors duration-100 ${a.danger ? 'text-bad hover:bg-bad-soft' : 'text-muted hover:bg-sunken hover:text-ink'}`}
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
            </div>
          </li>
        );
      })}
    </ul>
  );
}
