import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRightIcon,
  CrownIcon,
  EyeIcon,
  EyeOffIcon,
  FingerprintIcon,
  KeyRoundIcon,
  LockIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { SignInIllustration } from '../../components/illustrations/SignInIllustration';
import { Avatar } from '../../components/ui/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import { roleByKey, type RoleKey } from '../../data/roles';
import { useDemoConfig } from '../../api/auth/useDemoConfig';
import { passkeySupported } from '../../utils/webauthn';

const input =
  'h-9 w-full rounded-md border border-line-strong bg-white px-3 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20';

export function SignIn() {
  const { signInDemo, signInPassword, signInPasskey, lockedUntil } = useAuth();
  const demo = useDemoConfig();
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

  const signInAs = async (key: RoleKey) => {
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

  const passkey = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const r = await signInPasskey();
    setBusy(false);
    if (!r.ok) return setError(r.error ?? 'Passkey sign-in failed.');
    navigate('/verify');
  };

  // Demo accounts exist only when the server publishes them.
  const accounts = demo.enabled ? demo.accounts : [];
  const admin = accounts.find((a) => a.key === 'admin');
  const others = accounts.filter((a) => a.key !== 'admin');

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
            aria-live="assertive"
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
        {passkeySupported() && (
          <button
            type="button"
            onClick={() => void passkey()}
            disabled={busy}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-line-strong text-[13px] font-medium text-ink hover:bg-sunken/60 disabled:opacity-50"
          >
            <FingerprintIcon className="h-4 w-4" /> Sign in with a passkey
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            toast('SSO isn’t configured for this workspace', {
              description: 'Sign in with your email and password, or a passkey.',
            })
          }
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-line-strong text-[13px] font-medium text-ink hover:bg-sunken/60"
        >
          <KeyRoundIcon className="h-4 w-4" /> Continue with SSO
        </button>
        {demo.enabled && demo.password && (
          <p className="text-[11.5px] text-muted">
            Demo environment · password for any member below:{' '}
            <code className="rounded bg-sunken px-1 font-mono text-ink">{demo.password}</code>
          </p>
        )}
      </form>

      {accounts.length > 0 && (
        <div className="my-5 flex items-center gap-3 text-[11.5px] font-medium text-muted">
          <span className="h-px flex-1 bg-line" /> Demo access{' '}
          <span className="h-px flex-1 bg-line" />
        </div>
      )}

      {admin && (
        <button
          onClick={() => void signInAs(admin.key as RoleKey)}
          disabled={busy}
          className="group flex w-full items-center gap-3 rounded-lg border-2 border-ink bg-white px-3 py-2.5 text-left transition-colors duration-150 hover:bg-sunken/50 disabled:opacity-60"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink text-white">
            <CrownIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-ink">Admin demo</span>
            <span className="block truncate text-[11.5px] text-muted">
              {roleByKey('admin').summary}
            </span>
          </span>
          <ArrowRightIcon className="h-4 w-4 text-ink transition-transform duration-150 group-hover:translate-x-0.5" />
        </button>
      )}

      <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {others.map((r) => {
          return (
            <li key={r.key}>
              <button
                onClick={() => void signInAs(r.key as RoleKey)}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-left transition-colors duration-150 hover:border-line-strong hover:bg-sunken/50 disabled:opacity-60"
              >
                <Avatar id={r.memberId} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-ink">
                    {r.label}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {r.name}
                    {roleByKey(r.key as RoleKey).needsOnboarding ? ' · NDA + profile' : ''}
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
