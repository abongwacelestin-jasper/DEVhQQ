import React from 'react';
import {
  ActivityIcon,
  CircleDotIcon,
  FlaskConicalIcon,
  GitPullRequestIcon,
  GlobeIcon,
  ServerIcon,
} from 'lucide-react';
import type { TraceStep } from '../../types/engineering';
import type { Tone } from '../../types/portfolio';

const icons: Record<TraceStep['kind'], React.ComponentType<{ className?: string }>> = {
  task: CircleDotIcon,
  pr: GitPullRequestIcon,
  ci: FlaskConicalIcon,
  staging: ServerIcon,
  production: GlobeIcon,
  health: ActivityIcon,
};

const nodeTone: Record<Tone, string> = {
  ok: 'border-ok/25 bg-ok-soft text-ok',
  bad: 'border-bad/25 bg-bad-soft text-bad',
  warn: 'border-warn/25 bg-warn-soft text-warn',
  info: 'border-info/25 bg-info-soft text-info',
  accent: 'border-accent/25 bg-accent-soft text-accent-ink',
  neutral: 'border-line bg-surface text-muted',
};

const lineTone: Record<Tone, string> = {
  ok: 'bg-ok/50',
  bad: 'bg-bad/40',
  warn: 'bg-warn/40',
  info: 'bg-info/40',
  accent: 'bg-accent/40',
  neutral: 'bg-line-strong',
};

export function TraceChain({
  steps,
  vertical = false,
}: {
  steps: TraceStep[];
  vertical?: boolean;
}) {
  return (
    <ol className={`flex ${vertical ? 'flex-col' : 'flex-col md:flex-row md:items-stretch'} gap-0`}>
      {steps.map((s, i) => {
        const Icon = icons[s.kind];
        const last = i === steps.length - 1;
        return (
          <li
            key={s.kind + i}
            className={`flex ${vertical ? 'flex-row' : 'flex-row md:flex-1 md:flex-col'} min-w-0`}
          >
            <div
              className={`flex ${vertical ? 'flex-col items-center' : 'flex-col items-center md:flex-row md:items-center'} shrink-0`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full border ${nodeTone[s.tone]}`}
              >
                <Icon className="h-4 w-4" />
              </span>
              {!last && (
                <span
                  className={`${vertical ? 'my-1 h-6 w-px' : 'my-1 h-6 w-px md:mx-1.5 md:my-0 md:h-px md:w-auto md:flex-1'} ${lineTone[steps[i + 1].tone === 'neutral' ? 'neutral' : s.tone]}`}
                  aria-hidden
                />
              )}
            </div>
            <div
              className={`min-w-0 ${vertical ? 'ml-3 pb-3' : 'ml-3 pb-3 md:ml-0 md:mt-2 md:pb-0 md:pr-3'}`}
            >
              <p className="text-[11px] font-medium text-subtle">{s.label}</p>
              <p
                className={`truncate text-[12px] font-semibold ${s.tone === 'neutral' ? 'text-muted' : 'text-ink'}`}
              >
                {s.value}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
