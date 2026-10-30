import React from 'react';

interface TabOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  tone?: 'default' | 'warn';
}

interface UnderlineTabsProps<T extends string> {
  options: TabOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  trailing?: React.ReactNode;
  className?: string;
}

/** Compact underline tab bar for in-page sections. */
export function UnderlineTabs<T extends string>({
  options,
  value,
  onChange,
  label,
  trailing,
  className = '',
}: UnderlineTabsProps<T>) {
  return (
    <div className={`flex items-end gap-4 border-b border-line ${className}`}>
      <div
        role="tablist"
        aria-label={label}
        className="-mb-px flex min-w-0 items-end gap-4 overflow-x-auto scroll-thin"
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(o.value)}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 text-[12.5px] font-medium transition-colors duration-150 ${
                active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {o.label}
              {o.count !== undefined && (
                <span
                  className={`rounded px-1 text-[10.5px] font-semibold tabular-nums ${
                    o.tone === 'warn' && o.count > 0
                      ? 'bg-warn-soft text-warn'
                      : active
                        ? 'bg-ink text-white'
                        : 'bg-sunken text-muted'
                  }`}
                >
                  {o.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {trailing && (
        <div className="ml-auto flex shrink-0 items-center gap-2 pb-1.5">{trailing}</div>
      )}
    </div>
  );
}
