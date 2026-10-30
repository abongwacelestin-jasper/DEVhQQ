import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  GlobeIcon,
  MailIcon,
  PartyPopperIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { ProfileIllustration } from '../../components/illustrations/ProfileIllustration';
import { useAuth, type Profile } from '../../contexts/AuthContext';
import { memberById } from '../../utils/status';
import { weekDays } from '../../data/nda';

const timezones = [
  'Africa/Lagos (WAT)',
  'Europe/London (GMT)',
  'Europe/Berlin (CET)',
  'America/New_York (ET)',
  'Asia/Tokyo (JST)',
  'Asia/Kolkata (IST)',
];
const skillOptions = [
  'React',
  'TypeScript',
  'Node.js',
  'PostgreSQL',
  'Figma',
  'Design systems',
  'QA automation',
  'Playwright',
  'Kubernetes',
  'Terraform',
  'Observability',
  'Roadmapping',
  'Technical writing',
  'Accessibility',
];
const notifyOptions = [
  { key: 'assigned', label: 'Tasks assigned to me' },
  { key: 'review', label: 'Review requests' },
  { key: 'mentions', label: 'Mentions & comments' },
  { key: 'deploys', label: 'Deploys on my products' },
  { key: 'incidents', label: 'Incidents on my products' },
];

const steps = ['About you', 'Availability', 'Skills & alerts', 'Security'];
const field =
  'mt-1 h-9 w-full rounded-md border border-line-strong bg-white px-3 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
const label = 'text-[12px] font-semibold text-ink';

export function CompleteProfile() {
  const { session, role, completeProfile } = useAuth();
  const navigate = useNavigate();
  const me = memberById(session?.memberId ?? 'm1');
  const [step, setStep] = useState(0);
  const [p, setP] = useState<Profile>({
    displayName: me.name,
    timezone: timezones[0],
    hoursFrom: '09:00',
    hoursTo: '17:00',
    skills: [],
    notify: ['assigned', 'review', 'mentions'],
  });
  const [title, setTitle] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [bio, setBio] = useState('');
  const [days, setDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [email, setEmail] = useState<'instant' | 'daily' | 'off'>('instant');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const codes = useMemo(
    () =>
      Array.from(
        { length: 8 },
        (_, i) => `${((4821 + i * 1373) % 9000) + 1000}-${((7319 + i * 2087) % 9000) + 1000}`,
      ),
    [],
  );
  if (!session || !role) return null;

  const initials =
    p.displayName
      .trim()
      .split(/\s+/)
      .map((s) => s[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';
  const toggle = (k: 'skills' | 'notify', v: string) =>
    setP((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((s) => s !== v) : [...x[k], v] }));

  const next = () => {
    setError('');
    if (step === 0 && p.displayName.trim().length < 2)
      return setError('Add the name your teammates will see.');
    if (step === 1 && p.hoursFrom >= p.hoursTo)
      return setError('Working hours must end after they start.');
    if (step === 1 && days.length === 0) return setError('Pick at least one working day.');
    if (step === 2 && p.skills.length === 0)
      return setError('Pick at least one skill so work can be routed to you.');
    if (step === 3 && !saved) return setError('Confirm you’ve stored your backup codes.');
    setStep((s) => s + 1);
  };

  const finish = () => {
    completeProfile(p);
    try {
      localStorage.setItem(
        `devhq.profile.${me.id}`,
        JSON.stringify({ title, pronouns, bio, days, email }),
      );
      localStorage.setItem(
        'devhq.email-prefs',
        JSON.stringify({
          mode: email,
          onAssign: p.notify.includes('assigned'),
          onUnassign: true,
          onDue: true,
        }),
      );
    } catch {
      /* storage unavailable */
    }
    toast.success(`Welcome, ${p.displayName.split(' ')[0]}`);
    navigate(role.home, { replace: true });
  };

  return (
    <AuthLayout
      wide
      step={{ index: 3, total: 3, label: 'Complete profile' }}
      illustration={<ProfileIllustration className="h-auto w-full" />}
      aside={{
        title: 'Tell the team who’s joining.',
        body: 'Your hours and skills help leads assign work fairly; your alert choices keep notifications — and email — quiet.',
      }}
    >
      {step < 4 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_250px]">
          <div className="min-w-0">
            <ol className="mb-5 grid grid-cols-4 gap-1.5" aria-label="Profile steps">
              {steps.map((s, i) => (
                <li key={s} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => i < step && setStep(i)}
                    disabled={i >= step}
                    className="block w-full text-left"
                  >
                    <span
                      className={`block h-1 rounded-full ${i <= step ? 'bg-ink' : 'bg-line'}`}
                    />
                    <span
                      className={`mt-1 block truncate text-[11.5px] ${i === step ? 'font-semibold text-ink' : 'text-muted'}`}
                    >
                      {s}
                    </span>
                  </button>
                </li>
              ))}
            </ol>

            <h1 className="text-[22px] font-semibold tracking-tight text-ink">{steps[step]}</h1>

            {step === 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <span className={label}>Display name</span>
                  <input
                    value={p.displayName}
                    onChange={(e) => setP({ ...p, displayName: e.target.value })}
                    className={field}
                  />
                </label>
                <label>
                  <span className={label}>Title</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={`e.g. ${role.label}`}
                    className={field}
                  />
                </label>
                <label>
                  <span className={label}>
                    Pronouns <span className="font-normal text-muted">(optional)</span>
                  </span>
                  <input
                    value={pronouns}
                    onChange={(e) => setPronouns(e.target.value)}
                    placeholder="she/her"
                    className={field}
                  />
                </label>
                <label className="sm:col-span-2">
                  <span className={label}>
                    Short bio{' '}
                    <span className="font-normal text-muted">({160 - bio.length} left)</span>
                  </span>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value.slice(0, 160))}
                    rows={3}
                    placeholder="What you work on and what you’re happy to be asked about."
                    className={`${field} h-auto resize-none py-2`}
                  />
                </label>
                <p className="text-[11.5px] text-muted sm:col-span-2">
                  Email <b className="text-ink">{me.email}</b> and role{' '}
                  <b className="text-ink">{role.label}</b> are set by your admin.
                </p>
              </div>
            )}

            {step === 1 && (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="sm:col-span-3 md:col-span-1">
                    <span className={label}>Timezone</span>
                    <select
                      value={p.timezone}
                      onChange={(e) => setP({ ...p, timezone: e.target.value })}
                      className={field}
                    >
                      {timezones.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className={label}>Hours from</span>
                    <input
                      type="time"
                      value={p.hoursFrom}
                      onChange={(e) => setP({ ...p, hoursFrom: e.target.value })}
                      className={field}
                    />
                  </label>
                  <label>
                    <span className={label}>to</span>
                    <input
                      type="time"
                      value={p.hoursTo}
                      onChange={(e) => setP({ ...p, hoursTo: e.target.value })}
                      className={field}
                    />
                  </label>
                </div>
                <div>
                  <p className={label}>Working days</p>
                  <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                    {weekDays.map((d) => {
                      const on = days.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setDays((l) => (on ? l.filter((x) => x !== d) : [...l, d]))
                          }
                          className={`h-9 rounded-md border text-[12.5px] font-medium transition-colors duration-150 ${on ? 'border-ink bg-ink text-white' : 'border-line-strong text-ink hover:bg-sunken/60'}`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="mt-4 grid gap-5 md:grid-cols-2">
                <div>
                  <p className={label}>Skills · {p.skills.length} picked</p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {skillOptions.map((s) => {
                      const on = p.skills.includes(s);
                      return (
                        <li key={s}>
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggle('skills', s)}
                            className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150 ${on ? 'border-ink bg-ink text-white' : 'border-line-strong text-ink hover:bg-sunken/60'}`}
                          >
                            {on && <CheckIcon className="h-3 w-3" />}
                            {s}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className={label}>Notify me about</p>
                    <ul className="mt-1.5 divide-y divide-line rounded-lg border border-line">
                      {notifyOptions.map((n) => (
                        <li key={n.key}>
                          <label className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px] text-ink">
                            {n.label}
                            <input
                              type="checkbox"
                              checked={p.notify.includes(n.key)}
                              onChange={() => toggle('notify', n.key)}
                              className="h-3.5 w-3.5 accent-[#0F1115]"
                            />
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className={label}>Email delivery</p>
                    <div className="mt-1.5 grid grid-cols-3 gap-1.5" role="radiogroup">
                      {(['instant', 'daily', 'off'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={email === m}
                          onClick={() => setEmail(m)}
                          className={`h-8 rounded-md border text-[12px] font-medium capitalize ${email === m ? 'border-ink bg-ink text-white' : 'border-line-strong text-ink hover:bg-sunken/60'}`}
                        >
                          {m === 'daily' ? 'Daily digest' : m}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="mt-4 space-y-3">
                <p className="flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 text-[12.5px] font-medium text-ok">
                  <ShieldCheckIcon className="h-4 w-4" /> Authenticator app confirmed
                  {session.trustedDevice ? ' · this device is trusted for 30 days' : ''}
                </p>
                <div className="flex items-center justify-between">
                  <p className={label}>Backup codes · each works once</p>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(codes.join('\n'));
                      toast.success('Backup codes copied');
                    }}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
                  >
                    <CopyIcon className="h-3.5 w-3.5" /> Copy
                  </button>
                </div>
                <ul className="grid grid-cols-2 gap-1.5 rounded-lg border border-line bg-sunken/40 p-3 font-mono text-[12.5px] text-ink sm:grid-cols-4">
                  {codes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <label className="flex items-start gap-2 text-[12.5px] text-ink">
                  <input
                    type="checkbox"
                    checked={saved}
                    onChange={(e) => setSaved(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 accent-[#0F1115]"
                  />
                  I’ve stored these codes somewhere safe, outside this device.
                </label>
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-md bg-bad-soft px-2.5 py-1.5 text-[12px] font-medium text-bad"
              >
                {error}
              </p>
            )}

            <div className="mt-6 flex items-center justify-between border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-[12.5px] font-medium text-ink hover:bg-sunken disabled:invisible"
              >
                <ArrowLeftIcon className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                onClick={next}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink/90"
              >
                {step === 3 ? 'Finish' : 'Continue'} <ArrowRightIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <aside aria-label="Profile preview" className="hidden lg:block">
            <p className="mb-1.5 text-[11.5px] font-medium text-muted">How teammates see you</p>
            <div className="rounded-lg border border-line p-4">
              <span
                className="flex h-14 w-14 items-center justify-center rounded-full text-[18px] font-semibold text-white"
                style={{ background: me.color }}
                aria-hidden
              >
                {initials}
              </span>
              <p className="mt-2.5 text-[14px] font-semibold text-ink">
                {p.displayName || 'Your name'}{' '}
                {pronouns && (
                  <span className="text-[12px] font-normal text-muted">({pronouns})</span>
                )}
              </p>
              <p className="text-[12px] text-muted">{title || role.label}</p>
              {bio && <p className="mt-2 text-[12px] leading-relaxed text-ink">{bio}</p>}
              <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[12px] text-ink">
                <div className="flex items-center gap-1.5">
                  <GlobeIcon className="h-3.5 w-3.5 text-muted" /> {p.timezone.split(' ')[0]}
                </div>
                <div className="flex items-center gap-1.5">
                  <ClockIcon className="h-3.5 w-3.5 text-muted" /> {p.hoursFrom}–{p.hoursTo} ·{' '}
                  {days.length} days
                </div>
                <div className="flex items-center gap-1.5">
                  <MailIcon className="h-3.5 w-3.5 text-muted" /> Email:{' '}
                  {email === 'daily' ? 'daily digest' : email}
                </div>
              </dl>
              {p.skills.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1">
                  {p.skills.slice(0, 6).map((s) => (
                    <li
                      key={s}
                      className="rounded bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink"
                    >
                      {s}
                    </li>
                  ))}
                  {p.skills.length > 6 && (
                    <li className="px-1 text-[11px] text-muted">+{p.skills.length - 6}</li>
                  )}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : (
        <section className="mx-auto max-w-md text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok">
            <PartyPopperIcon className="h-6 w-6" />
          </span>
          <h1 className="mt-3 text-[22px] font-semibold tracking-tight text-ink">
            You’re all set, {p.displayName.split(' ')[0]}
          </h1>
          <p className="mx-auto mt-1 text-[13px] text-muted">
            You’ll land in <b className="text-ink">{role.homeLabel}</b>. Assignments will reach you{' '}
            {email === 'off'
              ? 'in DevHQ only'
              : email === 'daily'
                ? 'in a daily email digest'
                : 'by email as they happen'}
            .
          </p>
          <button
            onClick={finish}
            className="mx-auto mt-4 flex h-9 items-center gap-1.5 rounded-md bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink/90"
          >
            Enter DevHQ <ArrowRightIcon className="h-4 w-4" />
          </button>
        </section>
      )}
    </AuthLayout>
  );
}
