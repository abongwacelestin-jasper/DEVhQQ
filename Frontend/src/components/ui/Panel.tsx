import React from 'react';

interface PanelProps {
  title: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  /** One-line search that filters this section's rows. Rendered under the header. */
  filter?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({
  title,
  meta,
  action,
  filter,
  children,
  className = '',
  bodyClassName = '',
}: PanelProps) {
  return (
    <section
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-white ${className}`}
    >
      <header className="flex min-h-[38px] min-w-0 items-center justify-between gap-3 border-b border-line px-3.5 py-2">
        <h2 className="truncate text-[12.5px] font-semibold text-ink">{title}</h2>
        {(meta || action) && (
          <div className="flex min-w-0 shrink items-center gap-2.5 truncate text-[11px] text-muted">
            {meta}
            {action}
          </div>
        )}
      </header>
      {filter && <div className="border-b border-line bg-surface px-3 py-1.5">{filter}</div>}
      <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
