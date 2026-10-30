import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { KeyRoundIcon, LoaderCircleIcon, ShieldCheckIcon, XIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { demoMfaCode } from '../../data/roles';

export interface ReauthRequest {
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => void;
  successMessage?: string;
}

interface ReauthDialogProps {
  request: ReauthRequest | null;
  onClose: () => void;
}

export function ReauthDialog({ request, onClose }: ReauthDialogProps) {
  const { unlock } = useAuth();
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'verifying' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (request) {
      setCode('');
      setState('idle');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [request]);

  useEffect(() => {
    if (state !== 'verifying' || !request) return;
    let cancelled = false;
    void (async () => {
      // Real step-up: the API verifies the code and marks the session verified for 5 minutes.
      const ok = await unlock(code);
      if (cancelled) return;
      if (!ok) {
        setState('error');
        return;
      }
      request.onConfirm();
      toast.success(request.successMessage ?? 'Verified', {
        description: 'Action recorded in the audit log as sensitive.',
      });
      onClose();
    })();
    return () => {
      cancelled = true;
    };
  }, [state, code, request, onClose, unlock]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setState('error');
      return;
    }
    setState('verifying');
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
            onClick={onClose}
          />
          <motion.form
            onSubmit={submit}
            role="dialog"
            aria-modal="true"
            aria-label={request.title}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="relative w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-pop sm:rounded-2xl"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 rounded-md p-1.5 text-muted hover:bg-sunken"
              aria-label="Cancel"
            >
              <XIcon className="h-4 w-4" />
            </button>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
              <ShieldCheckIcon className="h-5 w-5" />
            </span>
            <h2 className="mt-3 text-base font-semibold text-ink">{request.title}</h2>
            <p className="mt-1 text-sm text-muted">{request.description}</p>

            <label className="mt-4 block">
              <span className="text-xs font-medium text-ink">
                6-digit code from your authenticator
              </span>
              <input
                ref={inputRef}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  if (state === 'error') setState('idle');
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-invalid={state === 'error'}
                placeholder="••••••"
                className={`mt-1.5 h-11 w-full rounded-lg border bg-white text-center font-mono text-lg tracking-[0.5em] text-ink outline-none ${
                  state === 'error' ? 'border-bad' : 'border-line focus:border-accent'
                }`}
              />
            </label>
            {state === 'error' && (
              <p role="alert" className="mt-1.5 text-xs text-bad">
                {code.length !== 6 ? 'Enter all 6 digits.' : 'That code didn’t match. Try again.'}
              </p>
            )}
            <p className="mt-2 text-[11px] text-subtle">Demo code: {demoMfaCode}</p>

            <button
              type="submit"
              disabled={state === 'verifying'}
              className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-70"
            >
              {state === 'verifying' ? (
                <LoaderCircleIcon className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheckIcon className="h-4 w-4" />
              )}
              {state === 'verifying' ? 'Verifying…' : request.actionLabel}
            </button>
            <button
              type="button"
              onClick={() =>
                toast('Touch your security key', {
                  description: 'WebAuthn prompt opened in your browser.',
                })
              }
              className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 text-xs font-medium text-muted hover:text-ink"
            >
              <KeyRoundIcon className="h-3.5 w-3.5" /> Use a security key instead
            </button>
          </motion.form>
        </div>
      )}
    </AnimatePresence>
  );
}
