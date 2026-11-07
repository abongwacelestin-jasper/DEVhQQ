import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LaptopIcon, LogOutIcon } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import { useReauth } from '../../contexts/ReauthContext';

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** This member's live sessions, straight from the server (`GET /api/auth/session`). */
export function SessionsPanel() {
  const { serverSessions, refreshSessions, revokeSession, signOutEverywhere } = useAuth();
  const { requestReauth } = useReauth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    refreshSessions().catch(() => setError('Couldn’t load sessions.'));
  }, [refreshSessions]);

  const revoke = (id: string, label: string) =>
    requestReauth({
      title: 'Revoke session',
      description: `${label} is signed out immediately.`,
      actionLabel: 'Verify & revoke',
      successMessage: 'Session revoked',
      onConfirm: () => revokeSession(id),
    });

  const everywhere = () =>
    requestReauth({
      title: 'Sign out everywhere',
      description: 'Every session on this account ends, including this one.',
      actionLabel: 'Verify & sign out',
      successMessage: 'Signed out everywhere',
      onConfirm: async () => {
        const n = await signOutEverywhere();
        toast(`${n} session${n === 1 ? '' : 's'} ended`);
        navigate('/sign-in', { replace: true });
      },
    });

  return (
    <Panel
      title="Your sessions"
      meta={<span>{serverSessions.length} active</span>}
      action={
        <Button
          size="sm"
          variant="ghost"
          className="text-bad hover:text-bad"
          icon={<LogOutIcon className="h-3.5 w-3.5" />}
          onClick={everywhere}
        >
          Sign out everywhere
        </Button>
      }
    >
      {error && (
        <p role="alert" className="px-3.5 py-2 text-[12px] text-bad">
          {error}
        </p>
      )}
      <ul className="divide-y divide-line">
        {serverSessions.map((s) => {
          const place = [s.location?.city, s.location?.country].filter(Boolean).join(', ');
          return (
            <li key={s.id} className="flex items-center gap-2.5 px-3.5 py-2">
              <LaptopIcon className="h-4 w-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-ink">
                  {s.client}
                  {s.current && <StatusBadge tone="ok" label="This browser" />}
                  {s.stepUpRequired && <StatusBadge tone="warn" label="Needs re-verification" />}
                </p>
                <p className="truncate text-[11.5px] text-muted">
                  {place || 'Unknown location'} · {s.ip} · {s.method} · last seen{' '}
                  {when(s.lastSeenAt)}
                </p>
              </div>
              {!s.current && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-bad hover:text-bad"
                  onClick={() => revoke(s.id, s.client)}
                >
                  Revoke
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
