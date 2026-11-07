import React, { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckIcon, CircleIcon, EyeIcon, EyeOffIcon, KeyRoundIcon } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/Modal';
import { changePassword } from '../../api/auth/endpoints';
import { ApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { passwordRules, strengthOf } from '../../utils/passwordRules';

/**
 * Change password while signed in (`POST /api/auth/password`). The server
 * needs a fresh step-up; the API client opens re-verification when it asks
 * and retries. Success is announced only once the server accepted the change.
 */
export function ChangePassword() {
  const { member, refreshSessions, log } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const ids = { current: useId(), next: useId(), confirm: useId(), rules: useId(), error: useId() };

  const rules = passwordRules(next, member?.email ?? '');
  const strength = strengthOf(rules);

  const fail = (message: string, field?: React.RefObject<HTMLInputElement | null>) => {
    setError(message);
    field?.current?.focus();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setDone('');
    if (!current) return fail('Enter your current password.', currentRef);
    if (strength.score < rules.length)
      return fail('Your new password doesn’t meet every requirement yet.', nextRef);
    if (next !== confirm) return fail('The two new passwords don’t match.', confirmRef);
    if (next === current)
      return fail('Choose a password different from your current one.', nextRef);
    setBusy(true);
    setError('');
    try {
      const r = await changePassword(current, next);
      const n = r?.revokedSessions ?? 0;
      setCurrent('');
      setNext('');
      setConfirm('');
      const message = `Password changed. ${n} other session${n === 1 ? ' was' : 's were'} signed out; this browser stays signed in.`;
      setDone(message);
      toast.success('Password changed');
      log('Changed password', `${n} other session(s) revoked`, true);
      void refreshSessions().catch(() => undefined);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      if (apiErr?.code === 'invalid_current_password')
        fail('Your current password is incorrect.', currentRef);
      else if (apiErr?.code === 'weak_password' || apiErr?.code === 'password_unchanged')
        fail(apiErr.message, nextRef);
      else if (apiErr?.isUnavailable)
        fail('Changing your password isn’t available on this server yet.');
      else fail(apiErr?.message ?? 'Couldn’t change your password. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const describedBy = error ? ids.error : undefined;

  return (
    <Panel title="Change password" meta={<span>Signs out your other sessions</span>}>
      <form onSubmit={submit} noValidate className="space-y-3 px-3.5 py-3">
        <div>
          <label htmlFor={ids.current} className="text-[12px] font-medium text-ink">
            Current password
          </label>
          <input
            id={ids.current}
            ref={currentRef}
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              setError('');
            }}
            aria-invalid={error && !current ? true : undefined}
            aria-describedby={describedBy}
            className={`${inputClass} mt-1`}
          />
        </div>
        <div>
          <label htmlFor={ids.next} className="text-[12px] font-medium text-ink">
            New password
          </label>
          <input
            id={ids.next}
            ref={nextRef}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              setError('');
            }}
            aria-describedby={[ids.rules, describedBy].filter(Boolean).join(' ')}
            className={`${inputClass} mt-1`}
          />
          <div id={ids.rules} aria-live="polite" className="mt-2">
            <div className="flex items-center gap-2">
              <span className="flex flex-1 gap-1" aria-hidden>
                {rules.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full ${i < strength.score ? strength.cls : 'bg-line'}`}
                  />
                ))}
              </span>
              {next && (
                <span className={`text-[11.5px] font-semibold ${strength.text}`}>
                  {strength.label}
                </span>
              )}
            </div>
            <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
              {rules.map((r) => (
                <li
                  key={r.label}
                  className={`flex items-center gap-1.5 text-[12px] ${r.ok ? 'text-ok' : 'text-muted'}`}
                >
                  {r.ok ? (
                    <CheckIcon className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <CircleIcon className="h-3 w-3" aria-hidden />
                  )}
                  <span>
                    {r.label}
                    <span className="sr-only">{r.ok ? ' (met)' : ' (not met)'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div>
          <label htmlFor={ids.confirm} className="text-[12px] font-medium text-ink">
            Confirm new password
          </label>
          <input
            id={ids.confirm}
            ref={confirmRef}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setError('');
            }}
            aria-describedby={describedBy}
            className={`${inputClass} mt-1`}
          />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-muted">
          <input
            type="checkbox"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#0F1115]"
          />
          {show ? (
            <EyeOffIcon className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <EyeIcon className="h-3.5 w-3.5" aria-hidden />
          )}
          Show passwords
        </label>
        {error && (
          <p
            id={ids.error}
            role="alert"
            className="rounded-md bg-bad-soft px-2.5 py-1.5 text-[12px] font-medium text-bad"
          >
            {error}
          </p>
        )}
        {done && (
          <p
            role="status"
            className="rounded-md bg-ok-soft px-2.5 py-1.5 text-[12px] font-medium text-ok"
          >
            {done}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11.5px] text-muted">
            You may be asked to confirm with your authenticator first.
          </p>
          <Button
            type="submit"
            variant="primary"
            disabled={busy}
            icon={<KeyRoundIcon className="h-3.5 w-3.5" aria-hidden />}
          >
            {busy ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
