import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  FingerprintIcon,
  GlobeIcon,
  HistoryIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  LockKeyholeIcon,
  MonitorIcon,
  ServerIcon,
  ShieldCheckIcon,
  TerminalSquareIcon,
} from 'lucide-react';
import { useConsole } from '../../contexts/ConsoleContext';
import { CodeInput, isCompleteCode } from '../../components/auth/CodeInput';
import { BrandLogo, BrandName } from '../../components/ui/BrandLogo';
import { ThemeToggle } from '../../components/layout/ThemeToggle';
import { JsonView } from '../../components/console/JsonView';
import { errorMessage } from '../../utils/consoleClient';
import {
  DEMO_CODE,
  DEMO_PASSWORD,
  demoRoles as fallbackRoles,
  consoleMembers,
} from '../../data/consoleSeed';
import type { ConsoleMember } from '../../types/console';

interface Health {
  ok: boolean;
  version: string;
  env: string;
  uptimeSec: number;
  routes: number;
}
interface DemoAccount {
  key: string;
  label: string;
  name: string;
  email: string;
}
interface Me {
  ip: string;
  city: string;
  country: string;
  network: string;
}

const ease = [0.23, 1, 0.32, 1] as const;
const initials = (n: string) =>
  n
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('');

const capabilities = [
  {
    icon: TerminalSquareIcon,
    title: 'Request editor',
    text: 'Copy as cURL, HTTPie, fetch, Go and more',
  },
  { icon: ServerIcon, title: 'Query runner', text: 'Structured, allow-listed, never evaluated' },
  { icon: GlobeIcon, title: 'Locations & risk', text: 'Tor, VPN and impossible-travel signals' },
  { icon: HistoryIcon, title: 'Tamper-evident audit', text: 'Hash-chained trail of every change' },
];

/** Operator sign-in: connection picker, password + code, and one-click demo roles. */
export function ConsoleLogin() {
  const { mode, setMode, baseUrl, setBaseUrl, call, signIn } = useConsole();
  const [health, setHealth] = useState<{ data: Health | null; ms: number; checking: boolean }>({
    data: null,
    ms: 0,
    checking: true,
  });
  const [demo, setDemo] = useState<DemoAccount[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState(() => localStorage.getItem('devhq.console.email') ?? '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [caps, setCaps] = useState(false);
  const [code, setCode] = useState('');
  const [partial, setPartial] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState(baseUrl);

  const probe = useCallback(async () => {
    setHealth((h) => ({ ...h, checking: true }));
    const [h, d, m] = await Promise.all([
      call('GET', '/api/health', undefined, { token: null }),
      call('GET', '/api/auth/demo-accounts', undefined, { token: null }),
      call('GET', '/api/locations/me', undefined, { token: null }),
    ]);
    setHealth({ data: h.status === 200 ? (h.body as Health) : null, ms: h.ms, checking: false });
    const accounts = d.status === 200 ? (d.body as { accounts: DemoAccount[] }).accounts : null;
    setDemo(
      accounts ??
        fallbackRoles.map((r) => ({
          ...r,
          name: consoleMembers.find((x) => x.id === r.memberId)!.name,
          email: consoleMembers.find((x) => x.id === r.memberId)!.email,
        })),
    );
    setMe(m.status === 200 ? (m.body as Me) : null);
  }, [call]);

  useEffect(() => {
    void probe();
  }, [probe]);

  const online = !!health.data;

  const finish = (token: string, member: ConsoleMember, method: 'password' | 'demo') => {
    signIn({ token, member, method, startedAt: Date.now() });
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return setError('Enter your work email and password.');
    setBusy('password');
    setError('');
    const r = await call('POST', '/api/auth/sign-in', JSON.stringify({ email, password }), {
      token: null,
    });
    setBusy(null);
    if (r.status !== 200) return setError(errorMessage(r));
    localStorage.setItem('devhq.console.email', email);
    setPartial((r.body as { token: string }).token);
    setStep('code');
    setCode('');
  };

  const submitCode = useCallback(
    async (value: string) => {
      setBusy('code');
      setError('');
      const r = await call('POST', '/api/auth/mfa/totp', JSON.stringify({ code: value }), {
        token: partial,
      });
      if (r.status !== 200) {
        setBusy(null);
        setCode('');
        return setError(errorMessage(r));
      }
      const body = r.body as { token: string; member?: ConsoleMember };
      let member = body.member;
      if (!member) {
        const s = await call('GET', '/api/auth/session', undefined, { token: body.token });
        member = (s.body as { member: ConsoleMember }).member;
      }
      setBusy(null);
      finish(body.token, member, 'password');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [call, partial],
  );

  useEffect(() => {
    if (step === 'code' && isCompleteCode(code) && !busy) void submitCode(code);
  }, [code, step, busy, submitCode]);

  const demoLogin = async (key: string) => {
    setBusy(key);
    setError('');
    const r = await call(
      'POST',
      '/api/auth/demo',
      JSON.stringify({ roleKey: key, mfaCode: DEMO_CODE }),
      { token: null },
    );
    setBusy(null);
    if (r.status !== 200) return setError(errorMessage(r));
    const body = r.body as { token: string; member: ConsoleMember };
    finish(body.token, body.member, 'demo');
  };

  return (
    <div className="flex min-h-screen w-full bg-canvas text-ink">
      {/* Context panel */}
      <aside className="relative hidden w-[46%] max-w-[640px] flex-col justify-between border-r border-line bg-sunken/50 p-8 lg:flex xl:p-10">
        <div className="flex items-center gap-2.5">
          <BrandLogo size={26} />
          <BrandName className="text-[14.5px]" />
          <span className="text-[13px] text-muted">API console</span>
        </div>

        <div className="max-w-[480px]">
          <h1 className="text-[26px] font-semibold leading-[1.2] tracking-tight">
            Run, test and observe the TavetaHQ backend from one place.
          </h1>
          <p className="mt-2 text-[13.5px] text-muted">
            Every request you send here is authenticated, rate-limited and written to the audit
            trail — exactly like the app.
          </p>

          <div className="mt-6 overflow-hidden rounded-xl border border-line bg-white">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px] text-subtle">
              <span className="font-mono">
                $ curl {mode === 'preview' ? 'localhost:8080' : baseUrl.replace(/^https?:\/\//, '')}
                /api/health
              </span>
              <span className="ml-auto font-mono tabular-nums">
                {health.checking ? '…' : `${Math.round(health.ms)} ms`}
              </span>
            </div>
            <div className="max-h-[150px] p-3">
              {health.data ? (
                <JsonView
                  value={{
                    ok: health.data.ok,
                    version: health.data.version,
                    env: health.data.env,
                    uptimeSec: health.data.uptimeSec,
                    routes: health.data.routes,
                  }}
                />
              ) : (
                <p className="font-mono text-[11.5px] text-bad">
                  {health.checking
                    ? 'Connecting…'
                    : 'curl: (7) Failed to connect — server not reachable'}
                </p>
              )}
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
            {capabilities.map((c) => (
              <div key={c.title} className="flex gap-2.5">
                <c.icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                <div>
                  <dt className="text-[12.5px] font-semibold">{c.title}</dt>
                  <dd className="text-[11.5px] text-muted">{c.text}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>

        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-subtle">
          <li className="flex items-center gap-1.5">
            <ShieldCheckIcon className="h-3.5 w-3.5" /> MFA on every operator session
          </li>
          <li className="flex items-center gap-1.5">
            <LockKeyholeIcon className="h-3.5 w-3.5" /> Sessions expire after 12 h
          </li>
        </ul>
      </aside>

      {/* Form */}
      <main className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-2 lg:invisible">
            <BrandLogo size={20} />
            <span className="text-[13px] font-semibold">API console</span>
          </div>
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center px-5 pb-10 sm:px-8">
          <div className="w-full max-w-[400px]">
            {/* Connection */}
            <div className="rounded-xl border border-line bg-white p-1">
              <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Connection">
                {(['preview', 'live'] as const).map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => mode !== m && setMode(m)}
                    className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium transition-colors duration-150 ${mode === m ? 'bg-sunken text-ink' : 'text-muted hover:text-ink'}`}
                  >
                    {m === 'preview' ? (
                      <MonitorIcon className="h-3.5 w-3.5" />
                    ) : (
                      <ServerIcon className="h-3.5 w-3.5" />
                    )}
                    {m === 'preview' ? 'Preview server' : 'Live server'}
                  </button>
                ))}
              </div>
              {mode === 'live' && (
                <form
                  className="flex gap-1.5 p-1.5 pt-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setBaseUrl(urlDraft.trim());
                  }}
                >
                  <input
                    value={urlDraft}
                    onChange={(e) => setUrlDraft(e.target.value)}
                    aria-label="Server URL"
                    spellCheck={false}
                    className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-2.5 font-mono text-[11.5px] outline-none focus:border-accent"
                  />
                  <button className="h-8 rounded-md border border-line-strong px-3 text-[12px] font-medium hover:bg-sunken">
                    Connect
                  </button>
                </form>
              )}
              <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-2 text-[11px]">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${health.checking ? 'bg-subtle' : online ? 'bg-ok' : 'bg-bad'}`}
                />
                <span className="text-muted">
                  {health.checking
                    ? 'Checking…'
                    : online
                      ? `Online · v${health.data!.version} · ${health.data!.env} · ${Math.round(health.ms)} ms`
                      : 'Unreachable — start it with npm run dev'}
                </span>
                {mode === 'preview' && (
                  <span className="ml-auto text-subtle">runs in your browser</span>
                )}
              </div>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {step === 'password' ? (
                <motion.div
                  key="pw"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease }}
                >
                  <h2 className="mt-7 text-[20px] font-semibold tracking-tight">
                    Sign in to the console
                  </h2>
                  <p className="mt-1 text-[12.5px] text-muted">
                    Use your TavetaHQ work account. A 6-digit code is required next.
                  </p>

                  <form onSubmit={submitPassword} className="mt-5 space-y-3" noValidate>
                    <label className="block">
                      <span className="mb-1 block text-[12px] font-medium">Work email</span>
                      <input
                        type="email"
                        autoComplete="username"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@techorg.io"
                        className="h-9 w-full rounded-md border border-line-strong bg-white px-3 text-[13px] outline-none transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/20"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 flex items-center justify-between text-[12px] font-medium">
                        Password
                        {caps && (
                          <span className="text-[11px] font-medium text-warn">Caps Lock is on</span>
                        )}
                      </span>
                      <span className="relative block">
                        <input
                          type={showPw ? 'text' : 'password'}
                          autoComplete="current-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
                          className="h-9 w-full rounded-md border border-line-strong bg-white pl-3 pr-9 text-[13px] outline-none transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/20"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPw((s) => !s)}
                          aria-label={showPw ? 'Hide password' : 'Show password'}
                          className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded text-subtle hover:text-ink"
                        >
                          {showPw ? (
                            <EyeOffIcon className="h-4 w-4" />
                          ) : (
                            <EyeIcon className="h-4 w-4" />
                          )}
                        </button>
                      </span>
                    </label>
                    {error && (
                      <p
                        role="alert"
                        className="rounded-md bg-bad-soft px-3 py-2 text-[12px] font-medium text-bad"
                      >
                        {error}
                      </p>
                    )}
                    <button
                      disabled={!online || !!busy}
                      className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-ink text-[13px] font-semibold text-canvas transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
                    >
                      {busy === 'password' ? (
                        <LoaderCircleIcon className="h-4 w-4 animate-spin" />
                      ) : null}
                      Continue <ArrowRightIcon className="h-3.5 w-3.5" />
                    </button>
                  </form>

                  <div className="my-5 flex items-center gap-3 text-[11px] text-subtle">
                    <span className="h-px flex-1 bg-line" /> or sign in as a demo role{' '}
                    <span className="h-px flex-1 bg-line" />
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {demo.map((a) => (
                      <button
                        key={a.key}
                        disabled={!online || !!busy}
                        onClick={() => demoLogin(a.key)}
                        className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-white px-2 py-1.5 text-left transition-colors duration-150 hover:border-line-strong hover:bg-sunken/60 disabled:opacity-50"
                      >
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent-ink">
                          {busy === a.key ? (
                            <LoaderCircleIcon className="h-3 w-3 animate-spin" />
                          ) : (
                            initials(a.name)
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[11.5px] font-semibold">
                            {a.label}
                          </span>
                          <span className="block truncate text-[10.5px] text-subtle">{a.name}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-subtle">
                    Any demo email works with password{' '}
                    <button
                      onClick={() => setPassword(DEMO_PASSWORD)}
                      className="rounded bg-sunken px-1 font-mono text-ink hover:underline"
                    >
                      {DEMO_PASSWORD}
                    </button>{' '}
                    and code{' '}
                    <span className="rounded bg-sunken px-1 font-mono text-ink">{DEMO_CODE}</span>.
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="code"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease }}
                >
                  <button
                    onClick={() => {
                      setStep('password');
                      setError('');
                    }}
                    className="mt-6 inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-ink"
                  >
                    <ArrowLeftIcon className="h-3.5 w-3.5" /> {email}
                  </button>
                  <div className="mt-4 flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent">
                      <KeyRoundIcon className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="text-[18px] font-semibold tracking-tight">Enter your code</h2>
                      <p className="text-[12px] text-muted">
                        From your authenticator app · submits automatically
                      </p>
                    </div>
                  </div>
                  <div className="mt-5">
                    <CodeInput
                      value={code}
                      onChange={(v) => {
                        setCode(v);
                        setError('');
                      }}
                      invalid={!!error}
                    />
                  </div>
                  <p className="mt-2 min-h-[18px] text-[12px]" role="status">
                    {busy === 'code' ? (
                      <span className="inline-flex items-center gap-1.5 text-muted">
                        <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" /> Verifying…
                      </span>
                    ) : error ? (
                      <span className="font-medium text-bad">{error}</span>
                    ) : (
                      <span className="text-subtle">Demo code {DEMO_CODE}</span>
                    )}
                  </p>
                  <button
                    disabled
                    title={
                      mode === 'preview'
                        ? 'Passkeys need the live server on its own origin'
                        : 'Register a passkey from the Security page first'
                    }
                    className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-line-strong text-[12.5px] font-medium text-muted disabled:opacity-60"
                  >
                    <FingerprintIcon className="h-4 w-4" /> Use a passkey instead
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-4 text-[11px] text-subtle">
              <GlobeIcon className="h-3.5 w-3.5" />
              {me ? (
                <span>
                  Connecting from {me.city}, {me.country} ·{' '}
                  <span className="font-mono">{me.ip}</span> · {me.network}
                </span>
              ) : (
                <span>Location unavailable</span>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
