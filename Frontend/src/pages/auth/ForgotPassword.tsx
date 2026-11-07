import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon, ArrowRightIcon, MailCheckIcon, MailIcon } from 'lucide-react';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { SecurityIllustration } from '../../components/illustrations/SecurityIllustration';
import { requestRecovery } from '../../api/auth/endpoints';
import { ApiError } from '../../api/client';
import { TURNSTILE_ERRORS } from '../../api/auth/turnstile';
import { TURNSTILE_PENDING, useTurnstile } from '../../components/auth/TurnstileWidget';

const input =
  'h-9 w-full rounded-md border border-line-strong bg-white px-3 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20';

/** Step 1 of recovery: request a reset link. Same response whether or not the account exists. */
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const turnstile = useTurnstile('recover');

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  /**
   * The server answers 202 for any well-formed address (no account enumeration),
   * so "sent" is shown for every accepted request. Rate limits and outages are real errors.
   */
  const send = async (address: string) => {
    if (turnstile.enabled && !turnstile.token) return setError(TURNSTILE_PENDING);
    setBusy(true);
    setError('');
    try {
      await requestRecovery(address, turnstile.token);
      setSentTo(address);
      setResendIn(30);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError(
        err?.status === 429
          ? 'Too many requests. Wait a minute and try again.'
          : err && TURNSTILE_ERRORS.has(err.code)
            ? err.message
            : err?.isUnavailable
              ? 'Password recovery isn’t available on this server yet. Ask an Owner to reset your access.'
              : (err?.message ?? 'Couldn’t send the reset link. Try again.'),
      );
    } finally {
      setBusy(false);
      // Tokens are single-use: a fresh check for the next request (or a resend).
      turnstile.reset();
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError('Enter a valid work email.');
    void send(address);
  };

  return (
    <AuthLayout
      illustration={<SecurityIllustration className="h-auto w-full" />}
      aside={{
        title: 'Locked out happens. Getting back in is safe.',
        body: 'Reset links expire after 30 minutes, work once, and every reset is recorded in the audit log. Your MFA device is still required afterwards.',
      }}
    >
      <Link
        to="/sign-in"
        className="mb-4 inline-flex w-fit items-center gap-1 text-[12px] font-medium text-muted hover:text-ink"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" /> Back to sign in
      </Link>

      {!sentTo ? (
        <>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Reset your password</h1>
          <p className="mt-1 text-[13px] text-muted">
            Enter your work email and we’ll send you a single-use reset link.
          </p>
          <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
            <label className="block">
              <span className="text-[12px] font-medium text-ink">Work email</span>
              <span className="relative mt-1 block">
                <MailIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  placeholder="you@techorg.io"
                  className={`${input} pl-8`}
                />
              </span>
            </label>
            {turnstile.widget}
            {error && (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-md bg-bad-soft px-2.5 py-1.5 text-[12px] font-medium text-bad"
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-ink text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-ink/90 disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send reset link'} <ArrowRightIcon className="h-4 w-4" />
            </button>
          </form>
          <p className="mt-4 text-[12px] text-muted">
            Using SSO? Reset your password with your identity provider instead.
          </p>
        </>
      ) : (
        <>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ok-soft text-ok">
            <MailCheckIcon className="h-5 w-5" />
          </span>
          <h1 className="mt-3 text-[22px] font-semibold tracking-tight text-ink">
            Check your inbox
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            If an account exists for <b className="text-ink">{sentTo}</b>, a reset link is on its
            way. It expires in 30 minutes.
          </p>

          <p className="mt-3 text-[12px] text-muted">
            Open the link from the same browser. Didn’t ask for this? Ignore the email — your
            password stays the same.
          </p>
          {turnstile.enabled && <div className="mt-3">{turnstile.widget}</div>}
          {error && (
            <p role="alert" aria-live="assertive" className="mt-3 text-[12px] font-medium text-bad">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <button
              onClick={() => {
                setSentTo(null);
                setEmail('');
              }}
              className="font-medium text-muted hover:text-ink"
            >
              Use a different email
            </button>
            <button
              disabled={resendIn > 0 || busy}
              onClick={() => sentTo && void send(sentTo)}
              className="font-medium text-accent hover:underline disabled:text-muted disabled:no-underline"
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend email'}
            </button>
          </div>
        </>
      )}
    </AuthLayout>
  );
}
