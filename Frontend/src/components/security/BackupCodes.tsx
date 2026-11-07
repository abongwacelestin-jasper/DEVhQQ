import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CopyIcon, KeyRoundIcon } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { api } from '../../api/client';
import { errorMessage } from '../work/apiState';

/**
 * One-time backup codes for signing in without the authenticator.
 * The server stores hashes only; a new set is shown here once and replaces the old one.
 */
export function BackupCodes() {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api<{ remaining: number }>('/api/auth/backup-codes')
      .then((r) => alive && setRemaining(r.remaining))
      .catch(() => alive && setRemaining(null));
    return () => {
      alive = false;
    };
  }, []);

  const generate = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ codes: string[] }>('/api/auth/backup-codes', { method: 'POST' });
      setCodes(r.codes);
      setRemaining(r.codes.length);
      toast.success('New backup codes generated', {
        description: 'Your old codes no longer work.',
      });
    } catch (e) {
      setError(errorMessage(e, 'Backup codes could not be generated.'));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Panel
      title="Backup codes"
      action={
        <Button
          size="sm"
          icon={<KeyRoundIcon className="h-3.5 w-3.5" />}
          onClick={() => void generate()}
          disabled={busy}
        >
          {remaining ? 'Generate new set' : 'Generate'}
        </Button>
      }
    >
      <div className="space-y-2 px-3.5 py-3 text-[12px] text-muted">
        <p>
          Each code signs you in once if you lose your authenticator.{' '}
          {remaining === null
            ? ''
            : remaining === 0
              ? 'You have no unused codes.'
              : `${remaining} unused ${remaining === 1 ? 'code' : 'codes'} left.`}
        </p>
        {codes && (
          <>
            <ul className="grid grid-cols-2 gap-1.5 rounded-lg border border-line bg-sunken/40 p-3 font-mono text-[12.5px] text-ink">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex items-center justify-between">
              <span>Shown only now. Store them outside this device.</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(codes.join('\n'));
                  toast.success('Backup codes copied');
                }}
                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              >
                <CopyIcon className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-bad">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
