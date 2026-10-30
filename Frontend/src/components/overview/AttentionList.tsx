import { Link } from 'react-router-dom';
import { ChevronRightIcon } from 'lucide-react';
import type { AttentionItem } from '../../types/portfolio';
import { toneDot, toneText } from '../../utils/status';
import { EmptyIllustration } from '../illustrations/EmptyIllustration';

export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 py-6 text-center">
        <EmptyIllustration className="h-20 w-auto" />
        <p className="mt-2 text-[12.5px] font-medium text-ink">Nothing needs you right now</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => (
        <li key={a.id}>
          <Link
            to={a.to}
            className="group flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-sunken/50"
          >
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${toneDot[a.tone]}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{a.title}</p>
              <p className="truncate text-xs text-muted">{a.detail}</p>
            </div>
            <span className={`shrink-0 text-xs ${a.tone === 'bad' ? toneText.bad : 'text-muted'}`}>
              {a.meta}
            </span>
            <ChevronRightIcon className="mt-0.5 h-4 w-4 shrink-0 text-line-strong transition-colors duration-150 group-hover:text-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
