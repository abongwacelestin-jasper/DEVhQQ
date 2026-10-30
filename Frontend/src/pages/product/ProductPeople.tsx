import { Link } from 'react-router-dom';
import { KeyRoundIcon, ShieldAlertIcon } from 'lucide-react';
import { Panel } from '../../components/ui/Panel';
import { Avatar } from '../../components/ui/Avatar';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useWork } from '../../contexts/WorkContext';
import { useProductTab, textMatch } from '../../hooks/useProductTab';
import { members } from '../../data/team';

export function ProductPeople() {
  const { product, filters } = useProductTab();
  const { tasks } = useWork();
  const team = members.filter(
    (m) =>
      m.status === 'active' &&
      m.products.includes(product.id) &&
      textMatch(filters.q, m.name, m.role) &&
      (!filters.person || m.id === filters.person),
  );

  return (
    <Panel title="People with access" meta={<span className="tabular-nums">{team.length}</span>}>
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[680px] text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-sunken/40 text-left text-[11.5px] text-muted">
              <th className="px-3.5 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="w-[180px] px-3 py-2 font-medium">Load in {product.name}</th>
              <th className="px-3 py-2 text-center font-medium">Overdue</th>
              <th className="px-3 py-2 font-medium">Access</th>
              <th className="px-3 py-2 text-right font-medium">Last active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {team.map((m) => {
              const open = tasks.filter(
                (t) => t.product === product.id && t.assignee === m.id && t.status !== 'done',
              );
              const load = open.reduce((s, t) => s + t.estimate, 0);
              const pct = Math.min(100, (load / m.capacity) * 100);
              return (
                <tr key={m.id} className="hover:bg-sunken/40">
                  <td className="px-3.5 py-1.5">
                    <Link
                      to={`/team/${m.id}`}
                      className="flex items-center gap-2 font-semibold text-ink hover:underline"
                    >
                      <Avatar id={m.id} size="sm" />
                      {m.name}
                      {m.id === product.lead && <StatusBadge tone="accent" label="Lead" />}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-ink">{m.role}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                        <span
                          className={`block h-full rounded-full ${pct >= 100 ? 'bg-bad' : pct >= 80 ? 'bg-warn' : 'bg-ok'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="w-12 text-right tabular-nums text-ink">
                        {load}/{m.capacity}
                      </span>
                    </span>
                  </td>
                  <td
                    className={`px-3 py-1.5 text-center tabular-nums ${open.some((t) => t.overdue) ? 'font-semibold text-bad' : 'text-muted'}`}
                  >
                    {open.filter((t) => t.overdue).length}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-1.5">
                      {m.productionAccess && <StatusBadge tone="warn" label="Production" />}
                      {m.mfa ? (
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-ok">
                          <KeyRoundIcon className="h-3 w-3" />
                          MFA
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-bad">
                          <ShieldAlertIcon className="h-3 w-3" />
                          No MFA
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted">{m.lastActive}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
