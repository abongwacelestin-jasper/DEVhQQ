import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CopyIcon, QrCodeIcon, ShieldCheckIcon } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { ApiError } from '../../api/client';
import { confirmTotp, enrollTotp } from '../../api/auth/endpoints';
import type { TotpEnrollment as Enrollment } from '../../api/types';
import { encodeQr } from './qrCode';

/** Renders a QR matrix as crisp SVG with the standard 4-module quiet zone. */
function QrSvg({ text, label }: { text: string; label: string }) {
  const matrix = useMemo(() => {
    try {
      return encodeQr(text);
    } catch {
      return null;
    }
  }, [text]);
  if (!matrix) return null;
  const n = matrix.length + 8;
  const d = matrix
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + 4} ${y + 4}h1v1h-1z` : '')))
    .join('');
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      className="h-44 w-44 rounded-md border border-line bg-white"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** Where an enrollment starts and is confirmed. */
export interface EnrollmentEndpoints {
  start: () => Promise<Enrollment>;
  confirm: (code: string) => Promise<unknown>;
}

/** Signed-in member adding or replacing an authenticator (Security page). */
const settingsEndpoints: EnrollmentEndpoints = { start: enrollTotp, confirm: confirmTotp };

function explain(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : fallback;
  if (e.isUnavailable) return 'Authenticator enrollment isn’t available on this server yet.';
  if (e.code === 'mfa_invalid')
    return 'That code didn’t match. Check that your device clock is right and try the newest code.';
  if (e.code === 'enrollment_invalid') return 'This setup expired. Start again to get a new code.';
  if (e.status === 429) return 'Too many attempts. Wait a minute and try again.';
  return e.message;
}

interface TotpEnrollmentProps {
  endpoints?: EnrollmentEndpoints;
  /** `sign-in`: starts immediately, no panel chrome, no cancel — enrolling is how sign-in finishes. */
  variant?: 'settings' | 'sign-in';
  /** Called after the server accepted the first code. */
  onEnrolled?: () => void;
}

/** Authenticator-app enrollment: start → scan the QR (or type the key) → confirm one code. */
export function TotpEnrollment({
  endpoints = settingsEndpoints,
  variant = 'settings',
  onEnrolled,
}: TotpEnrollmentProps) {
  const { log, refresh } = useAuth();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const codeId = useId();
  const errorId = useId();
  const signIn = variant === 'sign-in';
  const started = useRef(false);

  const start = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setEnrollment(await endpoints.start());
      setCode('');
      setDone(false);
    } catch (e) {
      setError(explain(e, 'Couldn’t start enrollment.'));
    } finally {
      setBusy(false);
    }
  }, [endpoints]);

  // During sign-in there is nothing else to do on this screen, so begin right away (once).
  useEffect(() => {
    if (!signIn || started.current) return;
    started.current = true;
    void start();
  }, [signIn, start]);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code your app shows.');
    setBusy(true);
    setError('');
    try {
      await endpoints.confirm(code);
    } catch (err) {
      setBusy(false);
      setCode('');
      if (err instanceof ApiError && err.code === 'enrollment_invalid') setEnrollment(null);
      return setError(explain(err, 'That code didn’t match.'));
    }
    setBusy(false);
    setEnrollment(null);
    setCode('');
    setDone(true);
    if (!signIn) {
      log('Enrolled authenticator app', 'TOTP', true);
      toast.success('Authenticator app enrolled');
      void refresh();
    }
    onEnrolled?.();
  };

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Copy failed — select the text and copy it manually.');
    }
  };

  const form = enrollment && (
    <form
      onSubmit={confirm}
      className={signIn ? 'space-y-3' : 'space-y-3 px-3.5 py-3'}
      noValidate
      aria-label="Confirm authenticator"
    >
      <div className="flex flex-col items-start gap-3 sm:flex-row">
        <QrSvg text={enrollment.otpauthUri} label="QR code for your authenticator app" />
        <div className="min-w-0 flex-1 space-y-2 text-[12px] text-muted">
          <p>Scan the code with your authenticator app, or enter the setup key manually.</p>
          <div>
            <span className="block text-[11px] font-medium text-ink">Setup key</span>
            <span className="mt-0.5 flex items-center gap-1.5">
              <code className="min-w-0 flex-1 select-all break-all rounded border border-line bg-sunken/60 px-2 py-1 font-mono text-[12px] text-ink">
                {enrollment.secret}
              </code>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                icon={<CopyIcon className="h-3.5 w-3.5" />}
                onClick={() => void copy(enrollment.secret, 'Setup key')}
              >
                Copy
              </Button>
            </span>
          </div>
          <button
            type="button"
            className="text-[11.5px] font-medium text-accent hover:underline"
            onClick={() => void copy(enrollment.otpauthUri, 'Setup link')}
          >
            Copy otpauth:// link
          </button>
          {enrollment.expiresAt && (
            <p className="text-[11px] text-subtle">
              Finish before{' '}
              {new Date(enrollment.expiresAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
              .
            </p>
          )}
        </div>
      </div>
      <label htmlFor={codeId} className="block">
        <span className="text-[12px] font-medium text-ink">Code from the app</span>
        <input
          id={codeId}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            setError('');
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className="mt-1 h-9 w-40 rounded-md border border-line px-2.5 text-center font-mono text-[15px] tracking-[0.3em] outline-none focus:border-accent"
        />
      </label>
      <p
        id={errorId}
        role="alert"
        aria-live="assertive"
        className="min-h-[16px] text-[12px] text-bad"
      >
        {error}
      </p>
      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? 'Checking…' : signIn ? 'Confirm and continue' : 'Confirm'}
        </Button>
        {!signIn && (
          <Button type="button" onClick={() => setEnrollment(null)} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );

  if (signIn)
    return (
      <div>
        {form}
        {!enrollment && (
          <div className="space-y-2">
            <p role="status" aria-live="polite" className="text-[12px] text-muted">
              {busy ? 'Preparing your setup code…' : ''}
            </p>
            {error && (
              <p role="alert" className="text-[12px] font-medium text-bad">
                {error}
              </p>
            )}
            {!busy && (
              <Button
                variant="primary"
                type="button"
                icon={<QrCodeIcon className="h-3.5 w-3.5" />}
                onClick={() => void start()}
              >
                Start again
              </Button>
            )}
          </div>
        )}
      </div>
    );

  return (
    <Panel
      title="Authenticator app"
      action={
        !enrollment && (
          <Button
            size="sm"
            icon={<QrCodeIcon className="h-3.5 w-3.5" />}
            onClick={() => void start()}
            disabled={busy}
          >
            {done ? 'Re-enroll' : 'Set up'}
          </Button>
        )
      }
    >
      {form || (
        <p className="flex items-center gap-2 px-3.5 py-3 text-[12px] text-muted">
          {done && <ShieldCheckIcon className="h-4 w-4 text-ok" />}
          {done
            ? 'Your authenticator app is enrolled. Codes from it unlock and approve sensitive actions.'
            : 'Use an authenticator app (1Password, Authy, Google Authenticator…) for sign-in codes.'}
        </p>
      )}
      {!enrollment && error && (
        <p role="alert" className="px-3.5 pb-3 text-[12px] text-bad">
          {error}
        </p>
      )}
    </Panel>
  );
}
