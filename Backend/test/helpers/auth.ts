/**
 * Sign-in helpers for integration tests.
 *
 *   const owner = await signInAs(app, 'admin');   // verified session, Bearer token
 *   const all = await signInAll(app);             // { admin, pm, developer, ... }
 *   const half = await passwordOnly(app, 'kofi@techorg.io'); // MFA still pending
 *
 * Demo accounts are the seeded members in store/db.ts (non-production only).
 */

import assert from 'node:assert/strict';
import type { ProductId, RoleName } from '../../types.ts';
import type { Client, TestServer } from './server.ts';

export type DemoKey = 'admin' | 'pm' | 'developer' | 'designer' | 'tester' | 'operations';

export interface DemoAccount {
  key: DemoKey;
  memberId: string;
  email: string;
  role: RoleName;
  products: ProductId[];
}

/** Mirrors the seed in store/db.ts — kept explicit so a seed change is a visible test change. */
export const DEMO_ACCOUNTS: Record<DemoKey, DemoAccount> = {
  admin: {
    key: 'admin',
    memberId: 'm1',
    email: 'amara@techorg.io',
    role: 'Owner',
    products: ['renewberry', 'blog', 'mirror'],
  },
  pm: {
    key: 'pm',
    memberId: 'm2',
    email: 'daniel@techorg.io',
    role: 'Project manager',
    products: ['renewberry'],
  },
  developer: {
    key: 'developer',
    memberId: 'm4',
    email: 'kofi@techorg.io',
    role: 'Developer',
    products: ['renewberry'],
  },
  designer: {
    key: 'designer',
    memberId: 'm9',
    email: 'ines@techorg.io',
    role: 'Designer',
    products: ['renewberry', 'mirror'],
  },
  tester: {
    key: 'tester',
    memberId: 'm10',
    email: 'ravi@techorg.io',
    role: 'Tester',
    products: ['renewberry', 'mirror'],
  },
  operations: {
    key: 'operations',
    memberId: 'm11',
    email: 'grace@techorg.io',
    role: 'Operations',
    products: ['renewberry', 'blog', 'mirror'],
  },
};

export const DEMO_KEYS = Object.keys(DEMO_ACCOUNTS) as DemoKey[];
export const DEMO_PASSWORD = 'devhq-demo';
export const DEMO_MFA_CODE = '246810';

/** One-step demo sign-in. The returned client carries a fully verified session. */
export async function signInAs(app: TestServer, key: DemoKey): Promise<Client> {
  const c = app.client();
  const res = await c.post<{ token: string; member: { role: string } }>('/api/auth/demo', {
    role: key,
  });
  assert.equal(res.status, 200, `demo sign-in ${key}: ${res.text}`);
  assert.equal(res.json.member.role, DEMO_ACCOUNTS[key].role);
  c.token = res.json.token;
  return c;
}

export async function signInAll(app: TestServer): Promise<Record<DemoKey, Client>> {
  const out = {} as Record<DemoKey, Client>;
  for (const k of DEMO_KEYS) out[k] = await signInAs(app, k);
  return out;
}

/** Password step only: the session exists but is limited to the MFA endpoints. */
export async function passwordOnly(
  app: TestServer,
  email: string,
  password = DEMO_PASSWORD,
): Promise<Client> {
  const c = app.client();
  const res = await c.post<{ token: string }>('/api/auth/sign-in', { email, password });
  assert.equal(res.status, 200, `password step for ${email}: ${res.text}`);
  c.token = res.json.token;
  return c;
}

/** Full two-step sign-in (password, then the demo TOTP code). */
export async function fullSignIn(app: TestServer, email: string): Promise<Client> {
  const c = await passwordOnly(app, email);
  const res = await c.post<{ token: string }>('/api/auth/mfa/totp', { code: DEMO_MFA_CODE });
  assert.equal(res.status, 200, `MFA for ${email}: ${res.text}`);
  c.token = res.json.token;
  return c;
}

/**
 * Makes the session demand step-up, the same way production does: the session
 * is seen from a new IP, which clears `verifiedAt`.
 */
export async function forceStepUp(c: Client, newIp: string): Promise<void> {
  c.ip = newIp;
  const res = await c.get('/api/auth/session');
  assert.equal(res.status, 200, res.text);
  assert.equal(res.headers.get('x-step-up-required'), '1');
}

/** Completes step-up with the demo code; the session token rotates. */
export async function stepUp(c: Client): Promise<void> {
  const res = await c.post<{ token: string }>('/api/auth/step-up', { code: DEMO_MFA_CODE });
  assert.equal(res.status, 200, res.text);
  c.token = res.json.token;
}
