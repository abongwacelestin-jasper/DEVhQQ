/**
 * Development seed for collaboration data — the same channels, messages and
 * workspace the frontend shipped locally (data/messaging.ts,
 * data/workspaces.ts), so the UI looks identical after the swap.
 *
 * Loaded only when NODE_ENV !== 'production' and the collection is empty, and
 * only on first use (after B-DATA has hydrated persisted rows at boot).
 */

import { config } from '../../config/env.ts';
import { channels, messages, workspaces } from './store.ts';
import type { Channel, ChannelPermissions, Message, WorkspaceRecord } from './types.ts';

const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

export const defaultPermissions: ChannelPermissions = {
  post: 'members',
  threads: true,
  reactions: true,
  files: true,
  stickers: true,
  externalLinks: false,
  mentionAll: 'admins',
  retentionDays: 365,
  memberInvites: true,
};

const everyone = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11'];

const seedChannels: Channel[] = [
  {
    id: 'general',
    name: 'general',
    kind: 'announcement',
    topic: 'Company-wide updates. Only admins post; everyone can react and reply in threads.',
    members: everyone,
    admins: ['m1'],
    private: false,
    createdBy: 'm1',
    createdAt: ago(60 * 24 * 200),
    background: 'paper',
    permissions: { ...defaultPermissions, post: 'admins', memberInvites: false },
  },
  {
    id: 'rb-v2-4',
    name: 'renewberry-v2-4',
    kind: 'project',
    product: 'renewberry',
    projectId: 'p1',
    topic: 'Release v2.4 — password reset, payment retries, invoice export.',
    members: ['m1', 'm2', 'm4', 'm5', 'm7', 'm9', 'm10', 'm11'],
    admins: ['m2'],
    private: false,
    createdBy: 'm2',
    createdAt: ago(60 * 24 * 30),
    background: 'dots',
    permissions: { ...defaultPermissions },
  },
  {
    id: 'engineering',
    name: 'engineering',
    kind: 'channel',
    topic: 'Code reviews, architecture and dev tooling.',
    members: ['m1', 'm4', 'm5', 'm6', 'm7', 'm8', 'm11'],
    admins: ['m1'],
    private: false,
    createdBy: 'm1',
    createdAt: ago(60 * 24 * 180),
    background: 'grid',
    permissions: { ...defaultPermissions },
  },
  {
    id: 'incidents',
    name: 'incidents',
    kind: 'channel',
    topic: 'Live incident coordination. Production details — restricted.',
    members: ['m1', 'm4', 'm5', 'm11'],
    admins: ['m11'],
    private: true,
    createdBy: 'm11',
    createdAt: ago(60 * 24 * 120),
    background: 'plain',
    permissions: {
      ...defaultPermissions,
      stickers: false,
      retentionDays: 730,
      memberInvites: false,
    },
  },
  {
    id: 'design-crit',
    name: 'design-crit',
    kind: 'channel',
    topic: 'Share work-in-progress. Be kind, be specific.',
    members: ['m1', 'm2', 'm3', 'm9', 'm7'],
    admins: ['m9'],
    private: false,
    createdBy: 'm9',
    createdAt: ago(60 * 24 * 90),
    background: 'doodles',
    permissions: { ...defaultPermissions, externalLinks: true },
  },
  {
    id: 'blog-launch',
    name: 'blog-launch',
    kind: 'project',
    product: 'blog',
    projectId: 'p3',
    topic: 'Editor toolbar, SEO and the November launch.',
    members: ['m1', 'm3', 'm6', 'm8'],
    admins: ['m3'],
    private: false,
    createdBy: 'm3',
    createdAt: ago(60 * 24 * 40),
    background: 'waves',
    permissions: { ...defaultPermissions },
  },
  {
    id: 'dm-m1-m4',
    name: 'Kofi Mensah',
    kind: 'dm',
    topic: '',
    members: ['m1', 'm4'],
    admins: [],
    private: true,
    createdBy: 'm1',
    createdAt: ago(60 * 24 * 60),
    background: 'plain',
    permissions: { ...defaultPermissions, post: 'members' },
  },
  {
    id: 'dm-m1-m11',
    name: 'Grace Liu',
    kind: 'dm',
    topic: '',
    members: ['m1', 'm11'],
    admins: [],
    private: true,
    createdBy: 'm11',
    createdAt: ago(60 * 24 * 60),
    background: 'plain',
    permissions: { ...defaultPermissions },
  },
  {
    id: 'dm-m2-m4',
    name: 'Kofi Mensah',
    kind: 'dm',
    topic: '',
    members: ['m2', 'm4'],
    admins: [],
    private: true,
    createdBy: 'm2',
    createdAt: ago(60 * 24 * 20),
    background: 'plain',
    permissions: { ...defaultPermissions },
  },
  {
    id: 'dm-m4-m5',
    name: 'Lena Fischer',
    kind: 'dm',
    topic: '',
    members: ['m4', 'm5'],
    admins: [],
    private: true,
    createdBy: 'm5',
    createdAt: ago(60 * 24 * 20),
    background: 'plain',
    permissions: { ...defaultPermissions },
  },
];

const m = (
  id: string,
  channelId: string,
  author: string,
  mins: number,
  text: string,
  extra: Partial<Message> = {},
): Message => ({
  id,
  channelId,
  author,
  at: ago(mins),
  kind: 'text',
  text,
  reactions: {},
  ...extra,
});

const seedMessages: Message[] = [
  m(
    'g1',
    'general',
    'm1',
    60 * 26,
    'Welcome Noah to the Blog team! Invite is out — say hi when he joins 👋',
    { reactions: { '🎉': ['m3', 'm6', 'm8', 'm9'], '👋': ['m2', 'm4'] } },
  ),
  m(
    'g2',
    'general',
    'm1',
    60 * 4,
    'Reminder: every account now needs MFA, and sessions lock after 15 minutes idle. Settings → Security if you want a shorter timeout.',
    { pinned: true, reactions: { '👍': ['m2', 'm4', 'm5', 'm11'] } },
  ),
  m('g3', 'general', 'm9', 60 * 3.8, 'Does the idle lock also apply to the code workspace?', {
    threadOf: 'g2',
  }),
  m(
    'g4',
    'general',
    'm1',
    60 * 3.7,
    'Yes — unsaved edits stay in the editor, you just re-enter your code.',
    { threadOf: 'g2' },
  ),

  m(
    'r1',
    'rb-v2-4',
    'm2',
    180,
    'Status check for v2.4: PR #148 still needs 2 reviews and staging failed on migrations. @Kofi can you take the first review?',
  ),
  m(
    'r2',
    'rb-v2-4',
    'm4',
    172,
    'On it after lunch. RB-221 retry logic is done, just addressing Lena’s comments.',
    { reactions: { '🙏': ['m2'] } },
  ),
  m('r3', 'rb-v2-4', 'm5', 165, 'Here’s the backoff I suggested — caps at 5 attempts:', {
    kind: 'code',
    code: {
      lang: 'ts',
      content:
        'const delay = Math.min(30_000, 500 * 2 ** attempt);\nif (attempt >= 5) return markFailed(invoice);\nawait sleep(delay + jitter());',
    },
  }),
  m('r4', 'rb-v2-4', 'm10', 120, '', {
    kind: 'poll',
    poll: {
      question: 'Ship v2.4 on Tuesday or Thursday?',
      options: [
        { label: 'Tuesday', votes: ['m2', 'm10'] },
        { label: 'Thursday', votes: ['m4', 'm5', 'm11'] },
      ],
    },
  }),
  m(
    'r5',
    'rb-v2-4',
    'm11',
    95,
    'Heads up: INC-31 is open on production (5xx at 6.2%). Holding any release until it’s resolved.',
    { pinned: true, reactions: { '👀': ['m2', 'm4', 'm5'] } },
  ),
  m('r6', 'rb-v2-4', 'm9', 40, '', { kind: 'sticker', sticker: 'rocket' }),
  m(
    'r7',
    'rb-v2-4',
    'm9',
    39,
    'Payment method card designs are final — exported to the docs page.',
    { kind: 'file', file: { name: 'payment-card-v3.fig', size: 2_480_000, type: 'design' } },
  ),

  m(
    'e1',
    'engineering',
    'm7',
    300,
    'Anyone else seeing the flaky /health check on mirror staging?',
  ),
  m(
    'e2',
    'engineering',
    'm11',
    290,
    'Yes, tracked as INC-30. Probe timeout is 2s, cold starts take ~2.4s.',
    { threadOf: 'e1' },
  ),
  m(
    'e3',
    'engineering',
    'm4',
    60,
    'Code security flagged a leaked test key in renewberry/web — rotated and fixed in c03e8b1. Pre-commit scanning would have caught it, please install the hook from IDE & dev tools.',
    { reactions: { '✅': ['m1', 'm5'], '🔒': ['m11'] } },
  ),
  m(
    'e4',
    'engineering',
    'm6',
    20,
    'Editor toolbar PR #151 merged 🎉 thanks Sam for the fast review.',
    { reactions: { '🎉': ['m8', 'm1'] } },
  ),

  m(
    'i1',
    'incidents',
    'm11',
    100,
    'Declared INC-31 · SEV2 · renewberry api 5xx. Suspected deploy a41f9c2 (correlated, unproven).',
    { pinned: true },
  ),
  m(
    'i2',
    'incidents',
    'm4',
    92,
    'Looking at the webhook retry path — it may be hammering the DB pool.',
  ),
  m('i3', 'incidents', 'm11', 30, 'Rollback request is with Amara for MFA approval.'),

  m(
    'd1',
    'design-crit',
    'm9',
    200,
    'Two directions for the Mirror onboarding — which reads clearer?',
  ),
  m('d2', 'design-crit', 'm3', 190, 'B. The progress rail makes the 3 steps obvious.', {
    reactions: { '💯': ['m9'] },
  }),
  m('d3', 'design-crit', 'm2', 50, '', { kind: 'sticker', sticker: 'party' }),

  m(
    'b1',
    'blog-launch',
    'm3',
    400,
    'Launch checklist is in Docs → Blog → Launch plan. Owners please tick your items.',
  ),
  m(
    'b2',
    'blog-launch',
    'm8',
    30,
    'SEO meta (#153) is waiting for CI, should be green within the hour.',
  ),

  m(
    'k1',
    'dm-m1-m4',
    'm4',
    240,
    'Hey Amara, are you ok with me moving RB-230 to Lena? I’m over capacity this week.',
  ),
  m('k2', 'dm-m1-m4', 'm1', 230, 'Yes please — use Rebalance in Assignments so it gets logged.'),
  m('k3', 'dm-m1-m4', 'm4', 12, 'Done. Also pushed the retry fix from the code workspace 🙌'),

  m('gl1', 'dm-m1-m11', 'm11', 35, 'Need your MFA approval on the rollback when you have a sec.'),

  m('pk1', 'dm-m2-m4', 'm2', 140, 'Can you estimate RB-230 before Monday planning?'),
  m('pk2', 'dm-m2-m4', 'm4', 130, '5 points. Mostly CSV formatting + permissions check.'),

  m('lk1', 'dm-m4-m5', 'm5', 70, 'Left comments on #152, mostly naming.'),
  m('lk2', 'dm-m4-m5', 'm4', 64, 'Thanks! Fixing now.', { reactions: { '👍': ['m5'] } }),
];

const seedWorkspace = (): WorkspaceRecord => ({
  id: 'ws1',
  name: 'Tech Organization',
  slug: 'techorg',
  color: '#4F46E5',
  template: 'product',
  modules: ['projects', 'engineering', 'delivery', 'operations', 'assistant'],
  mfaRequired: true,
  ownerId: 'm1',
  members: [
    { memberId: 'm1', role: 'owner' },
    ...everyone.slice(1).map((memberId) => ({ memberId, role: 'member' as const })),
  ],
  products: ['renewberry', 'blog', 'mirror'],
  createdAt: ago(60 * 24 * 400),
  updatedAt: ago(60 * 24 * 30),
});

let checked = false;

/** Seeds once per process, only outside production and only into empty collections. */
export function ensureCollabSeed() {
  if (checked) return;
  checked = true;
  if (config.isProd) return;
  if (channels.size === 0 && messages.size === 0) {
    for (const c of seedChannels) channels.set(c.id, c);
    for (const msg of seedMessages) messages.set(msg.id, msg);
  }
  if (workspaces.size === 0) {
    const ws = seedWorkspace();
    workspaces.set(ws.id, ws);
  }
}
