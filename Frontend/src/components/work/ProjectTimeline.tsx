import { Link } from 'react-router-dom';
import type { Project } from '../../types/work';
import type { Tone } from '../../types/portfolio';
import { ProductMark } from '../ui/ProductMark';
import { timelineWeeks, todayWeek } from '../../data/work';
import { projectStatusMeta } from '../../utils/status';

const barTone: Record<Tone, string> = {
  ok: 'bg-accent-soft border-accent/30 text-accent-ink',
  warn: 'bg-warn-soft border-warn/30 text-warn',
  bad: 'bg-bad-soft border-bad/30 text-bad',
  neutral: 'bg-sunken border-line-strong text-muted',
  info: 'bg-info-soft border-info/30 text-info',
  accent: 'bg-accent-soft border-accent/30 text-accent-ink',
};

function Diamond({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <path d="M7 1l6 6-6 6-6-6z" fill="#15171C" stroke="#FFFFFF" strokeWidth="1.5" />
    </svg>
  );
}

export function ProjectTimeline({ items }: { items: Project[] }) {
  const n = timelineWeeks.length;
  const pct = (w: number) => `${(w / n) * 100}%`;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="overflow-x-auto scroll-thin">
        <div className="relative min-w-[960px]">
          <div className="flex border-b border-line">
            <div className="w-56 shrink-0 px-4 py-2.5 text-xs font-medium text-subtle">Project</div>
            <div className="flex flex-1">
              {timelineWeeks.map((w) => (
                <div
                  key={w}
                  className="flex-1 border-l border-line px-2 py-2.5 text-[11px] text-subtle"
                >
                  {w}
                </div>
              ))}
            </div>
          </div>

          {items.map((p) => {
            const meta = projectStatusMeta[p.status];
            return (
              <div key={p.id} className="flex border-b border-line last:border-0">
                <div className="flex w-56 shrink-0 items-center gap-2.5 px-4 py-3.5">
                  <ProductMark product={p.product} size="sm" />
                  <div className="min-w-0">
                    <Link
                      to={`/projects/${p.id}`}
                      className="block truncate text-sm font-medium text-ink hover:underline"
                    >
                      {p.name}
                    </Link>
                    <p className="text-[11px] text-subtle">
                      {p.done}/{p.total} tasks · {meta.label}
                    </p>
                  </div>
                </div>
                <div className="relative flex-1">
                  <div className="absolute inset-0 flex" aria-hidden>
                    {timelineWeeks.map((w) => (
                      <div key={w} className="flex-1 border-l border-line/60" />
                    ))}
                  </div>
                  <div
                    className={`absolute top-[30%] flex h-7 -translate-y-1/2 items-center overflow-hidden rounded-md border px-2 text-[11px] font-medium ${barTone[meta.tone]}`}
                    style={{ left: pct(p.startWeek), width: pct(p.endWeek - p.startWeek) }}
                  >
                    <span
                      className="absolute inset-y-0 left-0 bg-current opacity-[0.12]"
                      style={{ width: `${(p.done / p.total) * 100}%` }}
                      aria-hidden
                    />
                    <span className="relative truncate">
                      {Math.round((p.done / p.total) * 100)}% complete
                    </span>
                  </div>
                  <div
                    className="absolute bottom-1.5 z-10 flex -translate-x-1/2 items-center gap-1"
                    style={{ left: pct(p.milestone.week) }}
                    title={`Milestone ${p.milestone.name}`}
                  >
                    <Diamond size={11} />
                    <span className="whitespace-nowrap text-[10px] font-medium text-muted">
                      {p.milestone.name}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          <div
            className="pointer-events-none absolute bottom-0 top-0 z-20"
            style={{ left: `calc(14rem + (100% - 14rem) * ${todayWeek / n})` }}
            aria-hidden
          >
            <span className="absolute top-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-bad px-1.5 py-0.5 text-[10px] font-semibold text-white">
              Today
            </span>
            <span className="absolute bottom-0 top-7 w-px bg-bad/60" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 border-t border-line px-4 py-2.5 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <Diamond size={10} /> Milestone
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-accent-soft ring-1 ring-accent/30" />
          On track
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-warn-soft ring-1 ring-warn/30" />
          At risk
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-bad-soft ring-1 ring-bad/30" />
          Blocked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-sunken ring-1 ring-line-strong" />
          Planned
        </span>
      </div>
    </div>
  );
}
