import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckIcon, Loader2Icon } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/Modal';
import { useOffboarding, type Resignation } from '../../contexts/OffboardingContext';
import { useDirectory } from './useDirectory';
import { Unavailable } from '../work/Unavailable';
import { errorMessage, isUnavailable } from '../work/apiState';
import { formatDateTime } from '../../utils/date';

/**
 * Offboarding for one member on `/api/offboarding/:memberId` (B-COLLAB).
 * Writes need Administration:manage + step-up; the API client opens
 * re-verification when the server asks, so this panel only makes the calls
 * and shows what the server says.
 */
export function OffboardingPanel({ memberId }: { memberId: string }) {
  const { load, submit, toggleStep, decide, complete, withdraw } = useOffboarding();
  const { members, memberById } = useDirectory();
  const [record, setRecord] = useState<Resignation | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastDay, setLastDay] = useState('');
  const [reason, setReason] = useState('');
  const [handoverTo, setHandoverTo] = useState('');

  const refresh = useCallback(async () => {
    try {
      setRecord(await load(memberId));
      setState('ready');
    } catch (e) {
      setState(isUnavailable(e) ? 'unavailable' : 'error');
      setMessage(errorMessage(e));
    }
  }, [load, memberId]);

  useEffect(() => {
    setState('loading');
    void refresh();
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast.error(`${label} failed`, { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const active = record && record.status !== 'withdrawn' && record.status !== 'completed';
  const handoverPeople = members.filter((m) => m.id !== memberId && m.status === 'active');

  return (
    <Panel
      title="Offboarding"
      meta={record ? <span className="capitalize">{record.status}</span> : undefined}
    >
      {state === 'loading' ? (
        <p role="status" className="flex items-center gap-2 px-3.5 py-3 text-[12px] text-muted">
          <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…
        </p>
      ) : state === 'unavailable' ? (
        <Unavailable
          compact
          title="Offboarding isn't available"
          detail="The collaboration service isn't deployed on this server."
          onRetry={() => void refresh()}
        />
      ) : state === 'error' ? (
        <Unavailable
          compact
          title="Couldn't load offboarding"
          detail={message}
          onRetry={() => void refresh()}
        />
      ) : active && record ? (
        <div className="space-y-2.5 px-3.5 py-3 text-[12px]">
          <p className="text-muted">
            Last day <b className="text-ink">{record.lastDay}</b> · handover to{' '}
            <b className="text-ink">{memberById(record.handoverTo).name}</b> · {record.reason}
          </p>
          <ul className="space-y-1" aria-label="Offboarding checklist">
            {record.checklist.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={s.done}
                    disabled={busy}
                    onChange={() =>
                      void run('Updating the checklist', () => toggleStep(record.id, s.id))
                    }
                  />
                  <span className={s.done ? 'text-muted line-through' : 'text-ink'}>{s.label}</span>
                  {s.doneBy && s.doneAt && (
                    <span className="ml-auto text-[11px] text-muted">
                      {memberById(s.doneBy).name} · {formatDateTime(new Date(s.doneAt))}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            {record.status === 'pending' && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void run('Accepting', () => decide(record.id, true))}
              >
                Accept
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={busy || record.checklist.some((s) => !s.done)}
              onClick={() => void run('Completing offboarding', () => complete(record.id))}
              icon={<CheckIcon className="h-3.5 w-3.5" />}
            >
              Complete — deactivate and revoke access
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run('Withdrawing', () => withdraw(record.id))}
            >
              Withdraw
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-2 px-3.5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!lastDay || reason.trim().length < 2 || !handoverTo) return;
            void run('Starting offboarding', () =>
              submit({ memberId, lastDay, reason: reason.trim(), handoverTo }),
            );
          }}
        >
          {record?.status === 'completed' && (
            <p className="text-[12px] text-muted">
              Offboarded {record.decidedAt ? formatDateTime(new Date(record.decidedAt)) : ''}.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              type="date"
              aria-label="Last day"
              value={lastDay}
              onChange={(e) => setLastDay(e.target.value)}
              className={inputClass}
              required
            />
            <input
              aria-label="Reason"
              placeholder="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={inputClass}
              minLength={2}
              maxLength={200}
              required
            />
            <select
              aria-label="Hand work over to"
              value={handoverTo}
              onChange={(e) => setHandoverTo(e.target.value)}
              className={inputClass}
              required
            >
              <option value="">Hand over to…</option>
              {handoverPeople.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" type="submit" disabled={busy}>
            Start offboarding
          </Button>
        </form>
      )}
    </Panel>
  );
}
