/**
 * Onboarding — the server is the authority for the NDA and profile stages
 * (the web app previously trusted sessionStorage).
 *
 *   GET  /api/onboarding          → stage + NDA/profile state
 *   GET  /api/onboarding/nda      → current agreement text, version and hash
 *   POST /api/onboarding/nda      → sign (version, typed name, timestamp, IP, text hash)
 *   POST /api/onboarding/profile  → complete the profile (NDA first)
 *   PATCH /api/onboarding/profile → partial profile update after onboarding (Settings page)
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { audit } from '../audit/auditLog.ts';
import { db } from '../store/db.ts';
import { HttpError, type Member } from '../types.ts';
import { ndaSignatures, saveMember, sortableId } from '../domain/collab/store.ts';
import { NDA_TEXT_HASH, NDA_VERSION, ndaText } from '../domain/collab/nda.ts';
import { ndaCurrent, needsOnboarding, onboardingView } from '../domain/collab/onboarding.ts';
import type { NdaSignature } from '../domain/collab/types.ts';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const notifyKeys = ['assigned', 'review', 'mentions', 'deploys', 'incidents'] as const;
const emailModes = ['instant', 'daily', 'off'] as const;
const hhmm = () => v.string({ pattern: /^([01]\d|2[0-3]):[0-5]\d$/ });

const ndaBody = v.object({
  version: v.string({ min: 1, max: 10, pattern: /^v?\d+(\.\d+)*$/ }),
  signedName: v.string({ min: 2, max: 120 }),
  commitment: v.optional(
    v.object({
      hours: v.int({ min: 1, max: 60 }),
      days: v.array(v.enumOf(days), { max: 7 }),
      duration: v.string({ min: 1, max: 40 }),
      areas: v.array(v.string({ min: 1, max: 40 }), { max: 12 }),
      start: v.optional(v.string({ max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ })),
    }),
  ),
});

const profileFields = {
  displayName: v.string({ min: 2, max: 80 }),
  timezone: v.string({
    min: 3,
    max: 60,
    pattern: /^[A-Za-z_]+(?:\/[A-Za-z_+-]+){0,2}(?: \([A-Za-z+\-0-9]{2,6}\))?$/,
  }),
  hoursFrom: hhmm(),
  hoursTo: hhmm(),
  skills: v.array(v.string({ min: 1, max: 40 }), { max: 30 }),
  notify: v.array(v.enumOf(notifyKeys), { max: 5 }),
};
/** Optional profile details (previously kept only in the browser). */
const profileExtras = {
  title: v.optional(v.string({ max: 80 })),
  pronouns: v.optional(v.string({ max: 30 })),
  bio: v.optional(v.string({ max: 160 })),
  days: v.optional(v.array(v.enumOf(days), { max: 7 })),
  emailDelivery: v.optional(v.enumOf(emailModes)),
};
const profileBody = v.object({ ...profileFields, ...profileExtras });
const profilePatch = v.object({
  ...profileExtras,
  displayName: v.optional(profileFields.displayName),
  timezone: v.optional(profileFields.timezone),
  hoursFrom: v.optional(profileFields.hoursFrom),
  hoursTo: v.optional(profileFields.hoursTo),
  skills: v.optional(profileFields.skills),
  notify: v.optional(profileFields.notify),
});

function checkProfile(p: {
  hoursFrom: string;
  hoursTo: string;
  skills: string[];
  days?: readonly string[];
}) {
  if (p.hoursFrom >= p.hoursTo)
    throw new HttpError(422, 'validation_failed', 'hoursTo must be later than hoursFrom');
  if (p.skills.length === 0)
    throw new HttpError(422, 'validation_failed', 'skills: pick at least one');
  if (p.days && p.days.length === 0)
    throw new HttpError(422, 'validation_failed', 'days: pick at least one working day');
}

/** Drops undefined keys and de-duplicates list fields. */
type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };
function clean<T extends Record<string, unknown>>(p: T): Defined<T> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(p)) {
    if (val === undefined) continue;
    out[k] = Array.isArray(val) ? [...new Set(val)] : val;
  }
  return out as Defined<T>;
}

function me(memberId: string): Member {
  const m = db.members.get(memberId);
  if (!m) throw new HttpError(404, 'not_found', 'Not found');
  return m;
}

export function registerOnboardingRoutes(r: Router) {
  const tag = 'onboarding';

  r.add(
    'GET',
    '/api/onboarding',
    { summary: 'Your onboarding stage (server-authoritative)', tag },
    authenticate,
    (ctx) => onboardingView(me(ctx.principal!.memberId)),
  );

  r.add(
    'GET',
    '/api/onboarding/nda',
    { summary: 'Current NDA text, version and SHA-256', tag },
    authenticate,
    () => ({
      version: NDA_VERSION,
      textHash: NDA_TEXT_HASH,
      text: ndaText(),
    }),
  );

  r.add(
    'POST',
    '/api/onboarding/nda',
    {
      summary: 'Sign the NDA (typed name must match your profile name)',
      tag,
      responses: [401, 409, 422],
    },
    authenticate,
    (ctx) => {
      const m = me(ctx.principal!.memberId);
      const body = parse(ndaBody, ctx.body);
      const version = body.version.replace(/^v/, '');
      if (version !== NDA_VERSION)
        throw new HttpError(
          409,
          'nda_version_mismatch',
          `Sign the current agreement (v${NDA_VERSION})`,
          {
            currentVersion: NDA_VERSION,
          },
        );
      if (body.signedName.replace(/\s+/g, ' ').toLowerCase() !== m.name.toLowerCase())
        throw new HttpError(
          422,
          'name_mismatch',
          `Type your full name exactly as on your profile: ${m.name}`,
        );
      if (ndaCurrent(m)) return onboardingView(m);

      const sig: NdaSignature = {
        id: sortableId('nda'),
        memberId: m.id,
        version: NDA_VERSION,
        signedName: body.signedName,
        signedAt: new Date().toISOString(),
        ip: ctx.ip,
        textHash: NDA_TEXT_HASH,
        ...(body.commitment ? { commitment: body.commitment } : {}),
      };
      ndaSignatures.set(sig.id, sig);
      m.ndaSignedAt = sig.signedAt;
      m.ndaVersion = sig.version;
      saveMember(m.id);
      audit.append({
        actor: m.id,
        action: 'onboarding.nda_signed',
        target: `v${sig.version} · sha256:${sig.textHash.slice(0, 16)} · ${ctx.ip}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      ctx.status = 201;
      return {
        ...onboardingView(m),
        signature: { id: sig.id, signedAt: sig.signedAt, ip: sig.ip, textHash: sig.textHash },
      };
    },
  );

  r.add(
    'POST',
    '/api/onboarding/profile',
    { summary: 'Complete your profile (after the NDA)', tag, responses: [401, 409, 422] },
    authenticate,
    (ctx) => {
      const m = me(ctx.principal!.memberId);
      const body = parse(profileBody, ctx.body);
      checkProfile(body);
      if (needsOnboarding(m) && !ndaCurrent(m))
        throw new HttpError(409, 'nda_required', 'Sign the NDA before completing your profile');
      m.profile = { ...body, ...clean(body), completedAt: new Date().toISOString() };
      saveMember(m.id);
      audit.append({
        actor: m.id,
        action: 'onboarding.profile_completed',
        target: `${body.timezone} · ${body.skills.length} skills`,
        requestId: ctx.requestId,
      });
      return onboardingView(m);
    },
  );

  r.add(
    'PATCH',
    '/api/onboarding/profile',
    { summary: 'Update your profile', tag, responses: [401, 409, 422] },
    authenticate,
    (ctx) => {
      const m = me(ctx.principal!.memberId);
      const patch = parse(profilePatch, ctx.body);
      if (!m.profile) throw new HttpError(409, 'profile_required', 'Complete your profile first');
      const next = { ...m.profile, ...clean(patch) };
      checkProfile(next);
      m.profile = next;
      saveMember(m.id);
      audit.append({
        actor: m.id,
        action: 'onboarding.profile_updated',
        target: Object.keys(patch)
          .filter((k) => patch[k as keyof typeof patch] !== undefined)
          .join(', '),
        requestId: ctx.requestId,
      });
      return onboardingView(m);
    },
  );
}
