import { useLanguage } from '../../contexts/LanguageContext';
import React from 'react';
import { Link } from 'react-router-dom';

export interface HeroStat {
  label: string;
  value: React.ReactNode;
  tone?: 'ok' | 'warn' | 'bad';
  to?: string;
}

interface PageHeroProps {
  illustration?: React.ReactNode;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  stats?: HeroStat[];
  tint?: 'accent' | 'neutral' | 'bad';
}

const tints = { accent: 'bg-accent-soft/40', neutral: 'bg-sunken/40', bad: 'bg-bad-soft/40' };
const toneText = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' };
// Columns are fixed per count so every card gets an equal track at each breakpoint.
const statCols: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
};

/** The header used across detail pages: summary and actions on top, key numbers as an even row of cards below. */
export function PageHero({
  illustration,
  eyebrow,
  title,
  description,
  badges,
  actions,
  stats,
  tint = 'accent',
}: PageHeroProps) {
  const { heading } = useLanguage();
  const n = Math.min(stats?.length ?? 0, 6);
  return (
    <section className={`overflow-hidden rounded-lg border border-line ${tints[tint]}`}>
      <div
        className={`grid items-center gap-3 px-3.5 py-3 ${illustration ? 'md:grid-cols-[auto_minmax(0,1fr)]' : ''}`}
      >
        {illustration && <div className="hidden md:block">{illustration}</div>}
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted">
              {eyebrow}
            </div>
          )}
          <h1 className="text-[17px] font-semibold leading-snug tracking-tight text-ink">
            {typeof title === 'string' ? heading(title) : title}
          </h1>
          {badges && <div className="mt-1 flex flex-wrap items-center gap-1.5">{badges}</div>}
          {description && (
            <div className="mt-0.5 max-w-2xl text-[12.5px] text-muted">{description}</div>
          )}
          {actions && <div className="mt-2 flex flex-wrap gap-1.5">{actions}</div>}
        </div>
      </div>
      {n > 0 && (
        <dl className={`grid gap-2 border-t border-line/70 px-3.5 py-3 ${statCols[n]}`}>
          {stats!.slice(0, 6).map((s, i) => {
            const lastOdd = n === 5 && i === 4;
            const cls = `flex min-w-0 flex-col justify-between gap-1 rounded-md border border-line bg-white px-3 py-2 ${lastOdd ? 'col-span-2 sm:col-span-1' : ''}`;
            const body = (
              <>
                <dt className="truncate text-[11px] font-medium leading-4 text-muted">{s.label}</dt>
                <dd
                  className={`truncate text-[18px] font-semibold leading-6 tabular-nums tracking-tight ${s.tone ? toneText[s.tone] : 'text-ink'}`}
                >
                  {s.value}
                </dd>
              </>
            );

            return s.to ? (
              <Link
                key={s.label}
                to={s.to}
                className={`${cls} transition-colors duration-150 hover:border-line-strong hover:bg-sunken/40`}
              >
                {body}
              </Link>
            ) : (
              <div key={s.label} className={cls}>
                {body}
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
