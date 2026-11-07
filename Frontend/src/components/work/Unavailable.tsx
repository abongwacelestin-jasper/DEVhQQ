import React from 'react';
import { CloudOffIcon, FlaskConicalIcon, RotateCcwIcon } from 'lucide-react';

interface UnavailableProps {
  title: string;
  /** What the operator needs to do, in one sentence. */
  detail?: string;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/** Designed state for a backend module that isn't deployed (404) or configured (503). */
export function Unavailable({
  title,
  detail,
  onRetry,
  compact = false,
  className = '',
  children,
}: UnavailableProps) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center text-center ${compact ? 'px-3 py-4' : 'px-6 py-10'} ${className}`}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sunken text-muted">
        <CloudOffIcon className="h-4 w-4" aria-hidden />
      </span>
      <p className="mt-2 text-[13px] font-semibold text-ink">{title}</p>
      {detail && <p className="mt-0.5 max-w-sm text-[12px] text-muted">{detail}</p>}
      {children}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2.5 inline-flex h-7 items-center gap-1 rounded-md border border-line bg-white px-2.5 text-[12px] font-medium text-ink hover:bg-sunken"
        >
          <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden /> Try again
        </button>
      )}
    </div>
  );
}

/** Marks content that came from a `source:'demo'` payload so it is never mistaken for live data. */
export function DemoBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="Demo data from a non-production fallback — not live"
      className={`inline-flex items-center gap-1 rounded bg-warn-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-warn ${className}`}
    >
      <FlaskConicalIcon className="h-3 w-3" aria-hidden /> Demo data
    </span>
  );
}
