import type { CodespacePhase } from '../../types/codespaces';

const meta: Record<CodespacePhase, { label: string; dot: string; text: string; pulse?: boolean }> =
  {
    checking: { label: 'Checking', dot: 'bg-subtle', text: 'text-muted', pulse: true },
    'not-found': { label: 'Creating', dot: 'bg-info', text: 'text-info', pulse: true },
    provisioning: { label: 'Provisioning', dot: 'bg-info', text: 'text-info', pulse: true },
    starting: { label: 'Starting', dot: 'bg-warn', text: 'text-warn', pulse: true },
    available: { label: 'Available', dot: 'bg-ok', text: 'text-ok' },
    sleeping: { label: 'Stopped · idle', dot: 'bg-subtle', text: 'text-muted' },
    'auth-required': { label: 'Sign-in needed', dot: 'bg-warn', text: 'text-warn' },
    failed: { label: 'Unavailable', dot: 'bg-bad', text: 'text-bad' },
  };

export function CodespaceStatusBadge({ phase }: { phase: CodespacePhase }) {
  const m = meta[phase];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2 py-0.5 text-[11px] font-medium ${m.text}`}
      role="status"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot} ${m.pulse ? 'animate-pulse' : ''}`} />
      {m.label}
    </span>
  );
}
