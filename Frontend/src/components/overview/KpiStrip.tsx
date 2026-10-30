import React from 'react';
import { Link } from 'react-router-dom';
import type { Tone } from '../../types/portfolio';
import { toneText } from '../../utils/status';

export interface Kpi {
  label: string;
  value: number | string;
  sub: string;
  subTone?: Tone;
  valueTone?: Tone;
  to: string;
  /** A data-shaped visual chosen per metric (split bar, columns, pills…). */
  viz: React.ReactNode;
  /**
   * A fact about the number. Deltas are only shown when the API actually
   * provides a period to compare against — this page has no history endpoint,
   * so it states what is true right now instead of inventing a trend.
   */
  note?: { label: string; tone: Tone };
}

export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3 xl:grid-cols-5">
      {items.map((k) => (
        <Link
          key={k.label}
          to={k.to}
          className="group grid min-w-0 grid-rows-[auto_auto_1fr] bg-white px-2.5 pb-1.5 pt-2 transition-colors duration-150 hover:bg-sunken/50"
        >
          <div className="flex items-center justify-between gap-1.5">
            <p className="truncate text-[10.5px] font-medium uppercase tracking-wide text-muted">
              {k.label}
            </p>
            {k.note && (
              <span
                className={`shrink-0 truncate rounded px-1 text-[9.5px] font-semibold ${toneText[k.note.tone]} bg-sunken`}
              >
                {k.note.label}
              </span>
            )}
          </div>
          <p className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
            <span
              className={`text-[17px] font-semibold leading-none tabular-nums tracking-tight ${k.valueTone ? toneText[k.valueTone] : 'text-ink'}`}
            >
              {k.value}
            </span>
            <span
              className={`truncate text-[10.5px] ${k.subTone ? toneText[k.subTone] : 'text-subtle'}`}
            >
              {k.sub}
            </span>
          </p>
          <div className="mt-1.5 flex min-w-0 items-end">{k.viz}</div>
        </Link>
      ))}
    </div>
  );
}
