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
  /** Equal-width tabs spanning the container; labels truncate instead of overflowing. */
  fill?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
  fill = false,
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`${fill ? 'grid w-full auto-cols-fr grid-flow-col' : 'inline-flex max-w-full overflow-x-auto scroll-thin'} items-center gap-0.5 rounded-lg border border-line bg-sunken p-0.5 ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            title={fill ? o.label : undefined}
            className={`inline-flex items-center whitespace-nowrap rounded-md py-[3px] text-[12px] font-medium transition-colors duration-150 ${
              fill ? 'min-w-0 justify-center gap-1 px-1' : 'shrink-0 gap-1.5 px-2'
            } ${active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            {o.icon}
            {fill ? <span className="min-w-0 truncate">{o.label}</span> : o.label}
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
