import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRightIcon, ArrowUpRightIcon } from 'lucide-react';
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
  delta: { label: string; good: boolean; up: boolean };
}

export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line min-[440px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
      {items.map((k, i) => {
        const DeltaIcon = k.delta.up ? ArrowUpRightIcon : ArrowDownRightIcon;
        return (
          <Link
            key={k.label}
            to={k.to}
            className={`group grid min-w-0 grid-rows-[auto_auto_1fr] bg-white px-3.5 pb-2.5 pt-2.5 transition-colors duration-150 hover:bg-sunken/50 ${
              i === items.length - 1 ? 'min-[440px]:col-span-2 md:col-span-1' : ''
            } ${i === items.length - 2 ? 'md:col-span-2 xl:col-span-1' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[11px] font-medium text-muted">{k.label}</p>
              <span
                className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-semibold ${k.delta.good ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}
              >
                <DeltaIcon className="h-2.5 w-2.5" />
                {k.delta.label}
              </span>
            </div>
            <p className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
              <span
                className={`text-[20px] font-semibold leading-none tabular-nums tracking-tight ${k.valueTone ? toneText[k.valueTone] : 'text-ink'}`}
              >
                {k.value}
              </span>
              <span
                className={`truncate text-[11px] ${k.subTone ? toneText[k.subTone] : 'text-subtle'}`}
              >
                {k.sub}
              </span>
            </p>
            <div className="mt-2 flex min-w-0 items-end">{k.viz}</div>
          </Link>
        );
      })}
    </div>
  );
}
