import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  CheckIcon,
  CircleIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { SecurityIllustration } from '../../components/illustrations/SecurityIllustration';

const input =
  'h-9 w-full rounded-md border border-line-strong bg-white px-3 pr-9 text-[13px] text-ink outline-none transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/20';

/** Step 2 of recovery: choose a new password from a valid, single-use link. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const email = params.get('email') ?? '';
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [signOutAll, setSignOutAll] = useState(true);
  const [error, setError] = useState('');

  const local = email.split('@')[0]?.toLowerCase() ?? '';
  const rules = [
    { label: 'At least 12 characters', ok: pw.length >= 12 },
    { label: 'Upper and lower case letters', ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: 'At least one number', ok: /\d/.test(pw) },
    { label: 'At least one symbol', ok: /[^A-Za-z0-9]/.test(pw) },
    {
      label: 'Doesn’t contain your email name',
      ok: !!pw && (!local || !pw.toLowerCase().includes(local)),
    },
  ];

  const score = rules.filter((r) => r.ok).length;
  const meter =
    score <= 2
      ? { label: 'Weak', cls: 'bg-bad', text: 'text-bad' }
      : score <= 4
        ? { label: 'Fair', cls: 'bg-warn', text: 'text-warn' }
        : { label: 'Strong', cls: 'bg-ok', text: 'text-ok' };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (score < rules.length)
      return setError('Your new password doesn’t meet every requirement yet.');
    if (pw !== confirm) return setError('The two passwords don’t match.');
    toast.success('Password updated', {
      description: signOutAll
        ? 'All other sessions were signed out. In this demo, sign in still uses devhq-demo.'
        : 'In this demo, sign in still uses devhq-demo.',
    });
    navigate('/sign-in', { replace: true });
  };

  return (
    <AuthLayout
      illustration={<SecurityIllustration className="h-auto w-full" />}
      aside={{
        title: 'A strong password, then your second key.',
        body: 'After resetting you’ll still confirm with your authenticator code — a reset link alone can never get anyone into your account.',
      }}
    >
      {token !== 'demo' ? (
        <div>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-warn-soft text-warn">
            <TriangleAlertIcon className="h-5 w-5" />
          </span>
          <h1 className="mt-3 text-[22px] font-semibold tracking-tight text-ink">
            This link has expired
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            Reset links work once and expire after 30 minutes. Request a fresh one to continue.
          </p>
          <Link
            to="/forgot-password"
            className="mt-5 inline-flex h-9 items-center rounded-md bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink/90"
          >
            Request a new link
          </Link>
        </div>
      ) : (
        <>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            Choose a new password
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            For <b className="text-ink">{email || 'your account'}</b>. Link valid for 30 minutes.
          </p>
          <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
            <label className="block">
              <span className="text-[12px] font-medium text-ink">New password</span>
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
              <span className="text-[12px] font-medium text-ink">Confirm new password</span>
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
            <label className="flex items-start gap-2 text-[12.5px] text-ink">
              <input
                type="checkbox"
                checked={signOutAll}
                onChange={(e) => setSignOutAll(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-[#0F1115]"
              />
              Sign out of every other device and browser
            </label>
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
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-ink text-[13px] font-semibold text-white hover:bg-ink/90"
            >
              <KeyRoundIcon className="h-4 w-4" /> Update password
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
