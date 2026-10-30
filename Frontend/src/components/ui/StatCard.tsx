import React from 'react';
import { Link } from 'react-router-dom';
import type { Tone } from '../../types/portfolio';
import { toneText } from '../../utils/status';

/**
 * A compact number card: label and value on one line, a factual note under it.
 *
 * These are the dense strips used at the top of list pages, so a page can show
 * six figures without pushing the list below the fold.
 */
export function StatCard({
  label,
  value,
  note,
  tone,
  to,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
  tone?: Tone;
  to?: string;
}) {
  const body = (
    <>
      <span className="truncate font-mono text-[9px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <span
        className={`text-right text-[14px] font-semibold leading-[15px] tabular-nums tracking-tight ${tone ? toneText[tone] : 'text-ink'}`}
      >
        {value}
      </span>
      {note && (
        <span className="col-span-2 truncate text-[9.5px] leading-[13px] text-subtle">{note}</span>
      )}
    </>
  );
  const cls =
    'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-1.5 rounded border border-line border-l-2 border-l-line-strong bg-white px-2 py-1';
  return to ? (
    <Link to={to} className={`${cls} transition-colors duration-150 hover:border-line-strong`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function StatStrip({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6">{children}</div>;
}
