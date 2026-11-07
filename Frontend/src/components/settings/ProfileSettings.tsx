import React, { useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckIcon, SaveIcon } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/Modal';
import { useAuth, type Profile } from '../../contexts/AuthContext';
import { weekDays } from '../../data/nda';
import {
  DEFAULT_DAYS,
  PROFILE_LIMITS,
  emailModes,
  notifyOptions,
  skillOptions,
  timezones,
} from '../../data/profileOptions';

type Form = Required<Profile>;

function initialForm(profile: Profile | undefined, name: string): Form {
  return {
    displayName: profile?.displayName ?? name,
    timezone: profile?.timezone ?? timezones[0],
    hoursFrom: profile?.hoursFrom ?? '09:00',
    hoursTo: profile?.hoursTo ?? '17:00',
    skills: profile?.skills ?? [],
    notify: profile?.notify ?? ['assigned', 'review', 'mentions'],
    title: profile?.title ?? '',
    pronouns: profile?.pronouns ?? '',
    bio: profile?.bio ?? '',
    days: profile?.days ?? DEFAULT_DAYS,
    emailDelivery: profile?.emailDelivery ?? 'instant',
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only the fields that differ from what the server last returned. */
function changedFields(form: Form, saved: Form): Partial<Profile> {
  const out: Partial<Record<keyof Form, unknown>> = {};
  for (const k of Object.keys(form) as (keyof Form)[])
    if (!same(form[k], saved[k])) out[k] = form[k];
  return out as Partial<Profile>;
}

const fieldLabel = 'text-[12px] font-medium text-ink';
const pill =
  'inline-flex h-7 cursor-pointer select-none items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-1 border-line-strong text-ink hover:bg-sunken/60 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white';

/**
 * Profile, availability and notification choices, stored by the server
 * (`/api/onboarding/profile`). A member without a profile yet (an Owner skips
 * onboarding) creates one on first save.
 */
export function ProfileSettings() {
  const { session, member, role, completeProfile, updateProfile } = useAuth();
  const saved = useMemo(
    () => initialForm(session?.profile, member?.name ?? ''),
    [session?.profile, member?.name],
  );
  const [form, setForm] = useState<Form>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const tzOptions = timezones.includes(form.timezone) ? timezones : [form.timezone, ...timezones];
  const dirty = !same(form, saved);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setStatus('');
    setError('');
  };
  const toggle = (k: 'skills' | 'notify' | 'days', v: string) =>
    set(k, form[k].includes(v) ? form[k].filter((x) => x !== v) : [...form[k], v]);

  const invalid = (message: string) => {
    setError(message);
    // Move focus to the message so keyboard and screen-reader users hear why.
    requestAnimationFrame(() => errorRef.current?.focus());
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setStatus('');
    if (form.displayName.trim().length < 2)
      return invalid('Add the name your teammates will see (at least 2 characters).');
    if (form.hoursFrom >= form.hoursTo) return invalid('Working hours must end after they start.');
    if (form.days.length === 0) return invalid('Pick at least one working day.');
    if (form.skills.length === 0)
      return invalid('Pick at least one skill so work can be routed to you.');
    setBusy(true);
    setError('');
    const r = session?.profile
      ? await updateProfile(changedFields(form, saved))
      : await completeProfile(form);
    setBusy(false);
    if (!r.ok) return invalid(r.error ?? 'Your profile could not be saved. Try again.');
    setStatus('Profile saved.');
    toast.success('Profile saved');
  };

  return (
    <form onSubmit={save} noValidate aria-label="Profile" className="space-y-4">
      <Panel title="Profile" meta={<span>Visible to your teammates</span>}>
        <div className="grid gap-3 px-3.5 py-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-name`} className={fieldLabel}>
              Display name
            </label>
            <input
              id={`${id}-name`}
              value={form.displayName}
              maxLength={80}
              autoComplete="name"
              onChange={(e) => set('displayName', e.target.value)}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label htmlFor={`${id}-title`} className={fieldLabel}>
              Title
            </label>
            <input
              id={`${id}-title`}
              value={form.title}
              maxLength={PROFILE_LIMITS.title}
              autoComplete="organization-title"
              placeholder={role ? `e.g. ${role.label}` : undefined}
              onChange={(e) => set('title', e.target.value)}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label htmlFor={`${id}-pronouns`} className={fieldLabel}>
              Pronouns <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id={`${id}-pronouns`}
              value={form.pronouns}
              maxLength={PROFILE_LIMITS.pronouns}
              placeholder="she/her"
              onChange={(e) => set('pronouns', e.target.value)}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-bio`} className={fieldLabel}>
              Short bio{' '}
              <span className="font-normal text-muted">
                ({PROFILE_LIMITS.bio - form.bio.length} characters left)
              </span>
            </label>
            <textarea
              id={`${id}-bio`}
              value={form.bio}
              rows={3}
              maxLength={PROFILE_LIMITS.bio}
              placeholder="What you work on and what you’re happy to be asked about."
              onChange={(e) => set('bio', e.target.value.slice(0, PROFILE_LIMITS.bio))}
              className={`${inputClass} mt-1 h-auto resize-none py-2`}
            />
          </div>
          <p className="text-[11.5px] text-muted sm:col-span-2">
            Email <b className="text-ink">{member?.email}</b> and role{' '}
            <b className="text-ink">{role?.label}</b> are set by your admin.
          </p>
        </div>
      </Panel>

      <Panel title="Availability">
        <div className="space-y-3 px-3.5 py-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={`${id}-tz`} className={fieldLabel}>
                Timezone
              </label>
              <select
                id={`${id}-tz`}
                value={form.timezone}
                onChange={(e) => set('timezone', e.target.value)}
                className={`${inputClass} mt-1`}
              >
                {tzOptions.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-from`} className={fieldLabel}>
                Working hours from
              </label>
              <input
                id={`${id}-from`}
                type="time"
                value={form.hoursFrom}
                onChange={(e) => set('hoursFrom', e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label htmlFor={`${id}-to`} className={fieldLabel}>
                Working hours to
              </label>
              <input
                id={`${id}-to`}
                type="time"
                value={form.hoursTo}
                onChange={(e) => set('hoursTo', e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </div>
          </div>
          <fieldset>
            <legend className={fieldLabel}>Working days</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {weekDays.map((d) => (
                <label key={d}>
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={form.days.includes(d)}
                    onChange={() => toggle('days', d)}
                  />
                  <span className={`${pill} min-w-[44px] justify-center`}>{d}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Panel>

      <Panel title="Skills" meta={<span>{form.skills.length} picked</span>}>
        <fieldset className="px-3.5 py-3">
          <legend className="sr-only">Skills</legend>
          <p className="mb-1.5 text-[11.5px] text-muted">
            Leads use these to route work to you. Pick at least one.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set([...skillOptions, ...form.skills])].map((s) => {
              const on = form.skills.includes(s);
              return (
                <label key={s}>
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={on}
                    onChange={() => toggle('skills', s)}
                  />
                  <span className={pill}>
                    {on && <CheckIcon className="h-3 w-3" aria-hidden />}
                    {s}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </Panel>

      <Panel title="Notifications">
        <div className="grid gap-4 px-3.5 py-3 md:grid-cols-2">
          <fieldset>
            <legend className={fieldLabel}>Notify me about</legend>
            <ul className="mt-1.5 divide-y divide-line rounded-lg border border-line">
              {notifyOptions.map((n) => (
                <li key={n.key}>
                  <label className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px] text-ink">
                    {n.label}
                    <input
                      type="checkbox"
                      checked={form.notify.includes(n.key)}
                      onChange={() => toggle('notify', n.key)}
                      className="h-3.5 w-3.5 accent-[#0F1115]"
                    />
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <fieldset>
            <legend className={fieldLabel}>Email delivery</legend>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {emailModes.map((m) => (
                <label key={m.value}>
                  <input
                    type="radio"
                    name={`${id}-email`}
                    value={m.value}
                    className="peer sr-only"
                    checked={form.emailDelivery === m.value}
                    onChange={() => set('emailDelivery', m.value)}
                  />
                  <span className={`${pill} w-full justify-center rounded-md`}>{m.label}</span>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted">
              Applies to the notifications ticked on the left.
            </p>
          </fieldset>
        </div>
      </Panel>

      <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-line bg-white px-3.5 py-2 lg:bottom-3">
        {error && (
          <p
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="mr-auto rounded-md bg-bad-soft px-2.5 py-1 text-[12px] font-medium text-bad outline-none"
          >
            {error}
          </p>
        )}
        {status && !error && (
          <p role="status" className="mr-auto text-[12px] font-medium text-ok">
            {status}
          </p>
        )}
        {!error && !status && (
          <p className="mr-auto text-[12px] text-muted">
            {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={!dirty || busy}
          onClick={() => {
            setForm(saved);
            setError('');
            setStatus('');
          }}
        >
          Discard
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!dirty || busy}
          icon={<SaveIcon className="h-3.5 w-3.5" aria-hidden />}
        >
          {busy ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </form>
  );
}
