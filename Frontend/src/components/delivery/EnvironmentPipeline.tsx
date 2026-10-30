import React from 'react';
import { ChevronRightIcon, GlobeIcon } from 'lucide-react';
import type { EnvironmentLane } from '../../types/operations';
import type { Tone } from '../../types/portfolio';
import { laneMeta } from '../../utils/status';

const border: Record<Tone, string> = {
  ok: 'border-line',
  bad: 'border-bad/40',
  warn: 'border-warn/40',
  neutral: 'border-line',
  info: 'border-info/40',
  accent: 'border-accent/40',
};
const dot: Record<Tone, string> = {
  ok: 'bg-ok',
  bad: 'bg-bad',
  warn: 'bg-warn',
  neutral: 'bg-subtle',
  info: 'bg-info',
  accent: 'bg-accent',
};

export function EnvironmentPipeline({ lanes }: { lanes: EnvironmentLane[] }) {
  return (
    <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0">
      {lanes.map((l, i) => {
        const meta = laneMeta[l.status];
        return (
          <React.Fragment key={l.env}>
            <li
              className={`min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2.5 ${border[meta.tone]}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold capitalize text-ink">{l.env}</span>
                <span className={`h-2 w-2 rounded-full ${dot[meta.tone]}`} title={meta.label} />
              </div>
              <p className="mt-1.5 truncate font-mono text-xs text-ink">
                {l.sha} <span className="text-subtle">· {l.version}</span>
              </p>
              <p
                className={`mt-0.5 truncate text-[11px] ${meta.tone === 'ok' ? 'text-muted' : meta.tone === 'bad' ? 'text-bad' : 'text-warn'}`}
              >
                {meta.label} · {l.ago}
              </p>
              <p className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-subtle">
                <GlobeIcon className="h-3 w-3 shrink-0" />
                {l.url}
              </p>
            </li>
            {i < lanes.length - 1 && (
              <li aria-hidden className="hidden items-center px-1 text-line-strong sm:flex">
                <ChevronRightIcon className="h-4 w-4" />
              </li>
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}
