import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRightIcon,
  CrownIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LockIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { SignInIllustration } from '../../components/illustrations/SignInIllustration';
import { Avatar } from '../../components/ui/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import { demoPassword, demoRoles, type RoleKey } from '../../data/roles';
import { members } from '../../data/team';

const input =
  'h-9 w-full rounded-md border border-line-strong bg-white px-3 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20';

export function SignIn() {
  const { signInDemo, signInPassword, lockedUntil } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const lockedFor = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) return setError('Enter your work email and password.');
    setBusy(true);
    const r = await signInPassword(email, password);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? 'Sign-in failed.');
    navigate('/verify');
  };

  const demo = async (key: RoleKey) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await signInDemo(key);
      navigate('/verify');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Demo sign-in failed — is the backend running on :8080?',
      );
    } finally {
      setBusy(false);
    }
  };

  const admin = demoRoles[0];
  const others = demoRoles.slice(1);

  return (
    <AuthLayout
      illustration={<SignInIllustration className="h-auto w-full" />}
      aside={{
        title: 'One secure door to every product you run.',
        body: 'Projects, code, releases and operations — scoped to exactly what your role is allowed to see.',
      }}
    >
      <h1 className="text-[20px] font-semibold tracking-tight text-ink">Sign in to DevHQ</h1>
      <p className="mt-1 text-[12.5px] text-muted">
        Use your work account. You’ll confirm with a one-time code next.
      </p>

      <form onSubmit={submit} className="mt-4 space-y-2.5" noValidate>
        <label className="block">
          <span className="text-[12px] font-medium text-ink">Work email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
            placeholder="you@techorg.io"
            className={`${input} mt-1`}
          />
        </label>
        <label className="block">
          <span className="flex items-center justify-between text-[12px] font-medium text-ink">
            Password
            <Link to="/forgot-password" className="font-medium text-accent hover:underline">
              Forgot password?
            </Link>
          </span>
          <span className="relative mt-1 block">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              className={`${input} pr-9`}
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
        {(error || lockedFor > 0) && (
          <p
            role="alert"
            className="flex items-center gap-1.5 rounded-md bg-bad-soft px-2.5 py-1.5 text-[12px] font-medium text-bad"
          >
            <LockIcon className="h-3.5 w-3.5 shrink-0" />
            {lockedFor > 0 ? `Locked after 5 failed attempts. Try again in ${lockedFor}s.` : error}
          </p>
        )}
        <button
          type="submit"
          disabled={lockedFor > 0 || busy}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-ink text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-ink/90 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Continue'} <ArrowRightIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() =>
            toast('SSO isn’t configured for this demo workspace', {
              description: 'Use a demo account below.',
            })
          }
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-line-strong text-[13px] font-medium text-ink hover:bg-sunken/60"
        >
          <KeyRoundIcon className="h-4 w-4" /> Continue with SSO
        </button>
        <p className="text-[11.5px] text-muted">
          Demo password for any member below:{' '}
          <code className="rounded bg-sunken px-1 font-mono text-ink">{demoPassword}</code>
        </p>
      </form>

      <div className="my-5 flex items-center gap-3 text-[11.5px] font-medium text-muted">
        <span className="h-px flex-1 bg-line" /> Demo access{' '}
        <span className="h-px flex-1 bg-line" />
      </div>

      <button
        onClick={() => void demo(admin.key)}
        disabled={busy}
        className="group flex w-full items-center gap-3 rounded-lg border-2 border-ink bg-white px-3 py-2.5 text-left transition-colors duration-150 hover:bg-sunken/50 disabled:opacity-60"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink text-white">
          <CrownIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-ink">Admin demo</span>
          <span className="block truncate text-[11.5px] text-muted">{admin.summary}</span>
        </span>
        <ArrowRightIcon className="h-4 w-4 text-ink transition-transform duration-150 group-hover:translate-x-0.5" />
      </button>

      <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {others.map((r) => {
          const m = members.find((x) => x.id === r.memberId)!;
          return (
            <li key={r.key}>
              <button
                onClick={() => void demo(r.key)}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-left transition-colors duration-150 hover:border-line-strong hover:bg-sunken/50 disabled:opacity-60"
              >
                <Avatar id={m.id} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-ink">
                    {r.label}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {m.name} · NDA + profile
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </AuthLayout>
  );
}
