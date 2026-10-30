import { LockIcon } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { areaDot, fingerprint, type AuditRow } from '../../utils/audit';
import { memberById } from '../../utils/status';

interface AuditTableProps {
  rows: AuditRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const th =
  'h-8 whitespace-nowrap px-3 text-left text-[10.5px] font-semibold uppercase tracking-wide text-subtle';
const td = 'h-9 whitespace-nowrap px-3 align-middle';

/** Strict one-line-per-event ledger: each attribute in its own column, uniform row height. */
export function AuditTable({ rows, selectedId, onSelect }: AuditTableProps) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[1080px] border-collapse text-[12px]">
        <thead className="border-b border-line bg-sunken/60">
          <tr>
            <th className={`${th} w-[132px]`}>Time</th>
            <th className={`${th} w-[170px]`}>Actor</th>
            <th className={th}>Action</th>
            <th className={th}>Target</th>
            <th className={`${th} w-[132px]`}>Area</th>
            <th className={`${th} w-[96px]`}>Source</th>
            <th className={`${th} w-[104px]`}>Sensitivity</th>
            <th className={`${th} w-[150px]`}>Fingerprint</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((e) => {
            const on = e.id === selectedId;
            return (
              <tr
                key={e.id}
                tabIndex={0}
                onClick={() => onSelect(e.id)}
                onKeyDown={(k) =>
                  (k.key === 'Enter' || k.key === ' ') && (k.preventDefault(), onSelect(e.id))
                }
                aria-selected={on}
                className={`cursor-pointer outline-none transition-colors duration-100 focus-visible:bg-accent-soft/40 ${on ? 'bg-accent-soft/50' : 'hover:bg-sunken/40'}`}
              >
                <td className={`${td} font-mono text-[11.5px] tabular-nums text-muted`}>
                  {e.when}
                </td>
                <td className={td}>
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar id={e.actor} size="xs" />
                    <span className="truncate font-medium text-ink">
                      {memberById(e.actor).name}
                    </span>
                  </span>
                </td>
                <td className={`${td} max-w-0 truncate font-medium text-ink`} title={e.action}>
                  {e.action}
                </td>
                <td className={`${td} max-w-0 truncate text-muted`} title={e.target}>
                  {e.target}
                </td>
                <td className={td}>
                  <span className="inline-flex items-center gap-1.5 text-ink">
                    <span className={`h-1.5 w-1.5 rounded-full ${areaDot[e.area]}`} aria-hidden />{' '}
                    {e.area}
                  </span>
                </td>
                <td className={`${td} text-muted`}>
                  {e.source === 'session' ? 'Session' : 'Workspace'}
                </td>
                <td className={td}>
                  {e.sensitive ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-warn/25 bg-warn-soft px-1.5 py-px text-[10.5px] font-medium text-warn">
                      <LockIcon className="h-2.5 w-2.5" /> Sensitive
                    </span>
                  ) : (
                    <span className="text-[11px] text-subtle">Standard</span>
                  )}
                </td>
                <td className={`${td} font-mono text-[11px] text-subtle`}>
                  {fingerprint(e).slice(0, 12)}…
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
