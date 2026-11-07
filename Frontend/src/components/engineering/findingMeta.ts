import type { ApiFindingKind, ApiFindingSeverity } from './data/types';

/** Presentation constants for code-security findings (labels, colours, sort rank). */
export const severityMeta: Record<
  ApiFindingSeverity,
  { label: string; cls: string; rank: number }
> = {
  critical: { label: 'Critical', cls: 'bg-bad text-white', rank: 0 },
  high: { label: 'High', cls: 'bg-bad-soft text-bad', rank: 1 },
  medium: { label: 'Medium', cls: 'bg-warn-soft text-warn', rank: 2 },
  low: { label: 'Low', cls: 'bg-sunken text-ink', rank: 3 },
};

export const kindLabel: Record<ApiFindingKind, string> = {
  dependency: 'Dependency',
  secret: 'Secret',
  code: 'Code scanning',
  license: 'License',
};

/** Points deducted per open finding for the summary score. */
export const severityWeight: Record<ApiFindingSeverity, number> = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 2,
};
