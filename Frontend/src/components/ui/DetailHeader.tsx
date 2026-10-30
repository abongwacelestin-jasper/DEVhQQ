import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon, ChevronRightIcon } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

interface DetailHeaderProps {
  crumbs: Crumb[];
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
}

export function DetailHeader({
  crumbs,
  title,
  eyebrow,
  badges,
  actions,
  leading,
}: DetailHeaderProps) {
  const back = [...crumbs].reverse().find((c) => c.to);
  return (
    <div className="min-w-0">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1 text-[12px] text-muted"
      >
        {back?.to && (
          <Link
            to={back.to}
            className="mr-1 inline-flex shrink-0 items-center rounded p-0.5 hover:bg-sunken hover:text-ink"
            aria-label={`Back to ${back.label}`}
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
          </Link>
        )}
        <ol className="flex min-w-0 items-center gap-1 overflow-hidden">
          {crumbs.map((c, i) => (
            <li
              key={c.label + i}
              className={`flex min-w-0 items-center gap-1 ${i < crumbs.length - 2 ? 'hidden sm:flex' : ''}`}
            >
              {i > 0 && <ChevronRightIcon className="h-3 w-3 shrink-0 text-line-strong" />}
              {c.to ? (
                <Link to={c.to} className="truncate hover:text-ink hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span className="truncate font-medium text-ink" aria-current="page">
                  {c.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="mt-2.5 flex min-w-0 flex-col gap-2.5 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {leading}
          <div className="min-w-0">
            {eyebrow && <div className="mb-0.5 text-[11.5px] text-subtle">{eyebrow}</div>}
            <h1 className="text-[17px] font-semibold leading-snug tracking-tight text-ink">
              {title}
            </h1>
            {badges && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{badges}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}
