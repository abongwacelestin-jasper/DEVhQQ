import type { Tone } from '../../types/portfolio';
import { toneDot } from '../../utils/status';

const toneClass: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  neutral: 'bg-sunken text-muted',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent-ink',
};

interface StatusBadgeProps {
  tone: Tone;
  label: string;
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ tone, label, dot = false, className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${toneClass[tone]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} aria-hidden />}
      {label}
    </span>
  );
}
