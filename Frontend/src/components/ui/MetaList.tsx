import React from 'react';

export interface MetaItem {
  label: string;
  value: React.ReactNode;
}

export function MetaList({ items }: { items: MetaItem[] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 items-center justify-between gap-3 px-3.5 py-2">
          <dt className="shrink-0 text-[12px] text-muted">{it.label}</dt>
          <dd className="flex min-w-0 items-center justify-end gap-1.5 truncate text-right text-[12.5px] font-medium text-ink">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
