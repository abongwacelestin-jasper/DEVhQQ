import React from 'react';

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-sunken p-0.5 scroll-thin ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-[3px] text-[12px] font-medium transition-colors duration-150 ${
              active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {o.icon}
            {o.label}
            {o.count !== undefined && (
              <span
                className={`rounded px-1 text-[11px] tabular-nums ${active ? 'bg-sunken text-muted' : 'text-subtle'}`}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
