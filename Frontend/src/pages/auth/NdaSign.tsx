import React, { useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleIcon,
  Code2Icon,
  DatabaseIcon,
  DownloadIcon,
  FileSignatureIcon,
  HandHeartIcon,
  LockIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { NdaIllustration } from '../../components/illustrations/NdaIllustration';
import { useAuth } from '../../contexts/AuthContext';
import { memberById } from '../../utils/status';
import { formatDateTime } from '../../utils/date';
import {
  commitmentAcks,
  contributionAreas,
  durationOptions,
  hourOptions,
  ndaSections,
  weekDays,
  type NdaSectionId,
} from '../../data/nda';

const tabs: {
  id: NdaSectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'confidentiality', label: 'Confidentiality', icon: LockIcon },
  { id: 'code', label: 'Code & IP', icon: Code2Icon },
  { id: 'data', label: 'Data & privacy', icon: DatabaseIcon },
  { id: 'security', label: 'Access & security', icon: ShieldCheckIcon },
  { id: 'commitment', label: 'Volunteer commitment', icon: HandHeartIcon },
  { id: 'sign', label: 'Review & sign', icon: FileSignatureIcon },
];

const chip = (on: boolean) =>
  `inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-[12.5px] font-medium transition-colors duration-150 ${on ? 'border-ink bg-ink text-white' : 'border-line-strong text-ink hover:bg-sunken/60'}`;

export function NdaSign() {
  const { session, signNda } = useAuth();
  const [tab, setTab] = useState<NdaSectionId>('confidentiality');
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [hours, setHours] = useState(5);
  const [days, setDays] = useState<string[]>(['Sat']);
  const [duration, setDuration] = useState('3 months');
  const [areas, setAreas] = useState<string[]>([]);
  const [start, setStart] = useState('2026-11-02');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  if (!session) return null;
  const me = memberById(session.memberId);

  const toggleAck = (k: string) => setAcks((a) => ({ ...a, [k]: !a[k] }));
  const toggleIn = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const sectionDone = (id: NdaSectionId) => {
    if (id === 'commitment')
      return (
        hours > 0 &&
        days.length > 0 &&
        areas.length > 0 &&
        commitmentAcks.every((_, i) => acks[`commitment:${i}`])
      );
    if (id === 'sign') return false;
    const s = ndaSections.find((x) => x.id === id)!;
    return s.acks.every((_, i) => acks[`${id}:${i}`]);
  };
  const required = tabs.filter((t) => t.id !== 'sign');
  const doneCount = required.filter((t) => sectionDone(t.id)).length;
  const allDone = doneCount === required.length;
  const idx = tabs.findIndex((t) => t.id === tab);

  const download = () => {
    const text = `Mutual Non-Disclosure Agreement v3.3\nTech Organization ↔ ${me.name}\n\n${ndaSections.map((s) => `${s.label.toUpperCase()}\n${s.clauses.map((c) => `${c.h}: ${c.p}`).join('\n')}`).join('\n\n')}\n\nVOLUNTEER COMMITMENT\n${hours}h/week · ${days.join(', ')} · ${duration} from ${start}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'DevHQ-NDA-v3.3.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allDone) return setError('Complete every section before signing.');
    if (!signNda(name))
      return setError(`Type your full name exactly as on your profile: ${me.name}`);
    try {
      localStorage.setItem(
        `devhq.volunteer.${me.id}`,
        JSON.stringify({ hours, days, duration, areas, start, signedAt: new Date().toISOString() }),
      );
    } catch {
      /* storage unavailable */
    }
    toast.success('Agreement signed', {
      description: `${hours}h/week commitment recorded · ${formatDateTime(new Date())}`,
    });
  };

  const section = ndaSections.find((s) => s.id === tab);

  return (
    <AuthLayout
      wide
      step={{ index: 2, total: 3, label: 'Agreement & commitment' }}
      illustration={<NdaIllustration className="h-auto w-full" />}
      aside={{
        title: 'Before you see the code, a few promises.',
        body: 'Read each section, tick what you agree to, and tell us how much time you can give. It takes about four minutes.',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            Mutual NDA &amp; volunteer agreement
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            Tech Organization ↔ {me.name} · v3.3 · {doneCount} of {required.length} sections
            complete
          </p>
        </div>
        <button
          onClick={download}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[12px] font-medium text-ink hover:bg-sunken/60"
        >
          <DownloadIcon className="h-3.5 w-3.5" /> Download
        </button>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[200px_minmax(0,1fr)] lg:gap-6">
        <nav
          aria-label="Agreement sections"
          className="-mx-4 overflow-x-auto px-4 scroll-thin md:mx-0 md:px-0"
        >
          <ul role="tablist" className="flex gap-1 md:flex-col">
            {tabs.map((t) => {
              const done = sectionDone(t.id);
              const active = t.id === tab;
              return (
                <li key={t.id} className="shrink-0">
                  <button
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setTab(t.id);
                      setError('');
                    }}
                    className={`flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors duration-150 ${active ? 'bg-ink text-white' : 'text-ink hover:bg-sunken'}`}
                  >
                    <t.icon
                      className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-muted'}`}
                    />
                    <span className="flex-1">{t.label}</span>
                    {t.id !== 'sign' &&
                      (done ? (
                        <CheckIcon
                          className={`h-3.5 w-3.5 ${active ? 'text-white' : 'text-ok'}`}
                          aria-label="Complete"
                        />
                      ) : (
                        <CircleIcon
                          className={`h-3 w-3 ${active ? 'text-white/50' : 'text-line-strong'}`}
                          aria-label="Incomplete"
                        />
                      ))}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section role="tabpanel" aria-label={tabs[idx].label} className="min-w-0">
          {section && (
            <>
              <p className="text-[12.5px] text-muted">{section.summary}</p>
              <div className="mt-2 space-y-2.5 rounded-lg border border-line bg-sunken/40 px-4 py-3">
                {section.clauses.map((c) => (
                  <div key={c.h}>
                    <h2 className="text-[13px] font-semibold text-ink">{c.h}</h2>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink">{c.p}</p>
                  </div>
                ))}
              </div>
              <fieldset className="mt-3 space-y-2">
                <legend className="mb-1 text-[12px] font-semibold text-ink">
                  Confirm each point
                </legend>
                {section.acks.map((a, i) => (
                  <Check
                    key={a}
                    checked={!!acks[`${section.id}:${i}`]}
                    onChange={() => toggleAck(`${section.id}:${i}`)}
                    label={a}
                  />
                ))}
              </fieldset>
            </>
          )}

          {tab === 'commitment' && (
            <div className="space-y-4">
              <p className="text-[12.5px] text-muted">
                DevHQ projects run on volunteered time. Be honest — leads plan work around what you
                tell us, and you can change it later.
              </p>
              <div>
                <p className="text-[12px] font-semibold text-ink">Hours per week</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {hourOptions.map((h) => (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={hours === h}
                      onClick={() => setHours(h)}
                      className={chip(hours === h)}
                    >
                      {h}h
                    </button>
                  ))}
                  <label className="flex items-center gap-1.5 text-[12px] text-muted">
                    or
                    <input
                      type="number"
                      min={1}
                      max={40}
                      value={hours}
                      onChange={(e) =>
                        setHours(Math.max(0, Math.min(40, Number(e.target.value) || 0)))
                      }
                      className="h-8 w-16 rounded-md border border-line-strong px-2 text-[12.5px] text-ink outline-none focus:border-accent"
                      aria-label="Custom hours per week"
                    />
                  </label>
                </div>
              </div>
              <div>
                <p className="text-[12px] font-semibold text-ink">Days you’re usually available</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {weekDays.map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={days.includes(d)}
                      onClick={() => toggleIn(days, setDays, d)}
                      className={chip(days.includes(d))}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[12px] font-semibold text-ink">Commitment length</span>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-line-strong bg-white px-2.5 text-[13px] text-ink outline-none focus:border-accent"
                  >
                    {durationOptions.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[12px] font-semibold text-ink">Starting</span>
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-line-strong bg-white px-2.5 text-[13px] text-ink outline-none focus:border-accent"
                  />
                </label>
              </div>
              <div>
                <p className="text-[12px] font-semibold text-ink">Where you’d like to help</p>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {contributionAreas.map((a) => (
                    <Check
                      key={a}
                      checked={areas.includes(a)}
                      onChange={() => toggleIn(areas, setAreas, a)}
                      label={a}
                      boxed
                    />
                  ))}
                </div>
              </div>
              <p className="rounded-md bg-accent-soft/60 px-3 py-2 text-[12.5px] text-ink">
                That’s about <b>{hours * 4} hours a month</b> across {days.length || 'no'} day
                {days.length === 1 ? '' : 's'} a week, for {duration.toLowerCase()}.
              </p>
              <fieldset className="space-y-2">
                {commitmentAcks.map((a, i) => (
                  <Check
                    key={a}
                    checked={!!acks[`commitment:${i}`]}
                    onChange={() => toggleAck(`commitment:${i}`)}
                    label={a}
                  />
                ))}
              </fieldset>
            </div>
          )}

          {tab === 'sign' && (
            <form onSubmit={submit} className="space-y-4">
              <ul className="divide-y divide-line rounded-lg border border-line">
                {required.map((t) => {
                  const done = sectionDone(t.id);
                  return (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]"
                    >
                      <span className="flex items-center gap-2 text-ink">
                        <t.icon className="h-4 w-4 text-muted" /> {t.label}
                      </span>
                      {done ? (
                        <span className="flex items-center gap-1 font-medium text-ok">
                          <CheckIcon className="h-3.5 w-3.5" /> Done
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setTab(t.id)}
                          className="font-medium text-accent hover:underline"
                        >
                          Finish section
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <label className="block">
                <span className="text-[12px] font-semibold text-ink">
                  Type your full name to sign
                </span>
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError('');
                  }}
                  placeholder={me.name}
                  disabled={!allDone}
                  className="mt-1 h-11 w-full rounded-md border border-line-strong bg-white px-3 font-serif text-[17px] italic text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-sunken/50"
                />
              </label>
              <button
                type="submit"
                disabled={!allDone || !name.trim()}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-ink text-[13px] font-semibold text-white hover:bg-ink/90 disabled:opacity-40 sm:w-auto sm:px-5"
              >
                <FileSignatureIcon className="h-4 w-4" /> Sign agreement
              </button>
              <p className="flex items-center gap-1 text-[11px] text-muted">
                <LockIcon className="h-3 w-3" /> Signature, timestamp and network address are stored
                with the agreement.
              </p>
            </form>
          )}

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-md bg-bad-soft px-2.5 py-1.5 text-[12px] font-medium text-bad"
            >
              {error}
            </p>
          )}

          {tab !== 'sign' && (
            <div className="mt-5 flex items-center justify-between border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setTab(tabs[Math.max(0, idx - 1)].id)}
                disabled={idx === 0}
                className="inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-[12.5px] font-medium text-ink hover:bg-sunken disabled:invisible"
              >
                <ArrowLeftIcon className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                onClick={() => setTab(tabs[idx + 1].id)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink/90"
              >
                Next: {tabs[idx + 1].label} <ArrowRightIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </section>
      </div>
    </AuthLayout>
  );
}

function Check({
  checked,
  onChange,
  label,
  boxed = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  boxed?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 text-[12.5px] text-ink ${boxed ? `rounded-md border px-2.5 py-2 ${checked ? 'border-ink bg-sunken/60' : 'border-line hover:border-line-strong'}` : ''}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#0F1115]"
      />
      <span>{label}</span>
    </label>
  );
}
