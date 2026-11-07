/**
 * First-Owner bootstrap for an empty production database.
 *
 * Production never seeds demo accounts, so a fresh deployment has no one who
 * can sign in. This one-shot command creates the first Owner as an *invited*
 * member and prints a single-use invite link (valid 7 days). The Owner opens
 * it, sets a password (same policy as every invite), signs in, and enrolls an
 * authenticator on the verification screen. From then on, everyone else is
 * invited from the Team page.
 *
 * Refuses to run when any active Owner already exists, so it cannot be used
 * to mint an extra Owner on a live system.
 *
 *   docker compose stop backend
 *   docker compose run --rm backend node --run bootstrap-owner -- --email you@org.io --name "Your Name"
 *   docker compose start backend
 *
 * (Stop the backend first: each process keeps its own in-memory view, and the
 * running server would not see the new row until it restarts.)
 */

import { parseArgs } from 'node:util';
import { closePersistence, initPersistence } from '../db/boot.ts';
import { db, findMemberByEmail } from '../store/db.ts';
import { hashToken, randomToken } from '../security/crypto.ts';
import { audit } from '../audit/auditLog.ts';
import { config } from '../config/env.ts';
import type { Member } from '../types.ts';

const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

function fail(msg: string): never {
  console.error(`bootstrap-owner: ${msg}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' } },
});
const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();
if (!email || !EMAIL.test(email)) fail('--email is required and must be a valid address');
if (!name || name.length > 120) fail('--name is required (at most 120 characters)');

// No seed: this command only ever adds the first Owner.
await initPersistence(async () => {});

const owners = [...db.members.values()].filter((m) => m.role === 'Owner' && m.status === 'active');
if (owners.length > 0)
  fail(`an active Owner already exists (${owners.length}); invite from the Team page instead`);
if (findMemberByEmail(email)) fail(`a member with ${email} already exists`);

let n = db.members.size + 1;
while (db.members.has(`m${n}`)) n++;
const inviteToken = randomToken(32);
const member: Member = {
  id: `m${n}`,
  name,
  email,
  role: 'Owner',
  products: ['renewberry', 'blog', 'mirror'],
  status: 'invited',
  passwordHash: '!invited',
  passkeys: [],
  failedLogins: 0,
  inviteTokenHash: hashToken(inviteToken),
  inviteExpiresAt: Date.now() + INVITE_TTL_MS,
};
db.members.set(member.id, member);
audit.append({
  actor: 'system',
  action: 'team.owner_bootstrapped',
  target: `${email} · Owner · first owner`,
  sensitive: true,
});
await closePersistence();

console.log(`First Owner ${name} <${email}> created as ${member.id}.`);
console.log(`Single-use invite link (expires ${new Date(member.inviteExpiresAt!).toISOString()}):`);
console.log(`  ${config.appOrigin}/accept-invite?token=${inviteToken}`);
process.exit(0);
