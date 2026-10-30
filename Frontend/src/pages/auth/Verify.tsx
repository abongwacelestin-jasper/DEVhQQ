import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { KeyRoundIcon, LoaderCircleIcon, ShieldCheckIcon } from 'lucide-react';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { CodeInput } from '../../components/auth/CodeInput';
import { SecurityIllustration } from '../../components/illustrations/SecurityIllustration';
import { useAuth } from '../../contexts/AuthContext';
import { demoMfaCode } from '../../data/roles';
import { memberById } from '../../utils/status';

export function Verify() {
  const { session, role, verifyMfa, signOut } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(30);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const check = async (c: string) => {
    setBusy(true);
    const ok = await verifyMfa(c, trust);
    setBusy(false);
    if (!ok) {
      setInvalid(true);
      setCode('');
    } else
      toast.success('Verified', {
        description: trust ? 'This device is trusted for 30 days.' : undefined,
      });
  };

  useEffect(() => {
    if (code.length === 6 && !busy) void check(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (!session || !role) return null;
  const me = memberById(session.memberId);

  return (
    <AuthLayout
      step={{ index: 1, total: role.needsOnboarding ? 3 : 1, label: 'Verify identity' }}
      illustration={<SecurityIllustration className="h-auto w-full max-w-[280px]" />}
      aside={{
        title: 'Two keys, one door.',
        body: 'A password proves you know something; a one-time code proves you hold your device. Both are required for every account.',
      }}
    >
      <h1 className="text-[20px] font-semibold tracking-tight text-ink">Enter your 6-digit code</h1>
      <p className="mt-1 text-[12.5px] text-muted">
        Signing in as <b className="font-semibold text-ink">{me.name}</b> · {role.label}. Open your
        authenticator app.
      </p>

      <div className="mt-4">
        <CodeInput
          value={code}
          onChange={(v) => {
            setCode(v);
            setInvalid(false);
          }}
          invalid={invalid}
        />
        <p className="mt-2 min-h-[18px] text-[12px]" role="status">
          {busy ? (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" /> Checking…
            </span>
          ) : invalid ? (
            <span className="font-medium text-bad">That code didn’t match. Try again.</span>
          ) : (
            <span className="text-muted">
              Demo code:{' '}
              <code className="rounded bg-sunken px-1 font-mono font-semibold text-ink">
                {demoMfaCode}
              </code>{' '}
              — paste it or type it.
            </span>
          )}
        </p>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[12.5px] text-ink">
        <input
          type="checkbox"
          checked={trust}
          onChange={(e) => setTrust(e.target.checked)}
          className="h-3.5 w-3.5 accent-[#0F1115]"
        />
        Trust this device for 30 days
      </label>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          onClick={() => {
            toast('Touch your security key…');
            void check(demoMfaCode);
          }}
          className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-line-strong text-[12.5px] font-medium text-ink hover:bg-sunken/60"
        >
          <KeyRoundIcon className="h-4 w-4" /> Use a security key
        </button>
        <button
          disabled={resendIn > 0}
          onClick={() => {
            setResendIn(30);
            toast.success('New code sent', { description: 'Backup SMS to •••• 21' });
          }}
          className="flex h-9 items-center justify-center rounded-md border border-line-strong text-[12.5px] font-medium text-ink hover:bg-sunken/60 disabled:text-muted"
        >
          {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
        </button>
      </div>

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
