import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { ServerIcon } from 'lucide-react';
import { Modal, Field, inputClass } from '../ui/Modal';
import { Button } from '../ui/Button';
import { describeError } from '../engineering/data/useApi';
import {
  GRANT_DURATIONS,
  REASON_MAX,
  REASON_MIN,
  grantsChanged,
  requestGrant,
  timeLeft,
} from './jit';
import type { AccessRequestIntent } from './jit';
import { useMyGrants } from './useMyGrants';

/**
 * "Request production access" — asks for a time-boxed grant for exactly the
 * scope the server named. A second Owner or Operations member must approve it;
 * the dialog says so, and only reports success once the API has accepted the
 * request (it needs a fresh verification, which the API client handles).
 */
export function RequestAccessDialog({
  intent,
  onClose,
}: {
  intent: AccessRequestIntent;
  onClose: () => void;
}) {
  const scope = intent.scope;
  const { pending, active, now } = useMyGrants(scope);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errorId = useId();

  // A new refusal (another scope or action) starts a fresh form.
  useEffect(() => {
    setReason('');
    setMinutes(60);
    setError(null);
    setBusy(false);
  }, [intent]);

  const trimmed = reason.trim();
  const tooShort = trimmed.length < REASON_MIN;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tooShort || busy) return;
    setBusy(true);
    setError(null);
    try {
      const grant = await requestGrant({ scope, reason: trimmed, durationMinutes: minutes });
      grantsChanged();
      toast.success('Access requested', {
        description: `${grant.scope} · waiting for a second approver (Owner or Operations).`,
      });
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const waiting = pending[0];
  const live = active[0];

  return (
    <Modal
      open
      onClose={onClose}
      title="Request production access"
      description={
        intent.message ??
        'This action changes production, so it needs a time-boxed just-in-time grant.'
      }
      illustration={
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-warn-soft text-warn">
          <ServerIcon className="h-5 w-5" aria-hidden />
        </span>
      }
      footer={
        <>
          <Button onClick={onClose}>{waiting || live ? 'Close' : 'Cancel'}</Button>
          {!waiting && !live && (
            <Button variant="primary" type="submit" form="jit-request" disabled={tooShort || busy}>
              {busy ? 'Requesting…' : 'Request access'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <p className="rounded-md border border-line bg-sunken/50 px-2.5 py-2 text-[12px] text-muted">
          Scope <span className="font-mono font-semibold text-ink">{scope}</span>. A different Owner
          or Operations member approves it (two-person rule). It ends on its own when the time is
          up, and every use is recorded in the audit log.
        </p>

        {live ? (
          <p role="status" className="rounded-md bg-ok-soft px-2.5 py-2 text-[12.5px] text-ok">
            You already have access to {scope} ({timeLeft(live.expiresAt, now)}). Try the action
            again.
          </p>
        ) : waiting ? (
          <p role="status" className="rounded-md bg-warn-soft px-2.5 py-2 text-[12.5px] text-warn">
            Your request for {scope} is waiting for approval — “{waiting.reason}”. You’ll be able to
            act once an Owner or Operations member approves it.
          </p>
        ) : (
          <form id="jit-request" onSubmit={submit} className="space-y-3">
            <Field
              label="Reason"
              hint={`At least ${REASON_MIN} characters. Approvers see it, and it goes in the audit log.`}
            >
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={REASON_MAX}
                rows={3}
                placeholder="e.g. Approve release v4.2.0 for the checkout fix"
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
                className={`${inputClass} h-auto py-1.5`}
              />
            </Field>
            <Field label="Duration">
              <select
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className={inputClass}
              >
                {GRANT_DURATIONS.map((d) => (
                  <option key={d.minutes} value={d.minutes}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            {!!error && (
              <p
                id={errorId}
                role="alert"
                className="rounded-md bg-bad-soft px-2.5 py-1.5 text-[12px] text-bad"
              >
                {describeError(error)}
              </p>
            )}
          </form>
        )}
      </div>
    </Modal>
  );
}
