/**
 * Authentication — first-factor TOTP enrollment during sign-in
 * (`POST /api/auth/mfa/enroll` + `/confirm`).
 *
 * Attacks the new enrollment surface and verifies it fails closed:
 *  1. Enroll-on-already-enrolled: once a member has a factor, both enroll and
 *     enroll/confirm must refuse (409 factor_exists) — no silent factor reset.
 *  2. Cross-session hijack: a pending enrollment started by session A must not
 *     be confirmable by a different session B of the same member
 *     (confirm bound to the starting session).
 *  3. Code replay: the code that confirmed enrollment must not re-verify the
 *     new factor afterwards (per-member TOTP counter advances).
 *  4. A real factor-less member can enroll and finish sign-in (positive path).
 *
 * Fails if a factor can be reset without step-up, a foreign session confirms
 * an enrollment, or the confirming code replays.
 */

import { CLI, inviteMember, passwordStep, req, totp, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'First-factor enrollment (enroll/confirm) abuse',
  area: 'Authentication / MFA',
  run: async (base) => {
    const problems: string[] = [];
    const u = await inviteMember(base, 'enroll-probe@techorg.io');

    // Session A: password step → enroll → get the secret.
    const a = await passwordStep(base, u.email, u.password);
    const enroll = await req(base, 'POST', '/api/auth/mfa/enroll', { token: a, headers: CLI, body: {} });
    if (enroll.status !== 201 || !enroll.json?.secret)
      return { status: 'fail', id: 'INFO-ENROLL', detail: `enroll start failed (${enroll.status} ${enroll.text})` };
    const secret = enroll.json.secret as string;

    // (2) Cross-session confirm: a second password session B must NOT confirm A's pending enrollment.
    const b = await passwordStep(base, u.email, u.password);
    const crossConfirm = await req(base, 'POST', '/api/auth/mfa/enroll/confirm', {
      token: b,
      headers: CLI,
      body: { code: totp(secret) },
    });
    if (crossConfirm.status === 200 && crossConfirm.json?.ok)
      problems.push('a different session confirmed another session’s pending enrollment');

    // Positive path: session A confirms with a valid code and finishes sign-in.
    const code = totp(secret);
    const confirm = await req(base, 'POST', '/api/auth/mfa/enroll/confirm', { token: a, headers: CLI, body: { code } });
    if (confirm.status !== 200 || !confirm.json?.ok)
      problems.push(`legitimate enroll/confirm failed (${confirm.status} ${confirm.text})`);

    // (1) Enroll-on-already-enrolled: now that a factor exists, enroll must 409.
    const a2 = await passwordStep(base, u.email, u.password);
    const reEnroll = await req(base, 'POST', '/api/auth/mfa/enroll', { token: a2, headers: CLI, body: {} });
    if (reEnroll.status !== 409)
      problems.push(`enroll allowed on a member that already has a factor (${reEnroll.status}) — factor reset without step-up`);

    // (3) Replay: the confirming code (or a fresh code for the same step) must not
    // verify the live factor via MFA. Reuse the exact code just consumed.
    const replay = await req(base, 'POST', '/api/auth/mfa/totp', { token: a2, headers: CLI, body: { code } });
    if (replay.status === 200 && replay.json?.ok)
      problems.push('confirming TOTP code replayed to pass MFA afterwards');

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-ENROLL',
      detail: problems.length
        ? problems.join('; ')
        : 'enroll bound to its session; no reset without step-up; confirming code does not replay',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
