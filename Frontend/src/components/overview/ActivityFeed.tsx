import type { ActivityItem } from '../../types/portfolio';
import { ProductMark } from '../ui/ProductMark';
import { toneDot } from '../../utils/status';

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <ol className="relative px-4 py-3">
      <span className="absolute bottom-5 left-[23px] top-5 w-px bg-line" aria-hidden />
      {items.map((a) => (
        <li key={a.id} className="relative flex items-start gap-3 py-1.5">
          <span
            className={`relative z-10 mt-1.5 h-2 w-2 shrink-0 rounded-full ring-4 ring-surface ${toneDot[a.tone]}`}
            aria-hidden
          />
          <p className="min-w-0 flex-1 text-sm text-ink">{a.text}</p>
          <ProductMark product={a.product} size="sm" />
          <span className="w-8 shrink-0 text-right text-xs text-subtle">{a.ago}</span>
        </li>
      ))}
    </ol>
  );
}
