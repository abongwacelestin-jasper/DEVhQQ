import React from 'react';
import { ArrowDownRightIcon, ArrowUpRightIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  delta?: { label: string; good: boolean; up: boolean };
  source: string;
  children?: React.ReactNode;
  size?: 'compact' | 'large';
  className?: string;
}

/** Small analytics card: a number, an optional change, a tiny chart and where the data comes from. */
export function MetricCard({
  label,
  value,
  unit,
  delta,
  source,
  children,
  size = 'compact',
  className = '',
}: MetricCardProps) {
  return (
    <section
      className={`flex min-w-0 flex-col rounded-lg border border-line bg-white px-3 py-2.5 ${className}`}
      aria-label={label}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="truncate text-[11.5px] font-semibold text-ink">{label}</h3>
        <span className="shrink-0 truncate text-[10.5px] text-muted">From {source}</span>
      </header>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span
          className={`font-semibold tabular-nums tracking-tight text-ink ${size === 'large' ? 'text-[22px]' : 'text-[18px]'}`}
        >
          {value}
        </span>
        {unit && <span className="text-[11.5px] text-muted">{unit}</span>}
        {delta && (
          <span
            className={`ml-auto inline-flex items-center gap-0.5 text-[11px] font-semibold ${delta.good ? 'text-ok' : 'text-bad'}`}
          >
            {delta.up ? (
              <ArrowUpRightIcon className="h-3 w-3" />
            ) : (
              <ArrowDownRightIcon className="h-3 w-3" />
            )}
            {delta.label}
          </span>
        )}
      </div>
      {children && (
        <div className={`mt-1.5 ${size === 'large' ? 'min-h-[88px]' : ''}`}>{children}</div>
      )}
    </section>
  );
}
