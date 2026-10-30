import { useNavigate } from 'react-router-dom';
import type { Product } from '../../types/portfolio';
import { ProductMark } from '../ui/ProductMark';
import { StatusBadge } from '../ui/StatusBadge';
import { ProgressBar } from '../ui/ProgressBar';
import { healthMeta } from '../../utils/status';

export function ProductHealthTable({ rows }: { rows: Product[] }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-subtle">
              <th className="px-4 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Health</th>
              <th className="px-3 py-2 font-medium">Tasks</th>
              <th className="px-3 py-2 font-medium">PRs</th>
              <th className="px-3 py-2 font-medium">Production</th>
              <th className="px-4 py-2 font-medium">Next milestone</th>
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
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <ProductMark product={p.id} size="md" />
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{p.name}</p>
                        <p className="truncate text-xs text-subtle">
                          {p.activeProjects} projects · {p.memberCount} people
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={h.tone} label={h.label} dot />
                    <p className="mt-1 max-w-[220px] text-xs leading-snug text-muted">
                      {p.healthReasons[0]}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums text-ink">
                    {p.openTasks}
                    <span className={p.lateTasks ? 'text-warn' : 'text-subtle'}>
                      {' '}
                      · {p.lateTasks} late
                    </span>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">{p.openPrs}</td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span className="font-mono text-xs text-ink">{p.lastDeploy.sha}</span>
                    <p className="text-xs text-subtle">{p.lastDeploy.ago}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate text-ink">{p.milestone.name}</span>
                      <span className="tabular-nums text-muted">{p.milestone.progress}%</span>
                    </div>
                    <ProgressBar
                      className="mt-1.5"
                      value={p.milestone.progress}
                      tone={h.tone === 'ok' ? 'accent' : h.tone}
                      label={`${p.milestone.name} progress`}
                    />
                    <p className="mt-1 text-[11px] text-subtle">Due {p.milestone.due}</p>
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
                className="w-full px-4 py-3.5 text-left"
              >
                <div className="flex items-center gap-2.5">
                  <ProductMark product={p.id} size="md" />
                  <p className="flex-1 font-semibold text-ink">{p.name}</p>
                  <StatusBadge tone={h.tone} label={h.label} dot />
                </div>
                <p className="mt-2 text-xs text-muted">{p.healthReasons[0]}</p>
                <div className="mt-2.5 flex items-center gap-3 text-xs text-muted">
                  <span>{p.openTasks} tasks</span>
                  <span className={p.lateTasks ? 'text-warn' : ''}>{p.lateTasks} late</span>
                  <span>{p.openPrs} PRs</span>
                  <span className="ml-auto font-mono">{p.lastDeploy.sha}</span>
                </div>
                <ProgressBar
                  className="mt-2.5"
                  value={p.milestone.progress}
                  tone={h.tone === 'ok' ? 'accent' : h.tone}
                  label={`${p.milestone.name} progress`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
