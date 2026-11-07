import { KeyRoundIcon, ServerIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { durationLabel, openAccessRequest, timeLeft } from './jit';
import { useMyGrants } from './useMyGrants';

/**
 * The member's just-in-time access for one production scope, where they act:
 * active grants with time left, pending requests, or a way to ask. The Owner
 * has standing production rights, so nothing is shown for them.
 */
export function ProductionAccessStatus({
  scope,
  what,
}: {
  scope: string;
  /** Which actions here need the grant, e.g. "Approving or rolling back this deploy". */
  what: string;
}) {
  const { member } = useAuth();
  const { active, pending, now, loading } = useMyGrants(scope);
  if (!member || member.role === 'Owner' || loading) return null;

  return (
    <section
      aria-label="Production access"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-white px-3 py-2 text-[12px]"
    >
      <ServerIcon className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
      <div className="min-w-0 flex-1">
        {active.length > 0 ? (
          <p className="text-ink">
            <span className="font-semibold">Production access active</span> ·{' '}
            <span className="font-mono">{scope}</span> ·{' '}
            <span className="font-semibold text-ok">{timeLeft(active[0].expiresAt, now)}</span>
          </p>
        ) : pending.length > 0 ? (
          <p className="text-ink">
            <span className="font-semibold">Access requested</span> ·{' '}
            <span className="font-mono">{scope}</span> · {durationLabel(pending[0].durationMs)} ·
            waiting for an Owner or Operations approver
          </p>
        ) : (
          <p className="text-muted">
            {what} needs just-in-time access to <span className="font-mono">{scope}</span>.
          </p>
        )}
      </div>
      {active.length === 0 && pending.length === 0 && (
        <Button
          size="sm"
          icon={<KeyRoundIcon className="h-3.5 w-3.5" />}
          onClick={() => openAccessRequest({ scope })}
        >
          Request access
        </Button>
      )}
    </section>
  );
}
