import type { Tone } from '../../types/portfolio';

const fill: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  neutral: 'bg-subtle',
  info: 'bg-info',
  accent: 'bg-accent',
};

interface ProgressBarProps {
  value: number;
  tone?: Tone;
  label: string;
  className?: string;
}

export function ProgressBar({ value, tone = 'accent', label, className = '' }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-sunken ${className}`}
    >
      <div className={`h-full rounded-full ${fill[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
