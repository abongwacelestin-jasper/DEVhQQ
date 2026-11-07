import React, { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { FingerprintIcon, LoaderCircleIcon, ShieldCheckIcon, XIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useDemoConfig } from '../../api/auth/useDemoConfig';
import { passkeySupported } from '../../utils/webauthn';

export interface ReauthRequest {
  title: string;
  description: string;
  actionLabel: string;
  /** Runs after the server accepted re-verification. May be async; a rejection is shown to the user. */
  onConfirm?: () => void | Promise<unknown>;
  successMessage?: string;
  /** Opened by the API client for a request it will retry itself. */
  implicit?: boolean;
}

interface ReauthDialogProps {
  request: ReauthRequest | null;
  /** The server accepted the code or passkey (fires before `onConfirm`). */
  onVerified: () => void;
  /** The flow finished (after `onConfirm` settled). */
  onDone: () => void;
  onCancel: () => void;
}

type Phase = 'idle' | 'verifying' | 'confirming';

export function ReauthDialog({ request, onVerified, onDone, onCancel }: ReauthDialogProps) {
  const { unlock, verifyWithPasskey, member } = useAuth();
  const demo = useDemoConfig();
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descId = useId();
  const errorId = useId();
  const canPasskey = passkeySupported() && (member?.passkeys ?? 0) > 0;
  const busy = phase !== 'idle';

  useEffect(() => {
    if (!request) return;
    setCode('');
    setPhase('idle');
    setError('');
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, busy, onCancel]);

  const afterVerified = async (req: ReauthRequest) => {
    onVerified();
    if (req.onConfirm) {
      setPhase('confirming');
      try {
        await req.onConfirm();
      } catch (e) {
        toast.error('The action failed after verification', {
          description: e instanceof Error ? e.message : undefined,
        });
        onDone();
        return;
      }
    }
    toast.success(req.successMessage ?? 'Verified', {
      description: req.implicit ? undefined : 'Action recorded in the audit log as sensitive.',
    });
    onDone();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request || busy) return;
    if (code.length !== 6) {
      setError('Enter all 6 digits.');
      return;
    }
    setPhase('verifying');
    setError('');
    const ok = await unlock(code);
    if (!ok) {
      setPhase('idle');
      setCode('');
      setError('That code didn’t match. Try again.');
      inputRef.current?.focus();
      return;
    }
    await afterVerified(request);
  };

  const withPasskey = async () => {
    if (!request || busy) return;
    setPhase('verifying');
    setError('');
    const r = await verifyWithPasskey();
    if (!r.ok) {
      setPhase('idle');
      setError(r.error ?? 'Passkey verification failed.');
      return;
    }
    await afterVerified(request);
  };

  return (
    <AnimatePresence>
      {request && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-ink/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => !busy && onCancel()}
          />
          <motion.form
            onSubmit={submit}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="relative w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-pop sm:rounded-2xl"
          >
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="absolute right-3 top-3 rounded-md p-1.5 text-muted hover:bg-sunken disabled:opacity-50"
              aria-label="Cancel"
            >
              <XIcon className="h-4 w-4" />
            </button>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
              <ShieldCheckIcon className="h-5 w-5" />
            </span>
            <h2 id={titleId} className="mt-3 text-base font-semibold text-ink">
              {request.title}
            </h2>
            <p id={descId} className="mt-1 text-sm text-muted">
              {request.description}
            </p>

            <label className="mt-4 block">
              <span className="text-xs font-medium text-ink">
                6-digit code from your authenticator
              </span>
              <input
                ref={inputRef}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  if (error) setError('');
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
                disabled={busy}
                placeholder="••••••"
                className={`mt-1.5 h-11 w-full rounded-lg border bg-white text-center font-mono text-lg tracking-[0.5em] text-ink outline-none ${
                  error ? 'border-bad' : 'border-line focus:border-accent'
                }`}
              />
            </label>
            <p
              id={errorId}
              role="alert"
              aria-live="assertive"
              className="mt-1.5 min-h-[16px] text-xs text-bad"
            >
              {error}
            </p>
            {demo.enabled && demo.mfaCode && (
              <p className="text-[11px] text-subtle">
                Demo environment · code{' '}
                <code className="font-mono font-semibold text-ink">{demo.mfaCode}</code>
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-70"
            >
              {busy ? (
                <LoaderCircleIcon className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheckIcon className="h-4 w-4" />
              )}
              {phase === 'verifying'
                ? 'Verifying…'
                : phase === 'confirming'
                  ? 'Finishing…'
                  : request.actionLabel}
            </button>
            {canPasskey && (
              <button
                type="button"
                onClick={() => void withPasskey()}
                disabled={busy}
                className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 text-xs font-medium text-muted hover:text-ink disabled:opacity-60"
              >
                <FingerprintIcon className="h-3.5 w-3.5" /> Use a passkey instead
              </button>
            )}
          </motion.form>
        </div>
      )}
    </AnimatePresence>
  );
}
