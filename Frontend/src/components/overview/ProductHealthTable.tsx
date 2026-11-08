import { useNavigate } from 'react-router-dom';
import { ProductMark } from '../ui/ProductMark';
import { StatusBadge } from '../ui/StatusBadge';
import { Skeleton } from '../ui/Skeleton';
import { healthMeta, deployMeta } from '../../utils/status';
import type { ProductRow } from '../../hooks/useOverviewData';

export function ProductHealthTable({
  rows,
  loading = false,
}: {
  rows: ProductRow[];
  loading?: boolean;
}) {
  const navigate = useNavigate();

  if (rows.length === 0 && loading) {
    // Holds about the space three product rows take, so the panels below don't jump
    // down when the data arrives.
    return (
      <div aria-hidden className="space-y-3 px-3.5 py-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-[38px] items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-md" />
            <Skeleton className="h-2.5 w-40" />
            <Skeleton className="ml-auto h-2.5 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="px-3.5 py-6 text-center text-[12px] text-muted">No products available.</p>;
  }

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] text-muted">
              <th className="px-3 py-1.5 font-medium">Product</th>
              <th className="px-2.5 py-1.5 font-medium">Health</th>
              <th className="px-2.5 py-1.5 font-medium">Tasks</th>
              <th className="px-2.5 py-1.5 font-medium">Projects</th>
              <th className="px-2.5 py-1.5 font-medium">People</th>
              <th className="px-2.5 py-1.5 font-medium">Incidents</th>
              <th className="px-3 py-1.5 font-medium">Last deploy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const h = healthMeta[p.health];
              return (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/products/${p.id}`)}
                  className="cursor-pointer border-b border-line align-top transition-colors duration-150 last:border-0 hover:bg-sunken/50"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <ProductMark product={p.id} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{p.name}</p>
                        <p className="truncate text-[11px] text-muted">{p.reasons[0]}</p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2">
                    <StatusBadge tone={h.tone} label={h.label} dot />
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 tabular-nums text-ink">
                    {p.openTasks}
                    <span className={p.lateTasks ? 'text-warn' : 'text-muted'}>
                      {' '}
                      · {p.lateTasks} late
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 tabular-nums text-ink">
                    {p.projects}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 tabular-nums text-ink">
                    {p.members}
                  </td>
                  <td
                    className={`whitespace-nowrap px-2.5 py-2 tabular-nums ${p.openIncidents ? 'font-semibold text-bad' : 'text-muted'}`}
                  >
                    {p.openIncidents}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {p.lastDeploy ? (
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-ink">{p.lastDeploy.sha}</span>
                        <StatusBadge {...deployMeta[p.lastDeploy.status]} dot />
                        <span className="text-[11px] text-muted">{p.lastDeploy.ago}</span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted">None recorded</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line md:hidden">
        {rows.map((p) => {
          const h = healthMeta[p.health];
          return (
            <li key={p.id}>
              <button
                onClick={() => navigate(`/products/${p.id}`)}
                className="w-full px-3.5 py-2.5 text-left"
              >
                <div className="flex items-center gap-2">
                  <ProductMark product={p.id} size="sm" />
                  <p className="flex-1 truncate text-[12.5px] font-semibold text-ink">{p.name}</p>
                  <StatusBadge tone={h.tone} label={h.label} dot />
                </div>
                <p className="mt-1 truncate text-[11.5px] text-muted">{p.reasons[0]}</p>
                <div className="mt-1.5 flex items-center gap-3 text-[11.5px] text-muted">
                  <span>{p.openTasks} tasks</span>
                  <span className={p.lateTasks ? 'text-warn' : ''}>{p.lateTasks} late</span>
                  <span>{p.projects} projects</span>
                  <span className={p.openIncidents ? 'text-bad' : ''}>
                    {p.openIncidents} incidents
                  </span>
                  <span className="ml-auto font-mono">{p.lastDeploy?.sha ?? '—'}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
