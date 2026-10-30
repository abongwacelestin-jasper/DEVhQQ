import type { Release } from '../../types/portfolio';
import { ProductMark } from '../ui/ProductMark';
import { ProgressBar } from '../ui/ProgressBar';

export function ReleasesList({ items }: { items: Release[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-4 py-3">
          <ProductMark product={r.product} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{r.name}</p>
            <p className="truncate text-xs text-muted">
              {r.scope} · {r.due}
            </p>
          </div>
          <div className="w-24 shrink-0">
            <ProgressBar value={(r.done / r.total) * 100} label={`${r.name} readiness`} />
          </div>
          <span className="w-9 shrink-0 text-right font-mono text-xs text-muted">
            {r.done}/{r.total}
          </span>
        </li>
      ))}
    </ul>
  );
}
