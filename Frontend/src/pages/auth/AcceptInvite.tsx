import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CheckIcon,
  CircleIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { SecurityIllustration } from '../../components/illustrations/SecurityIllustration';
import { ApiError, api } from '../../api/client';
import { acceptInvite } from '../../api/auth/endpoints';
import { TURNSTILE_PENDING, useTurnstile } from '../../components/auth/TurnstileWidget';

const input =
  'h-9 w-full rounded-md border border-line-strong bg-white px-3 pr-9 text-[13px] text-ink outline-none transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/20';

interface InvitePreview {
  email: string;
  name: string;
  role: string;
  products: string[];
  expiresAt: string;
}

/**
 * Invite acceptance: the invited person chooses their own password, which
 * activates the account created by the admin. The link is single-use and the
 * account still signs in normally afterwards, second factor included.
 */
export function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [linkError, setLinkError] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const turnstile = useTurnstile('accept-invite');

  useEffect(() => {
    let alive = true;
    if (!token) {
      setLinkError('This page needs an invite link. Open the link from your invitation.');
      return;
    }
    void (async () => {
      try {
        const preview = await api<InvitePreview>(
          `/api/auth/invite?token=${encodeURIComponent(token)}`,
          { silent: true },
        );
        if (alive) setInvite(preview);
      } catch (e) {
        if (alive)
          setLinkError(
            e instanceof ApiError ? e.message : 'This invite link could not be checked.',
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const local = invite?.email.split('@')[0]?.toLowerCase() ?? '';
  const rules = [
    { label: 'At least 12 characters', ok: pw.length >= 12 },
    { label: 'Upper and lower case letters', ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: 'At least one number', ok: /\d/.test(pw) },
    { label: 'At least one symbol', ok: /[^A-Za-z0-9]/.test(pw) },
    {
      label: 'Doesn’t contain your email name',
      ok: !!pw && (local.length < 3 || !pw.toLowerCase().includes(local)),
    },
  ];
  const score = rules.filter((r) => r.ok).length;
  const meter =
    score <= 2
      ? { label: 'Weak', cls: 'bg-bad', text: 'text-bad' }
      : score <= 4
        ? { label: 'Fair', cls: 'bg-warn', text: 'text-warn' }
        : { label: 'Strong', cls: 'bg-ok', text: 'text-ok' };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (score < rules.length) return setError('Your password doesn’t meet every requirement yet.');
    if (pw !== confirm) return setError('The two passwords don’t match.');
    if (turnstile.enabled && !turnstile.token) return setError(TURNSTILE_PENDING);

    setBusy(true);
    setError('');
    try {
      await acceptInvite(token, pw, turnstile.token);
      setDone(true);
    } catch (err) {
      // Tokens are single-use: a fresh check for the next attempt.
      turnstile.reset();
      setError(err instanceof ApiError ? err.message : 'The invite could not be accepted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      illustration={<SecurityIllustration className="h-auto w-full" />}
      aside={{
        title: 'One link, your password, then you’re in.',
        body: 'Invite links work once and expire after seven days. Nobody at TavetaHQ ever sees the password you choose here.',
      }}
    >
      {done ? (
        <div>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ok-soft text-ok">
            <ShieldCheckIcon className="h-5 w-5" />
          </span>
          <h1 className="mt-3 text-[22px] font-semibold tracking-tight text-ink">
            Your account is active
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            Sign in with <b className="text-ink">{invite?.email ?? 'your work email'}</b> and the
            password you just set. You’ll confirm with your second factor as well.
          </p>
          <Link
            to="/sign-in"
            className="mt-5 inline-flex h-9 items-center rounded-md bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink/90"
          >
            Continue to sign in
          </Link>
        </div>
      ) : linkError ? (
        <div>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-warn-soft text-warn">
            <TriangleAlertIcon className="h-5 w-5" />
          </span>
          <h1 className="mt-3 text-[22px] font-semibold tracking-tight text-ink">
            This invite can’t be used
          </h1>
          <p className="mt-1 text-[13px] text-muted">{linkError}</p>
          <p className="mt-2 text-[12.5px] text-subtle">
            Ask an Owner or admin to send you a fresh invitation.
          </p>
          <Link
            to="/sign-in"
            className="mt-5 inline-flex h-9 items-center rounded-md border border-line px-4 text-[13px] font-medium text-ink hover:bg-sunken"
          >
            Back to sign in
          </Link>
        </div>
      ) : !invite ? (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <LoaderCircleIcon className="h-4 w-4 animate-spin" /> Checking your invite…
        </div>
      ) : (
        <>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            Welcome, {invite.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            Set a password for <b className="text-ink">{invite.email}</b>. You’re joining as{' '}
            {invite.role} with access to {invite.products.join(', ')}.
          </p>
          <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
            <label className="block">
              <span className="text-[12px] font-medium text-ink">Password</span>
              <span className="relative mt-1 block">
                <input
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={pw}
                  onChange={(e) => {
                    setPw(e.target.value);
                    setError('');
                  }}
                  className={input}
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                </button>
              </span>
            </label>
            <div aria-live="polite">
              <div className="flex items-center gap-2">
                <span className="flex flex-1 gap-1" aria-hidden>
                  {rules.map((_, i) => (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-full ${i < score ? meter.cls : 'bg-line'}`}
                    />
                  ))}
                </span>
                {pw && (
                  <span className={`text-[11.5px] font-semibold ${meter.text}`}>{meter.label}</span>
                )}
              </div>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {rules.map((r) => (
                  <li
                    key={r.label}
                    className={`flex items-center gap-1.5 text-[12px] ${r.ok ? 'text-ok' : 'text-muted'}`}
                  >
                    {r.ok ? (
                      <CheckIcon className="h-3.5 w-3.5" />
                    ) : (
                      <CircleIcon className="h-3 w-3" />
                    )}{' '}
                    {r.label}
                  </li>
                ))}
              </ul>
            </div>
            <label className="block">
              <span className="text-[12px] font-medium text-ink">Confirm password</span>
              <input
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError('');
                }}
                className={`${input} mt-1`}
              />
            </label>
            {turnstile.widget}
            {error && (
              <p
                role="alert"
                className="rounded-md bg-bad-soft px-2.5 py-1.5 text-[12px] font-medium text-bad"
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-ink text-[13px] font-semibold text-white hover:bg-ink/90 disabled:opacity-60"
            >
              {busy ? (
                <LoaderCircleIcon className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRoundIcon className="h-4 w-4" />
              )}
              {busy ? 'Activating…' : 'Activate account'}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
