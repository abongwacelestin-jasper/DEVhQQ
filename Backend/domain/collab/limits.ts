/**
 * Identity-keyed rate limits built on the shared token buckets in
 * security/rateLimit.ts. That module keys by IP + session; these helpers run
 * the same limiter against a synthetic key (member id, hashed email) so the
 * buckets, refill maths and eviction stay in one place.
 */

import type { Ctx } from '../../lib/http.ts';
import { rateLimit } from '../../security/rateLimit.ts';
import { hashToken } from '../../security/crypto.ts';
import { HttpError } from '../../types.ts';

type Limiter = ReturnType<typeof rateLimit>;

const passthrough = () => Promise.resolve(undefined);

async function allowed(limiter: Limiter, ctx: Ctx, key: string): Promise<boolean> {
  try {
    await limiter({ ...ctx, ip: key, principal: undefined }, passthrough);
    return true;
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) return false;
    throw err;
  }
}

/** Message posting: a burst of 20, then one message every 2 s per member (any session, any IP). */
const postLimiter = rateLimit({ name: 'collab-post', capacity: 20, refillPerSec: 0.5 });

export async function limitMessagePost(ctx: Ctx) {
  if (!(await allowed(postLimiter, ctx, `member:${ctx.principal!.memberId}`)))
    throw new HttpError(429, 'rate_limited', 'You are sending messages too quickly');
}

/** Recovery requests per IP (answered with 429 — reveals nothing about any account). */
export const recoveryIpLimiter = rateLimit({
  name: 'recovery-ip',
  capacity: process.env.NODE_ENV === 'production' ? 5 : 20,
  refillPerSec: 1 / 60,
});

/** Recovery requests per target email: 3 per 15 minutes. */
const recoveryEmailLimiter = rateLimit({
  name: 'recovery-email',
  capacity: 3,
  refillPerSec: 3 / (15 * 60),
});

/**
 * Per-email check. Over the limit the caller still answers 202 (anything else
 * would reveal that the address was targeted recently); limiter headers set on
 * the shared response are removed for the same reason.
 */
export async function recoveryEmailAllowed(ctx: Ctx, email: string): Promise<boolean> {
  const ok = await allowed(recoveryEmailLimiter, ctx, `email:${hashToken(email)}`);
  ctx.res.removeHeader('Retry-After');
  ctx.res.removeHeader('RateLimit-Remaining');
  return ok;
}

/** Reset attempts per IP — token guessing is already infeasible, this bounds the noise. */
export const recoveryResetLimiter = rateLimit({
  name: 'recovery-reset',
  capacity: process.env.NODE_ENV === 'production' ? 10 : 30,
  refillPerSec: 1 / 30,
});
