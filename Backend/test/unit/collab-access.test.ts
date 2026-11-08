import '../setup.ts';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { db, seed } from '../../store/db.ts';
import { repos } from '../../data/index.ts';
import {
  canModerate,
  canPost,
  canReadChannel,
  currentViewer,
  readableChannel,
  seesProduct,
  type Viewer,
} from '../../domain/collab/access.ts';
import { channels, sortableId } from '../../domain/collab/store.ts';
import { defaultPermissions } from '../../domain/collab/seed.ts';
import { emit, openStream, streamStats } from '../../domain/collab/realtime.ts';
import {
  excerpt,
  notify,
  observeDomainEvents,
  parseMentions,
  publicNotification,
  settleObservers,
} from '../../domain/collab/notify.ts';
import { publish } from '../../lib/events.ts';
import {
  ndaCurrent,
  needsOnboarding,
  onboardingView,
  stageOf,
} from '../../domain/collab/onboarding.ts';
import { NDA_TEXT_HASH, NDA_VERSION, ndaText } from '../../domain/collab/nda.ts';
import { lineDiff } from '../../domain/collab/diff.ts';
import type { Channel, PostPolicy } from '../../domain/collab/types.ts';
import { HttpError, type Member, type ProductId, type RoleName } from '../../types.ts';
import { rng } from '../helpers/random.ts';

const V = (memberId: string, role: RoleName, products: ProductId[]): Viewer => ({
  memberId,
  role,
  products,
});
const owner = V('o1', 'Owner', []);
const devRB = V('d1', 'Developer', ['renewberry']);
const devBlog = V('d2', 'Developer', ['blog']);
const ops = V('op', 'Operations', ['renewberry', 'blog', 'mirror']);

let seq = 0;
function channel(over: Partial<Channel> = {}): Channel {
  return {
    id: `ch-test-${++seq}`,
    name: 'test',
    kind: 'channel',
    topic: '',
    members: [],
    admins: [],
    private: false,
    createdBy: 'o1',
    createdAt: new Date(0).toISOString(),
    background: 'plain',
    permissions: { ...defaultPermissions },
    ...over,
  };
}

/** Seeded members, read once (repository rows are copies). */
const people = new Map<string, Member>();

before(async () => {
  await seed();
  for (const m of await repos.members.list()) people.set(m.id, m);
});

describe('collab/access — reading channels', () => {
  it('public, unscoped channels are readable by every viewer', () => {
    const c = channel();
    for (const v of [owner, devRB, devBlog, ops]) assert.equal(canReadChannel(v, c), true, v.role);
  });

  it('product channels need the product (Owners see every product)', () => {
    const c = channel({ product: 'renewberry' });
    assert.equal(canReadChannel(devRB, c), true);
    assert.equal(canReadChannel(devBlog, c), false);
    assert.equal(canReadChannel(owner, c), true);
    assert.equal(seesProduct(devBlog, undefined), true);
  });

  it('DMs and private channels: members only — Owners included, no peeking', () => {
    for (const c of [
      channel({ kind: 'dm', members: ['d1', 'd2'] }),
      channel({ private: true, members: ['d1', 'd2'] }),
    ]) {
      assert.equal(canReadChannel(devRB, c), true);
      assert.equal(canReadChannel(devBlog, c), true);
      assert.equal(canReadChannel(owner, c), false, 'Owner is not a member');
      assert.equal(canReadChannel(ops, c), false);
    }
  });

  it('private + product: membership and product are both required', () => {
    const c = channel({ private: true, product: 'renewberry', members: ['d2'] });
    assert.equal(canReadChannel(devBlog, c), false, 'member but not on the product');
  });

  it('readableChannel answers 404 for unreadable or unknown channels', () => {
    const c = channel({ private: true, members: ['d1'] });
    channels.set(c.id, c);
    assert.equal(readableChannel(devRB, c.id), c);
    for (const [v, id] of [
      [devBlog, c.id],
      [devRB, 'nope'],
    ] as const)
      assert.throws(
        () => readableChannel(v, id),
        (e: unknown) => e instanceof HttpError && e.status === 404,
      );
  });
});

describe('collab/access — moderation and posting (table)', () => {
  it('moderators: channel admins and Organization admins, never in DMs', () => {
    const c = channel({ admins: ['d1'], members: ['d1', 'd2'] });
    assert.equal(canModerate(devRB, c), true, 'channel admin');
    assert.equal(canModerate(devBlog, c), false, 'plain member');
    assert.equal(canModerate(owner, c), true, 'org admin');
    assert.equal(canModerate(ops, c), false, 'Operations is not Organization:admin');
    const dm = channel({ kind: 'dm', members: ['o1', 'd1'], admins: ['o1'] });
    assert.equal(canModerate(owner, dm), false);
    const hidden = channel({ private: true, members: ['d1'] });
    assert.equal(canModerate(owner, hidden), false, 'cannot moderate what you cannot read');
  });

  const policies: PostPolicy[] = ['everyone', 'members', 'admins'];
  // [viewer, isMember, isAdmin] → expected canPost for each policy
  const rows: [string, Viewer, boolean, boolean, Record<PostPolicy, boolean>][] = [
    ['admin member', devRB, true, true, { everyone: true, members: true, admins: true }],
    ['plain member', devRB, true, false, { everyone: true, members: true, admins: false }],
    ['non-member', devRB, false, false, { everyone: true, members: false, admins: false }],
    ['org admin non-member', owner, false, false, { everyone: true, members: false, admins: true }],
  ];
  for (const [label, v, member, admin, expected] of rows)
    for (const post of policies)
      it(`${label} · post=${post} → ${expected[post]}`, () => {
        const c = channel({
          members: member ? [v.memberId] : [],
          admins: admin ? [v.memberId] : [],
          permissions: { ...defaultPermissions, post },
        });
        assert.equal(canPost(v, c), expected[post]);
      });

  it('archived channels and unreadable channels refuse every post', () => {
    assert.equal(canPost(owner, channel({ archived: true, admins: ['o1'] })), false);
    assert.equal(canPost(devBlog, channel({ product: 'renewberry' })), false);
  });

  it('DMs accept posts from their members only, whatever the policy says', () => {
    const dm = channel({
      kind: 'dm',
      members: ['d1', 'd2'],
      permissions: { ...defaultPermissions, post: 'everyone' },
    });
    assert.equal(canPost(devRB, dm), true);
    assert.equal(canPost(owner, dm), false);
  });
});

describe('collab/access — current viewer', () => {
  it('reflects the member’s live role and products; inactive members have none', async () => {
    assert.deepEqual(await currentViewer('m4'), {
      memberId: 'm4',
      role: 'Developer',
      products: ['renewberry'],
    });
    assert.equal(await currentViewer('m12'), undefined, 'invited');
    assert.equal(await currentViewer('ghost'), undefined);
  });
});

/** Minimal ServerResponse for SSE: records frames, supports close. */
class FakeRes extends EventEmitter {
  frames: string[] = [];
  writableEnded = false;
  destroyed = false;
  writableLength = 0;
  status = 0;
  writeHead(status: number) {
    this.status = status;
    return this;
  }
  write(chunk: string) {
    this.frames.push(chunk);
    return true;
  }
  end() {
    this.writableEnded = true;
    return this;
  }
  events() {
    return this.frames.filter((f) => f.startsWith('id: ')).map((f) => /event: (\S+)/.exec(f)![1]);
  }
}

function principal(memberId: string) {
  const m = people.get(memberId)!;
  return {
    memberId,
    role: m.role,
    products: m.products,
    sessionId: `sess-${memberId}`,
    verifiedAt: 0,
    elevations: [],
  };
}

describe('collab/realtime — per-subscriber filtering at delivery time', () => {
  it('channel events reach only subscribers who can read the channel now', () => {
    const priv = channel({ private: true, members: ['m4', 'm5'] });
    channels.set(priv.id, priv);
    const a = new FakeRes();
    const b = new FakeRes();
    const boss = new FakeRes();
    openStream(principal('m4'), a as unknown as ServerResponse);
    openStream(principal('m9'), b as unknown as ServerResponse);
    openStream(principal('m1'), boss as unknown as ServerResponse);
    emit('message.created', { channelId: priv.id }, { text: 'secret' });
    assert.deepEqual(a.events(), ['message.created']);
    assert.deepEqual(b.events(), [], 'non-member');
    assert.deepEqual(boss.events(), [], 'Owner is not a member of a private channel');

    // Leaving the channel stops delivery immediately.
    priv.members = ['m5'];
    emit('message.created', { channelId: priv.id }, { text: 'after' });
    assert.equal(a.events().length, 1);
    for (const r of [a, b, boss]) r.emit('close');
  });

  it('member events go only to the addressed member', () => {
    const a = new FakeRes();
    const b = new FakeRes();
    openStream(principal('m4'), a as unknown as ServerResponse);
    openStream(principal('m5'), b as unknown as ServerResponse);
    emit('notification.created', { memberId: 'm5' }, { id: 'n' });
    assert.deepEqual(a.events(), []);
    assert.deepEqual(b.events(), ['notification.created']);
    a.emit('close');
    b.emit('close');
  });

  it('Last-Event-ID replay is filtered by the same rules', () => {
    const pub = channel();
    const priv = channel({ private: true, members: ['m10'] });
    channels.set(pub.id, pub);
    channels.set(priv.id, priv);
    const before = streamStats().lastEventId;
    emit('message.created', { channelId: pub.id }, {});
    emit('message.created', { channelId: priv.id }, {});
    emit('notification.created', { memberId: 'm10' }, {});
    const r = new FakeRes();
    openStream(principal('m9'), r as unknown as ServerResponse, String(before));
    assert.deepEqual(r.events(), ['message.created'], 'only the public channel event');
    r.emit('close');
  });

  it('caps streams per member: the oldest is superseded', () => {
    const open = Array.from({ length: 6 }, () => new FakeRes());
    for (const r of open) openStream(principal('m7'), r as unknown as ServerResponse);
    assert.equal(open[0].writableEnded, true);
    assert.ok(open[0].frames.some((f) => f.includes('superseded')));
    assert.ok(open.slice(1).every((r) => !r.writableEnded));
    for (const r of open) r.emit('close');
  });

  it('drops slow consumers instead of buffering without bound', () => {
    const pub = channel();
    channels.set(pub.id, pub);
    const r = new FakeRes();
    openStream(principal('m4'), r as unknown as ServerResponse);
    r.writableLength = 600 * 1024;
    emit('message.created', { channelId: pub.id }, {});
    assert.equal(r.writableEnded, true);
    assert.ok(r.frames.some((f) => f.includes('slow_consumer')));
  });
});

describe('collab/notify', () => {
  it('excerpt flattens whitespace and caps length', () => {
    assert.equal(excerpt('  a \n\n b\tc  '), 'a b c');
    const long = excerpt('x'.repeat(500));
    assert.equal(long.length, 200);
    assert.ok(long.endsWith('…'));
  });

  it('parses @mentions of active members only, once each', async () => {
    assert.deepEqual((await parseMentions('hi @m4 and @m5, also @m4 again')).sort(), ['m4', 'm5']);
    assert.deepEqual(await parseMentions('@m12 is invited, @ghost unknown'), []);
    assert.deepEqual(await parseMentions('mail me@m4.dev or x@m4'), [], 'emails are not mentions');
  });

  it('never notifies the actor or inactive members, and collapses unread duplicates', async () => {
    const base = {
      kind: 'mention' as const,
      title: 't',
      body: 'b',
      link: '/x',
      refId: `ref-${sortableId('t')}`,
    };
    assert.equal(await notify({ ...base, memberId: 'm4', actor: 'm4' }), undefined, 'self');
    assert.equal(await notify({ ...base, memberId: 'm12', actor: 'm1' }), undefined, 'invited');
    const first = (await notify({ ...base, memberId: 'm4', actor: 'm1' }))!;
    const again = (await notify({ ...base, memberId: 'm4', actor: 'm2' }))!;
    assert.equal(again.id, first.id);
    await repos.notifications.markRead('m4', [first.id], new Date().toISOString());
    const fresh = (await notify({ ...base, memberId: 'm4', actor: 'm2' }))!;
    assert.notEqual(fresh.id, first.id, 'a read notification does not swallow a new one');
    assert.ok(await repos.notifications.get(fresh.id));
  });

  it('bodies are short plain excerpts; the public view hides delivery internals', async () => {
    const n = (await notify({
      memberId: 'm5',
      actor: 'm1',
      kind: 'doc-comment',
      title: 'T'.repeat(300),
      body: 'b '.repeat(300),
      link: '/docs/x',
      refId: `ref-${sortableId('d')}`,
    }))!;
    assert.ok(n.title.length <= 140 && n.body.length <= 200);
    const view = publicNotification(n);
    assert.equal('memberId' in view, false);
    assert.equal('emailedAt' in view, false);
    assert.equal(view.read, false);
  });

  it('sortable ids increase monotonically', () => {
    const ids = Array.from({ length: 200 }, () => sortableId('x'));
    assert.deepEqual([...ids].sort(), ids);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('collab/notify — domain observers', () => {
  const unread = async (memberId: string, refId: string) =>
    (await repos.notifications.list(memberId)).filter((n) => n.refId === refId && !n.readAt);

  it('a task assignment notifies the assignee', async () => {
    observeDomainEvents();
    observeDomainEvents(); // idempotent: one subscription per process
    publish('task', { key: 'RB-226', change: 'assignee' });
    await settleObservers();
    const t = (await repos.tasks.get('RB-226'))!;
    const got = await unread(t.assignee, `task:RB-226:assignee:${t.assignee}`);
    assert.equal(got.length, 1, 'exactly one, even with a second observeDomainEvents()');
    assert.equal(got[0].kind, 'assignment');
    assert.equal(got[0].link, '/tasks/RB-226');
  });

  it('a production deploy awaiting approval notifies every eligible approver but the requester', async () => {
    const d = db.deployments.get('d-1044')!; // blog, requested by m6
    publish('deployment', { id: d.id });
    await settleObservers();
    const approvers = (await repos.notifications.list())
      .filter((n) => n.refId === `deployment:${d.id}` && !n.readAt)
      .map((n) => n.memberId)
      .sort();
    assert.deepEqual(approvers, ['m1', 'm11'], 'Deployment:manage and sees blog');
    // Once decided, the pending approval notifications are closed.
    d.status = 'running';
    publish('deployment', { id: d.id });
    await settleObservers();
    assert.equal((await unread('m11', `deployment:${d.id}`)).length, 0);
    d.status = 'awaiting-approval';
  });

  it('events for unknown records are ignored', async () => {
    const before = (await repos.notifications.list()).length;
    publish('task', { key: 'NOPE-1', change: 'created' });
    publish('deployment', { id: 'd-nope' });
    await settleObservers();
    assert.equal((await repos.notifications.list()).length, before);
  });
});

describe('collab/onboarding', () => {
  const member = (role: RoleName, over: Partial<Member> = {}) => ({
    ...people.get('m4')!,
    role,
    ...over,
  });

  it('every role but Owner onboards', () => {
    assert.equal(needsOnboarding(member('Owner')), false);
    for (const r of [
      'Project manager',
      'Developer',
      'Designer',
      'Tester',
      'Operations',
    ] as RoleName[])
      assert.equal(needsOnboarding(member(r)), true, r);
  });

  it('stage: nda → profile → ready; an outdated NDA version means re-signing', () => {
    const fresh = member('Developer', {
      ndaSignedAt: undefined,
      ndaVersion: undefined,
      profile: undefined,
    });
    assert.equal(stageOf(fresh), 'nda');
    const signed = { ...fresh, ndaSignedAt: new Date().toISOString(), ndaVersion: NDA_VERSION };
    assert.equal(stageOf(signed), 'profile');
    const old = { ...signed, ndaVersion: '1.0' };
    assert.equal(ndaCurrent(old), false);
    assert.equal(stageOf(old), 'nda');
    assert.equal(stageOf(member('Owner', { ndaSignedAt: undefined })), 'ready');
    const view = onboardingView(fresh);
    assert.equal(view.nda.textHash, NDA_TEXT_HASH);
    assert.equal(view.profileComplete, false);
  });

  it('the NDA hash is the SHA-256 of the canonical text and pins the version', () => {
    assert.match(NDA_TEXT_HASH, /^[0-9a-f]{64}$/);
    assert.ok(ndaText().startsWith(`Mutual Non-Disclosure Agreement v${NDA_VERSION}`));
    assert.equal(ndaText(), ndaText());
  });
});

describe('collab/diff — line diff (property)', () => {
  const r = rng(21);
  const pool = ['a', 'b', 'c', '# h', '', '- [ ] x'];
  const doc = () => Array.from({ length: r.int(0, 30) }, () => r.pick(pool)).join('\n');

  it('equal+remove rebuild the old text, equal+add the new; counts match', () => {
    for (let i = 0; i < 300; i++) {
      const a = doc();
      const b = r.bool() ? doc() : a.replace('b', 'B');
      const { ops, added, removed } = lineDiff(a, b);
      assert.equal(
        ops
          .filter((o) => o.op !== 'add')
          .map((o) => o.line)
          .join('\n'),
        a,
      );
      assert.equal(
        ops
          .filter((o) => o.op !== 'remove')
          .map((o) => o.line)
          .join('\n'),
        b,
      );
      assert.equal(added, ops.filter((o) => o.op === 'add').length);
      assert.equal(removed, ops.filter((o) => o.op === 'remove').length);
    }
  });

  it('identical texts produce only equal ops', () => {
    const { ops, added, removed } = lineDiff('x\ny', 'x\ny');
    assert.deepEqual([added, removed], [0, 0]);
    assert.ok(ops.every((o) => o.op === 'equal'));
  });

  it('degrades to replace-all above the cell budget instead of quadratic memory', () => {
    const a = Array.from({ length: 2100 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 2100 }, (_, i) => `b${i}`).join('\n');
    const { added, removed } = lineDiff(a, b);
    assert.deepEqual([added, removed], [2100, 2100]);
  });
});
