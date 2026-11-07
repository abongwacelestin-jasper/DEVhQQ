import React, { useId, useMemo, useState } from 'react';
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

/** Authenticator-app enrollment: `/api/auth/totp/enroll` → scan → `/api/auth/totp/confirm`. */
export function TotpEnrollment() {
  const { log, refresh } = useAuth();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const codeId = useId();
  const errorId = useId();

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      setEnrollment(await enrollTotp());
      setDone(false);
    } catch (e) {
      setError(
        e instanceof ApiError && e.isUnavailable
          ? 'Authenticator enrollment isn’t available on this server yet.'
          : e instanceof Error
            ? e.message
            : 'Couldn’t start enrollment.',
      );
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code your app shows.');
    setBusy(true);
    setError('');
    try {
      await confirmTotp(code);
      setEnrollment(null);
      setCode('');
      setDone(true);
      log('Enrolled authenticator app', 'TOTP', true);
      toast.success('Authenticator app enrolled');
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code didn’t match.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Copy failed — select the text and copy it manually.');
    }
  };

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
      {!enrollment ? (
        <p className="flex items-center gap-2 px-3.5 py-3 text-[12px] text-muted">
          {done && <ShieldCheckIcon className="h-4 w-4 text-ok" />}
          {done
            ? 'Your authenticator app is enrolled. Codes from it unlock and approve sensitive actions.'
            : 'Use an authenticator app (1Password, Authy, Google Authenticator…) for sign-in codes.'}
        </p>
      ) : (
        <form onSubmit={confirm} className="space-y-3 px-3.5 py-3" noValidate>
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
              {busy ? 'Checking…' : 'Confirm'}
            </Button>
            <Button type="button" onClick={() => setEnrollment(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!enrollment && error && (
        <p role="alert" className="px-3.5 pb-3 text-[12px] text-bad">
          {error}
        </p>
      )}
    </Panel>
  );
}
