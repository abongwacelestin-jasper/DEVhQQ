import React, { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRightIcon, FingerprintIcon, LoaderCircleIcon, ShieldCheckIcon } from 'lucide-react';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { CodeInput } from '../../components/auth/CodeInput';
import { SecurityIllustration } from '../../components/illustrations/SecurityIllustration';
import { useAuth } from '../../contexts/AuthContext';
import { useDemoConfig } from '../../api/auth/useDemoConfig';
import { beginSignInEnrollment } from '../../api/auth/endpoints';
import { TotpEnrollment, type EnrollmentEndpoints } from '../../components/security/TotpEnrollment';
import { passkeySupported } from '../../utils/webauthn';

/**
 * The member's password was accepted but they have no second factor yet (every
 * newly invited account). Enrolling an authenticator *is* the second step: the
 * server verifies the first code and upgrades this session like a normal MFA.
 */
function EnrollFirstFactor({ onLeave }: { onLeave: () => void }) {
  const { role, member, confirmEnrollment } = useAuth();
  const endpoints = useMemo<EnrollmentEndpoints>(
    () => ({ start: beginSignInEnrollment, confirm: confirmEnrollment }),
    [confirmEnrollment],
  );
  if (!role) return null;
  return (
    <AuthLayout
      step={{ index: 1, total: role.needsOnboarding ? 3 : 1, label: 'Set up your authenticator' }}
      illustration={<SecurityIllustration className="h-auto w-full max-w-[280px]" />}
      aside={{
        title: 'Two keys, one door.',
        body: 'Every DevHQ account needs a second factor. Add an authenticator app now; you’ll use it each time you sign in and for sensitive actions.',
      }}
    >
      <h1 className="text-[20px] font-semibold tracking-tight text-ink">
        Set up your authenticator to finish signing in
      </h1>
      <p className="mt-1 mb-4 text-[12.5px] text-muted">
        Signing in as <b className="font-semibold text-ink">{member?.name ?? 'your account'}</b> ·{' '}
        {role.label}. Scan the code with an authenticator app, then enter the 6-digit code it shows.
      </p>
      <TotpEnrollment
        variant="sign-in"
        endpoints={endpoints}
        onEnrolled={() => toast.success('Authenticator set up — you’re signed in')}
      />
      <div className="mt-5 flex items-center justify-between border-t border-line pt-3 text-[12px]">
        <span className="flex items-center gap-1 text-muted">
          <ShieldCheckIcon className="h-3.5 w-3.5 text-ok" /> Enrollment recorded in the audit log
        </span>
        <button onClick={onLeave} className="font-medium text-ink hover:underline">
          Use another account
        </button>
      </div>
    </AuthLayout>
  );
}

export function Verify() {
  const {
    session,
    role,
    member,
    mfaMethods,
    enrollRequired,
    verifyMfa,
    verifyBackup,
    signInPasskey,
    signOut,
  } = useAuth();
  const demo = useDemoConfig();
  const navigate = useNavigate();
  const statusId = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [backup, setBackup] = useState('');

  if (!session || !role) return null;
  const name = member?.name ?? 'your account';
  const offersPasskey = mfaMethods.includes('passkey') && passkeySupported();

  // Submitted only by the person (button or Enter) — never automatically.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (code.length !== 6) return setError('Enter all 6 digits.');
    setBusy(true);
    setError('');
    const ok = await verifyMfa(code, false);
    setBusy(false);
    if (!ok) {
      setError('That code didn’t match. Try again.');
      setCode('');
      return;
    }
    toast.success('Verified');
  };

  const submitBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (backup.replace(/[\s-]/g, '').length !== 8)
      return setError('Backup codes have 8 characters.');
    setBusy(true);
    setError('');
    const left = await verifyBackup(backup);
    setBusy(false);
    if (left === null) {
      setError('That backup code didn’t match or was already used.');
      return;
    }
    toast.success('Verified with a backup code', {
      description:
        left <= 3
          ? `${left} left. Generate a new set from Security.`
          : `${left} backup codes left.`,
    });
  };

  const leave = () => {
    void signOut();
    navigate('/sign-in', { replace: true });
  };

  if (enrollRequired) return <EnrollFirstFactor onLeave={leave} />;

  const passkey = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const r = await signInPasskey();
    setBusy(false);
    if (!r.ok) setError(r.error ?? 'Passkey verification failed.');
    else toast.success('Verified with passkey');
  };

  return (
    <AuthLayout
      step={{ index: 1, total: role.needsOnboarding ? 3 : 1, label: 'Verify identity' }}
      illustration={<SecurityIllustration className="h-auto w-full max-w-[280px]" />}
      aside={{
        title: 'Two keys, one door.',
        body: 'A password proves you know something; a one-time code or passkey proves you hold your device. Both are required for every account.',
      }}
    >
      <h1 className="text-[20px] font-semibold tracking-tight text-ink">Enter your 6-digit code</h1>
      <p className="mt-1 text-[12.5px] text-muted">
        Signing in as <b className="font-semibold text-ink">{name}</b> · {role.label}. Open your
        authenticator app.
      </p>

      {useBackup ? (
        <form className="mt-4" onSubmit={submitBackup} noValidate aria-describedby={statusId}>
          <label className="block text-[12px] font-medium text-ink" htmlFor="backup-code">
            Backup code
          </label>
          <input
            id="backup-code"
            value={backup}
            onChange={(e) => {
              setBackup(e.target.value);
              setError('');
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="xxxx-xxxx"
            className="mt-1 h-9 w-full rounded-md border border-line-strong px-2.5 font-mono text-[13px] outline-none focus:border-accent"
          />
          <p
            id={statusId}
            className="mt-2 min-h-[18px] text-[12px]"
            role="status"
            aria-live="polite"
          >
            {busy ? (
              <span className="text-muted">Checking…</span>
            ) : error ? (
              <span className="font-medium text-bad">{error}</span>
            ) : (
              <span className="text-muted">Each backup code works once.</span>
            )}
          </p>
          <button
            type="submit"
            disabled={busy}
            className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-ink text-[13px] font-semibold text-white hover:bg-ink/90 disabled:opacity-50"
          >
            Verify <ArrowRightIcon className="h-4 w-4" />
          </button>
        </form>
      ) : (
        <form className="mt-4" onSubmit={submit} noValidate aria-describedby={statusId}>
          <CodeInput
            value={code}
            onChange={(v) => {
              setCode(v);
              setError('');
            }}
            invalid={!!error}
          />
          <p
            id={statusId}
            className="mt-2 min-h-[18px] text-[12px]"
            role="status"
            aria-live="polite"
          >
            {busy ? (
              <span className="inline-flex items-center gap-1.5 text-muted">
                <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" /> Checking…
              </span>
            ) : error ? (
              <span className="font-medium text-bad">{error}</span>
            ) : demo.enabled && demo.mfaCode ? (
              <span className="text-muted">
                Demo environment · code{' '}
                <code className="rounded bg-sunken px-1 font-mono font-semibold text-ink">
                  {demo.mfaCode}
                </code>
              </span>
            ) : null}
          </p>
          <button
            type="submit"
            disabled={busy}
            className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-ink text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-ink/90 disabled:opacity-50"
          >
            Verify <ArrowRightIcon className="h-4 w-4" />
          </button>
        </form>
      )}

      <button
        type="button"
        onClick={() => {
          setUseBackup((b) => !b);
          setError('');
        }}
        className="mt-2 w-full text-center text-[12px] font-medium text-accent hover:underline"
      >
        {useBackup
          ? 'Use your authenticator code instead'
          : 'Lost your authenticator? Use a backup code'}
      </button>

      {offersPasskey && (
        <button
          type="button"
          onClick={() => void passkey()}
          disabled={busy}
          className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-line-strong text-[12.5px] font-medium text-ink hover:bg-sunken/60 disabled:opacity-60"
        >
          <FingerprintIcon className="h-4 w-4" /> Use a passkey instead
        </button>
      )}

      <div className="mt-5 flex items-center justify-between border-t border-line pt-3 text-[12px]">
        <span className="flex items-center gap-1 text-muted">
          <ShieldCheckIcon className="h-3.5 w-3.5 text-ok" /> Attempt recorded in the audit log
        </span>
        <button
          onClick={() => {
            void signOut();
            navigate('/sign-in', { replace: true });
          }}
          className="font-medium text-ink hover:underline"
        >
          Use another account
        </button>
      </div>
    </AuthLayout>
  );
}
