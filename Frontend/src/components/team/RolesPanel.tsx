import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon, ShieldCheckIcon, ShieldIcon } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { SearchInput } from '../ui/SearchInput';
import { LevelMeter, PermissionMatrix, areasFromMatrix, rolesFromMatrix } from './PermissionMatrix';
import { roleDetails } from '../../data/team';
import type { ApiPermissionMatrix } from '../../api/types';
import type { Member, RoleName } from '../../types/team';

interface RolesPanelProps {
  members: Member[];
  /** Server-owned role × area matrix. Nothing renders until it arrives. */
  matrix: ApiPermissionMatrix | null;
  onViewMembers: (role: RoleName) => void;
}

const fallbackDetail = {
  description: 'Permissions for this role come from the server’s matrix.',
  dot: 'bg-line-strong',
  productionDefault: false,
};

export function RolesPanel({ members, matrix, onViewMembers }: RolesPanelProps) {
  const roles = useMemo(() => (matrix ? rolesFromMatrix(matrix) : []), [matrix]);
  const [active, setActive] = useState<RoleName>('Developer');
  const [compare, setCompare] = useState(false);
  const [q, setQ] = useState('');

  if (!matrix) {
    return (
      <section className="rounded-lg border border-line bg-white px-4 py-8 text-center">
        <p className="text-[12.5px] text-muted">Loading the server’s permission matrix…</p>
      </section>
    );
  }

  const role = roles.includes(active) ? active : (roles[0] ?? 'Developer');
  const detail = roleDetails[role] ?? fallbackDetail;
  const holders = members.filter((m) => m.role === role);
  const areas = areasFromMatrix(matrix);
  const term = q.trim().toLowerCase();
  const roleHits = roles.filter((r) => !term || r.toLowerCase().includes(term));
  const areaHits = areas.filter(
    (area) => !term || area.toLowerCase().includes(term) || matrix[area][role].includes(term),
  );

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="border-b border-line px-2.5 py-1.5">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Filter roles or permissions…"
            label="Filter roles and permissions"
          />
        </div>
        <div className="grid md:grid-cols-[220px_minmax(0,1fr)]">
          {/* Role list */}
          <nav aria-label="Roles" className="border-b border-line p-1.5 md:border-b-0 md:border-r">
            {roleHits.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-muted">No roles match.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-0.5 md:grid-cols-1">
                {roleHits.map((name) => {
                  const count = members.filter((m) => m.role === name).length;
                  const on = name === role;
                  const d = roleDetails[name] ?? fallbackDetail;
                  return (
                    <li key={name}>
                      <button
                        onClick={() => setActive(name)}
                        aria-current={on ? 'true' : undefined}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors duration-100 ${on ? 'bg-sunken font-semibold text-ink' : 'text-ink hover:bg-sunken/60'}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${d.dot}`} />
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        <span className="text-[11px] tabular-nums text-subtle">{count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>

          {/* Role detail */}
          <div className="min-w-0">
            <header className="flex flex-wrap items-start gap-3 border-b border-line px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <h2 className="text-[13.5px] font-semibold text-ink">{role}</h2>
                <p className="mt-0.5 max-w-xl text-[12px] leading-relaxed text-muted">
                  {detail.description}
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${detail.productionDefault ? 'bg-warn-soft text-warn' : 'bg-sunken text-muted'}`}
              >
                {detail.productionDefault ? (
                  <ShieldIcon className="h-3 w-3" />
                ) : (
                  <ShieldCheckIcon className="h-3 w-3" />
                )}
                {detail.productionDefault ? 'Production by default' : 'No standing production access'}
              </span>
            </header>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_230px]">
              <ul className="divide-y divide-line">
                {areaHits.length === 0 ? (
                  <li className="px-3.5 py-3 text-[12px] text-muted">No permissions match.</li>
                ) : (
                  areaHits.map((area) => (
                    <li key={area} className="flex items-center gap-3 px-3.5 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-ink">{area}</p>
                      </div>
                      <span className="w-28 shrink-0">
                        <LevelMeter level={matrix[area][role]} showLabel />
                      </span>
                    </li>
                  ))
                )}
              </ul>

              <aside className="border-t border-line p-2.5 lg:border-l lg:border-t-0">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[12px] font-semibold text-ink">Members</h3>
                  <span className="text-[11px] tabular-nums text-subtle">{holders.length}</span>
                </div>
                {holders.length === 0 ? (
                  <p className="mt-1.5 text-[12px] text-muted">Nobody in scope holds this role.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {holders.slice(0, 6).map((m) => (
                      <li key={m.id}>
                        <Link
                          to={`/team/${m.id}`}
                          className="flex items-center gap-2 rounded-md px-1 py-1 text-[12px] text-ink hover:bg-sunken"
                        >
                          <Avatar id={m.id} size="xs" />
                          <span className="min-w-0 flex-1 truncate">{m.name}</span>
                          {!m.mfa && (
                            <span className="text-[10px] font-semibold text-bad">No MFA</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {holders.length > 0 && (
                  <button
                    onClick={() => onViewMembers(role)}
                    className="mt-1.5 inline-flex items-center gap-0.5 text-[12px] font-medium text-accent hover:underline"
                  >
                    Open in members <ChevronRightIcon className="h-3 w-3" />
                  </button>
                )}
              </aside>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <button
          onClick={() => setCompare((v) => !v)}
          aria-expanded={compare}
          className="flex w-full items-center gap-2 px-3.5 py-2 text-left"
        >
          <ChevronRightIcon
            className={`h-3.5 w-3.5 text-subtle transition-transform duration-150 ${compare ? 'rotate-90' : ''}`}
          />
          <span className="text-[12.5px] font-semibold text-ink">Compare all roles</span>
          <span className="truncate text-[12px] text-muted">
            · permissions are scoped per assigned product
          </span>
        </button>
        {compare && (
          <div className="border-t border-line">
            <PermissionMatrix matrix={matrix} highlight={role} />
          </div>
        )}
      </section>
    </div>
  );
}
