import React, { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FingerprintIcon,
  LaptopIcon,
  LoaderCircleIcon,
  LockIcon,
  LogOutIcon,
  MapPinIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { CodeInput } from './CodeInput';
import { IdleClock } from './IdleClock';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { useDemoConfig } from '../../api/auth/useDemoConfig';
import { illustrations } from '../../data/illustrations';
import { memberById } from '../../utils/status';
import { passkeySupported } from '../../utils/webauthn';

const ease = [0.23, 1, 0.32, 1] as const;

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Full-screen lock after inactivity — page content is hidden until identity is re-verified. */
export function LockScreen() {
  const { session, role, unlock, verifyWithPasskey, signOut, idleMinutes, sessions, member } =
    useAuth();
  const demo = useDemoConfig();
  const statusId = useId();
  const { scopeLabel } = useProductFilter();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [passkeyError, setPasskeyError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lockedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const hasPasskey = passkeySupported() && (member?.passkeys ?? 0) > 0;
  const idleSince = lockedAt - idleMinutes * 60_000;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || attempts >= 5) return;
    if (code.length !== 6) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    setPasskeyError('');
    // The server checks the code (POST /api/auth/step-up); the browser cannot unlock itself.
    const ok = await unlock(code);
    if (!ok) {
      setInvalid(true);
      setAttempts((n) => n + 1);
      setCode('');
    }
    setBusy(false);
  };

  if (!session || !role) return null;
  const known = memberById(session.memberId);
  const me = { id: session.memberId, name: member?.name ?? known.name };
  const record = sessions.find((r) => r.id === session.id);
  const clock = new Date(now);
  const tooMany = attempts >= 5;
  const lockedMs = now - lockedAt;
  const severity =
    lockedMs > 30 * 60_000 ? 'Long absence' : lockedMs > 10 * 60_000 ? 'Away' : 'Recently idle';

  const unlockWithPasskey = async () => {
    setBusy(true);
    setPasskeyError('');
    const r = await verifyWithPasskey();
    if (!r.ok) setPasskeyError(r.error ?? 'Passkey verification failed.');
    setBusy(false);
  };

  const leave = () => {
    void signOut();
    navigate('/sign-in', { replace: true });
  };

  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto bg-[#0B0D14]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
    >
      {/* Backdrop: night desk scene, dimmed and softened so the UI always reads */}
      <img
        src={illustrations.lockBackdrop.src}
        alt=""
        aria-hidden
        className="pointer-events-none fixed inset-0 h-full w-full scale-105 object-cover opacity-60 blur-[2px]"
      />
      <div className="pointer-events-none fixed inset-0 bg-[#0B0D14]/55" aria-hidden />

      <div className="relative mx-auto grid min-h-full w-full max-w-5xl items-center gap-6 px-4 py-8 md:grid-cols-[minmax(0,1fr)_360px] md:gap-12 md:px-6">
        {/* Clock side */}
        <motion.section
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease }}
          className="flex flex-col items-center text-white md:items-start"
        >
          <div className="flex items-center gap-5 md:block">
            <IdleClock idleSince={idleSince} lockedAt={lockedAt} now={now} size={220} />
            <div className="md:mt-5">
              <p className="text-[44px] font-semibold leading-none tracking-tight tabular-nums md:text-[56px]">
                {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
              <p className="mt-1.5 text-[13px] text-white/70">
                {clock.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>

          <dl className="mt-6 grid w-full max-w-md grid-cols-3 overflow-hidden rounded-xl border border-white/10 bg-white/[0.06] text-[11.5px] backdrop-blur-md">
            <div className="px-3 py-2.5">
              <dt className="text-white/55">Idle for</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-white">
                {formatElapsed(now - idleSince)}
              </dd>
            </div>
            <div className="border-l border-white/10 px-3 py-2.5">
              <dt className="text-white/55">Locked for</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-[#FCA5A5]">
                {formatElapsed(lockedMs)}
              </dd>
            </div>
            <div className="border-l border-white/10 px-3 py-2.5">
              <dt className="text-white/55">Status</dt>
              <dd className="mt-0.5 truncate font-semibold text-white">{severity}</dd>
            </div>
          </dl>
          <ul className="mt-3 flex w-full max-w-md flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/60">
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[#F59E0B]" /> {idleMinutes} min grace before
              lock
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[#EF4444]" /> Locked time — grows until you
              unlock
            </li>
          </ul>
        </motion.section>

        {/* Unlock card */}
        <motion.section
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.22, ease }}
          className="w-full rounded-2xl border border-line bg-white p-5 shadow-pop"
        >
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <Avatar id={me.id} size="lg" />
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white ring-2 ring-white">
                <LockIcon className="h-2.5 w-2.5" />
              </span>
            </div>
            <div className="min-w-0">
              <h1 id="lock-title" className="truncate text-[15px] font-semibold text-ink">
                Welcome back, {me.name.split(' ')[0]}
              </h1>
              <p className="truncate text-[12px] text-muted">
                {role.label} · {scopeLabel}
              </p>
            </div>
          </div>

          <p className="mt-4 text-[12px] text-muted">
            Enter your authenticator code to continue. Your work is safe.
          </p>
          <form className="mt-2.5" onSubmit={submit} aria-describedby={statusId} noValidate>
            <CodeInput
              value={code}
              onChange={(v) => {
                setCode(v);
                setInvalid(false);
              }}
              invalid={invalid}
              autoFocus={!tooMany}
            />
            <button
              type="submit"
              disabled={busy || tooMany}
              className="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-ink text-[12.5px] font-semibold text-white transition-colors duration-150 hover:bg-ink/90 disabled:opacity-60"
            >
              <ShieldCheckIcon className="h-4 w-4" /> Unlock
            </button>
          </form>
          <p
            id={statusId}
            className="mt-2 min-h-[18px] text-center text-[11.5px]"
            role="status"
            aria-live="polite"
          >
            {busy ? (
              <span className="inline-flex items-center gap-1 text-muted">
                <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" /> Verifying…
              </span>
            ) : tooMany ? (
              <span className="font-medium text-bad">
                Too many attempts — sign out and sign in again.
              </span>
            ) : passkeyError ? (
              <span className="font-medium text-bad">{passkeyError}</span>
            ) : invalid ? (
              <span className="font-medium text-bad">
                {code.length && code.length < 6
                  ? 'Enter all 6 digits.'
                  : `Code didn’t match · ${5 - attempts} left`}
              </span>
            ) : demo.enabled && demo.mfaCode ? (
              <span className="text-muted">
                Demo environment · code{' '}
                <code className="font-mono font-semibold text-ink">{demo.mfaCode}</code>
              </span>
            ) : null}
          </p>

          {hasPasskey && (
            <button
              onClick={() => void unlockWithPasskey()}
              disabled={busy}
              className="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-line-strong text-[12.5px] font-medium text-ink transition-colors duration-150 hover:bg-sunken/60 disabled:opacity-60"
            >
              <FingerprintIcon className="h-4 w-4" /> Unlock with passkey
            </button>
          )}

          <ul className="mt-4 space-y-1.5 border-t border-line pt-3 text-[11.5px] text-muted">
            <li className="flex items-center gap-2">
              <LaptopIcon className="h-3.5 w-3.5 shrink-0 text-subtle" />{' '}
              <span className="truncate">{record?.device ?? 'This browser'}</span>
            </li>
            <li className="flex items-center gap-2">
              <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-subtle" />{' '}
              <span className="truncate">
                {record?.location ?? 'This browser'} · {record?.ip ?? '—'}
              </span>
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheckIcon className="h-3.5 w-3.5 shrink-0 text-ok" /> Content hidden · unlock
              is audited
            </li>
          </ul>

          <button
            onClick={leave}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 text-[12px] font-medium text-muted transition-colors duration-150 hover:text-ink"
          >
            <LogOutIcon className="h-3.5 w-3.5" /> Not {me.name.split(' ')[0]}? Sign out
          </button>
        </motion.section>
      </div>
    </div>
  );
}
