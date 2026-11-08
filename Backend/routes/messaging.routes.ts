/**
 * Messaging: channels, DMs, messages, threads, reactions, pins, polls and the
 * authenticated realtime stream (GET /api/stream).
 *
 * Rules:
 *  - unreadable channels and their messages answer 404 (never 403);
 *  - message bodies are plain text / markdown stored exactly as sent and are
 *    never rendered as HTML by the server; the web app renders them as text;
 *  - posting is rate-limited per member (all sessions and IPs combined);
 *  - deletes are soft: the row becomes a tombstone with no content;
 *  - every state change is audited without the message body.
 */

import { STREAM, type Ctx, type Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { can, requireArea } from '../auth/rbac.ts';
import { randomToken } from '../security/crypto.ts';
import { audit } from '../audit/auditLog.ts';
import { db } from '../store/db.ts';
import { repos } from '../data/index.ts';
import { HttpError, type Principal } from '../types.ts';
import {
  canModerate,
  canPost,
  canReadChannel,
  readableChannel,
  seesProduct,
} from '../domain/collab/access.ts';
import { emit, openStream } from '../domain/collab/realtime.ts';
import { channelReads, channels, messages, sortableId } from '../domain/collab/store.ts';
import { defaultPermissions, ensureCollabSeed } from '../domain/collab/seed.ts';
import { limitMessagePost } from '../domain/collab/limits.ts';
import { excerpt, notify, observeDomainEvents, parseMentions } from '../domain/collab/notify.ts';
import type { Channel, Message } from '../domain/collab/types.ts';

const TEXT_MAX = 4_000;
const memberId = () => v.string({ min: 1, max: 40, pattern: /^[A-Za-z0-9_-]+$/ });
const products = ['renewberry', 'blog', 'mirror'] as const;
const backgrounds = ['plain', 'dots', 'grid', 'waves', 'doodles', 'paper'] as const;

const permissionsBody = v.object({
  post: v.optional(v.enumOf(['everyone', 'members', 'admins'] as const)),
  threads: v.optional(v.boolean()),
  reactions: v.optional(v.boolean()),
  files: v.optional(v.boolean()),
  stickers: v.optional(v.boolean()),
  externalLinks: v.optional(v.boolean()),
  mentionAll: v.optional(v.enumOf(['admins', 'everyone'] as const)),
  retentionDays: v.optional(v.int({ min: 1, max: 3650 })),
  memberInvites: v.optional(v.boolean()),
});

const channelName = () => v.string({ min: 1, max: 80, pattern: /^[a-z0-9][a-z0-9_-]*$/ });

const createChannelBody = v.object({
  kind: v.enumOf(['channel', 'project', 'announcement', 'dm'] as const),
  name: v.optional(channelName()),
  topic: v.optional(v.string({ max: 250 })),
  product: v.optional(v.enumOf(products)),
  projectId: v.optional(v.string({ max: 40 })),
  members: v.optional(v.array(memberId(), { max: 500 })),
  admins: v.optional(v.array(memberId(), { max: 50 })),
  private: v.optional(v.boolean()),
  background: v.optional(v.enumOf(backgrounds)),
  permissions: v.optional(permissionsBody),
});

const patchChannelBody = v.object({
  name: v.optional(channelName()),
  topic: v.optional(v.string({ max: 250 })),
  background: v.optional(v.enumOf(backgrounds)),
  private: v.optional(v.boolean()),
  archived: v.optional(v.boolean()),
  permissions: v.optional(permissionsBody),
  addMembers: v.optional(v.array(memberId(), { max: 500 })),
  removeMembers: v.optional(v.array(memberId(), { max: 500 })),
  addAdmins: v.optional(v.array(memberId(), { max: 50 })),
  removeAdmins: v.optional(v.array(memberId(), { max: 50 })),
});

const postBody = v.object({
  kind: v.optional(v.enumOf(['text', 'code', 'poll', 'sticker', 'file'] as const)),
  text: v.optional(v.string({ max: TEXT_MAX, trim: false })),
  threadOf: v.optional(v.string({ max: 80 })),
  parentId: v.optional(v.string({ max: 80 })),
  code: v.optional(
    v.object({
      lang: v.string({ max: 20, pattern: /^[A-Za-z0-9+#._-]*$/ }),
      content: v.string({ min: 1, max: 20_000, trim: false }),
    }),
  ),
  poll: v.optional(
    v.object({
      question: v.string({ min: 1, max: 300 }),
      options: v.array(v.string({ min: 1, max: 100 }), { max: 10 }),
    }),
  ),
  sticker: v.optional(v.string({ max: 32, pattern: /^[a-z0-9-]+$/ })),
  file: v.optional(
    v.object({
      name: v.string({ min: 1, max: 200 }),
      size: v.int({ min: 0, max: 5 * 1024 * 1024 * 1024 }),
      type: v.string({ min: 1, max: 100 }),
      fileId: v.optional(v.string({ max: 80, pattern: /^[A-Za-z0-9_-]+$/ })),
    }),
  ),
});

const editBody = v.object({
  text: v.optional(v.string({ max: TEXT_MAX, trim: false })),
  pollClosed: v.optional(v.boolean()),
});
// No whitespace and no control characters (a NUL here used to become an object key).
const reactionBody = v.object({
  emoji: v.string({ min: 1, max: 16, pattern: /^[^\s\p{Cc}]+$/u }),
});
const pinBody = v.object({ pinned: v.optional(v.boolean()) });
const voteBody = v.object({ option: v.int({ min: 0, max: 9 }) });
const readBody = v.object({ at: v.optional(v.string({ max: 40 })) });

const nowIso = () => new Date().toISOString();

async function activeMember(id: string) {
  const m = await repos.members.get(id);
  return m && m.status === 'active' ? m : undefined;
}

function encodeCursor(m: Message) {
  return Buffer.from(`${m.at}|${m.id}`, 'utf8').toString('base64url');
}

function decodeCursor(c: string): { at: string; id: string } {
  const raw = Buffer.from(c, 'base64url').toString('utf8');
  const i = raw.indexOf('|');
  if (c.length > 200 || i < 1) throw new HttpError(422, 'validation_failed', 'before is invalid');
  return { at: raw.slice(0, i), id: raw.slice(i + 1) };
}

function order(a: Message, b: Message) {
  return a.at === b.at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.at < b.at ? -1 : 1;
}

function retained(c: Channel, m: Message) {
  return Date.now() - Date.parse(m.at) <= c.permissions.retentionDays * 86_400_000;
}

function replyCounts(channelId: string) {
  const counts = new Map<string, { n: number; last: string }>();
  for (const m of messages.values()) {
    if (m.channelId !== channelId || !m.threadOf || m.deleted) continue;
    const c = counts.get(m.threadOf) ?? { n: 0, last: '' };
    c.n++;
    if (m.at > c.last) c.last = m.at;
    counts.set(m.threadOf, c);
  }
  return counts;
}

function messageView(m: Message, counts?: Map<string, { n: number; last: string }>) {
  const r = counts?.get(m.id);
  return {
    ...m,
    ...(counts && !m.threadOf ? { replyCount: r?.n ?? 0, lastReplyAt: r?.last || undefined } : {}),
  };
}

function channelView(p: Principal, c: Channel) {
  const read = channelReads.get(`${p.memberId}:${c.id}`)?.lastReadAt ?? '';
  let unread = 0;
  let mentions = 0;
  let lastMessageAt: string | undefined;
  for (const m of messages.values()) {
    if (m.channelId !== c.id || m.deleted) continue;
    if (!lastMessageAt || m.at > lastMessageAt) lastMessageAt = m.at;
    if (m.author !== p.memberId && m.at > read && !m.threadOf && c.members.includes(p.memberId)) {
      unread++;
      if (m.mentions?.includes(p.memberId)) mentions++;
    }
  }
  return {
    ...c,
    joined: c.members.includes(p.memberId),
    canPost: canPost(p, c),
    canModerate: canModerate(p, c),
    unread,
    mentions,
    lastMessageAt,
    lastReadAt: read || undefined,
  };
}

function systemMessage(c: Channel, author: string, text: string) {
  const msg: Message = {
    id: sortableId('msg'),
    channelId: c.id,
    author,
    at: nowIso(),
    kind: 'system',
    text,
    reactions: {},
  };
  messages.set(msg.id, msg);
  emit('message.created', { channelId: c.id }, messageView(msg));
}

function findMessage(p: Principal, id: string): { m: Message; c: Channel } {
  const m = messages.get(id);
  const c = m && channels.get(m.channelId);
  if (!m || !c || !canReadChannel(p, c) || !retained(c, m))
    throw new HttpError(404, 'not_found', 'Not found');
  return { m, c };
}

async function notifyMentions(p: Principal, c: Channel, m: Message, ids: string[]) {
  const author = (await repos.members.get(p.memberId))?.name ?? p.memberId;
  for (const id of ids) {
    const viewer = await activeMember(id);
    if (
      !viewer ||
      !canReadChannel({ memberId: id, role: viewer.role, products: viewer.products }, c)
    )
      continue;
    await notify({
      memberId: id,
      kind: 'mention',
      title: c.kind === 'dm' ? `${author} mentioned you` : `${author} mentioned you in #${c.name}`,
      body: excerpt(m.text),
      link: `/messages/${encodeURIComponent(c.id)}?m=${encodeURIComponent(m.id)}`,
      refId: `message:${m.id}`,
      actor: p.memberId,
    });
  }
}

function canReply(p: Principal, c: Channel) {
  if (canPost(p, c)) return true;
  return (
    !c.archived &&
    c.permissions.threads &&
    c.permissions.post === 'admins' &&
    c.members.includes(p.memberId)
  );
}

function auditChange(ctx: Ctx, action: string, target: string, sensitive = false) {
  audit.append({
    actor: ctx.principal!.memberId,
    action,
    target,
    sensitive,
    requestId: ctx.requestId,
  });
}

async function validMembers(ids: string[], product?: string): Promise<string[]> {
  const out: string[] = [];
  for (const id of new Set(ids)) {
    const m = await activeMember(id);
    if (!m) throw new HttpError(422, 'validation_failed', `members: ${id} is not an active member`);
    if (!seesProduct({ memberId: m.id, role: m.role, products: m.products }, product))
      throw new HttpError(422, 'validation_failed', `members: ${id} is not on ${product}`);
    out.push(m.id);
  }
  return out;
}

export function registerMessagingRoutes(r: Router) {
  observeDomainEvents();
  const tag = 'messaging';

  r.add(
    'GET',
    '/api/stream',
    {
      summary: 'Realtime collaboration events (SSE, filtered per subscriber)',
      tag,
      responses: [401, 503],
    },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const last = ctx.req.headers['last-event-id'];
      openStream(ctx.principal!, ctx.res, typeof last === 'string' ? last : undefined);
      return STREAM;
    },
  );

  r.add(
    'GET',
    '/api/channels',
    { summary: 'Channels and DMs visible to the caller', tag },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const includeArchived = ctx.query.get('archived') === '1';
      const items = [...channels.values()]
        .filter((c) => canReadChannel(p, c) && (includeArchived || !c.archived))
        .map((c) => channelView(p, c))
        .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
      return { items };
    },
  );

  r.add(
    'POST',
    '/api/channels',
    { summary: 'Create a channel or start a DM', tag, responses: [401, 403, 404, 422, 429] },
    authenticate,
    requireArea('Project', 'view'),
    async (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const body = parse(createChannelBody, ctx.body);

      if (body.kind === 'dm') {
        const others = (await validMembers(body.members ?? [])).filter((id) => id !== p.memberId);
        if (others.length < 1 || others.length > 8)
          throw new HttpError(422, 'validation_failed', 'members: a DM needs 1–8 other people');
        const everyone = [p.memberId, ...others].sort();
        const existing = [...channels.values()].find(
          (c) => c.kind === 'dm' && [...c.members].sort().join(',') === everyone.join(','),
        );
        if (existing) return channelView(p, existing);
        const names = await repos.members.getMany(others);
        const c: Channel = {
          id: `dm-${randomToken(8)}`,
          name: others.map((id) => names.get(id)?.name ?? id).join(', '),
          kind: 'dm',
          topic: '',
          members: everyone,
          admins: [],
          private: true,
          createdBy: p.memberId,
          createdAt: nowIso(),
          background: body.background ?? 'plain',
          permissions: { ...defaultPermissions, post: 'members', memberInvites: false },
        };
        channels.set(c.id, c);
        auditChange(ctx, 'channel.dm_created', `${c.id} · ${everyone.length} members`);
        for (const id of everyone)
          emit('channel.created', { memberId: id }, channelView({ ...p, memberId: id }, c));
        ctx.status = 201;
        return channelView(p, c);
      }

      if (!body.name) throw new HttpError(422, 'validation_failed', 'name is required');
      if (body.kind === 'announcement' && !can(p, 'Organization', 'admin'))
        throw new HttpError(403, 'forbidden', 'Only Owners create announcement channels');
      let product = body.product;
      if (body.projectId) {
        const project = db.projects.get(body.projectId);
        if (!project || !seesProduct(p, project.product))
          throw new HttpError(404, 'not_found', 'Project not found');
        if (product && product !== project.product)
          throw new HttpError(422, 'validation_failed', 'product does not match the project');
        product = project.product;
      }
      if (body.kind === 'project') {
        if (!product)
          throw new HttpError(422, 'validation_failed', 'project channels need a product');
        if (!can(p, 'Project', 'contribute'))
          throw new HttpError(403, 'forbidden', 'Requires contribute on Project');
      }
      if (product && !seesProduct(p, product)) throw new HttpError(404, 'not_found', 'Not found');
      if (
        [...channels.values()].some((c) => c.kind !== 'dm' && c.name === body.name && !c.archived)
      )
        throw new HttpError(409, 'name_taken', 'A channel with that name already exists');

      const members = await validMembers([p.memberId, ...(body.members ?? [])], product);
      const admins = [p.memberId, ...(body.admins ?? []).filter((id) => members.includes(id))];
      const c: Channel = {
        id: `ch-${randomToken(8)}`,
        name: body.name,
        kind: body.kind,
        topic: body.topic ?? '',
        product,
        projectId: body.projectId,
        members,
        admins: [...new Set(admins)],
        private: body.private ?? false,
        createdBy: p.memberId,
        createdAt: nowIso(),
        background: body.background ?? 'plain',
        permissions: {
          ...defaultPermissions,
          ...(body.kind === 'announcement' ? { post: 'admins' as const } : {}),
          ...Object.fromEntries(
            Object.entries(body.permissions ?? {}).filter(([, val]) => val !== undefined),
          ),
        },
      };
      channels.set(c.id, c);
      auditChange(ctx, 'channel.created', `#${c.name} (${c.id})${c.private ? ' · private' : ''}`);
      systemMessage(c, p.memberId, `created #${c.name}`);
      ctx.status = 201;
      return channelView(p, c);
    },
  );

  r.add(
    'GET',
    '/api/channels/:id',
    { summary: 'One channel', tag, responses: [401, 404] },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      return channelView(ctx.principal!, readableChannel(ctx.principal!, ctx.params.id));
    },
  );

  r.add(
    'PATCH',
    '/api/channels/:id',
    { summary: 'Update channel settings and membership', tag, responses: [401, 403, 404, 422] },
    authenticate,
    async (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const body = parse(patchChannelBody, ctx.body);
      const c = readableChannel(p, ctx.params.id);
      if (c.kind === 'dm') throw new HttpError(403, 'forbidden', 'DMs cannot be changed');
      const moderator = canModerate(p, c);
      const onlyInvites =
        Object.entries(body).every(([k, val]) => val === undefined || k === 'addMembers') &&
        !!body.addMembers;
      if (
        !moderator &&
        !(onlyInvites && c.permissions.memberInvites && c.members.includes(p.memberId))
      )
        throw new HttpError(403, 'forbidden', 'Only channel admins can change this channel');

      const before = { members: c.members.length, admins: c.admins.length };
      if (body.name !== undefined) c.name = body.name;
      if (body.topic !== undefined) c.topic = body.topic;
      if (body.background !== undefined) c.background = body.background;
      if (body.private !== undefined) c.private = body.private;
      if (body.archived !== undefined) c.archived = body.archived;
      if (body.permissions)
        c.permissions = {
          ...c.permissions,
          ...Object.fromEntries(
            Object.entries(body.permissions).filter(([, val]) => val !== undefined),
          ),
        };
      const removed = new Set(body.removeMembers ?? []);
      if (body.addMembers)
        c.members = [
          ...new Set([...c.members, ...(await validMembers(body.addMembers, c.product))]),
        ];
      if (removed.size) c.members = c.members.filter((id) => !removed.has(id));
      if (body.addAdmins)
        c.admins = [
          ...new Set([...c.admins, ...body.addAdmins.filter((id) => c.members.includes(id))]),
        ];
      const dropAdmins = new Set([...(body.removeAdmins ?? []), ...removed]);
      if (dropAdmins.size) c.admins = c.admins.filter((id) => !dropAdmins.has(id));
      if (c.admins.length === 0 && !can(p, 'Organization', 'admin'))
        throw new HttpError(409, 'last_admin', 'A channel needs at least one admin');
      channels.save(c.id);

      auditChange(
        ctx,
        'channel.updated',
        `#${c.name} (${c.id}) · ${Object.keys(body)
          .filter((k) => body[k as keyof typeof body] !== undefined)
          .join(', ')} · members ${before.members}→${c.members.length}`,
      );
      emit('channel.updated', { channelId: c.id }, c);
      for (const id of removed) emit('channel.removed', { memberId: id }, { id: c.id });
      return channelView(p, c);
    },
  );

  r.add(
    'POST',
    '/api/channels/:id/join',
    { summary: 'Join a public channel', tag, responses: [401, 403, 404] },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const c = readableChannel(p, ctx.params.id);
      if (c.kind === 'dm' || c.private || c.archived)
        throw new HttpError(403, 'forbidden', 'Ask a channel admin to add you');
      if (!c.members.includes(p.memberId)) {
        c.members.push(p.memberId);
        channels.save(c.id);
        auditChange(ctx, 'channel.joined', `#${c.name} (${c.id})`);
        systemMessage(c, p.memberId, 'joined the channel');
        emit('channel.updated', { channelId: c.id }, c);
      }
      return channelView(p, c);
    },
  );

  r.add(
    'POST',
    '/api/channels/:id/leave',
    { summary: 'Leave a channel', tag, responses: [401, 404, 409] },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const c = readableChannel(p, ctx.params.id);
      if (c.kind === 'dm') throw new HttpError(409, 'dm_leave', 'You can’t leave a DM');
      if (c.members.includes(p.memberId)) {
        if (c.admins.length === 1 && c.admins[0] === p.memberId && c.members.length > 1)
          throw new HttpError(409, 'last_admin', 'Make someone else an admin before leaving');
        c.members = c.members.filter((id) => id !== p.memberId);
        c.admins = c.admins.filter((id) => id !== p.memberId);
        channels.save(c.id);
        auditChange(ctx, 'channel.left', `#${c.name} (${c.id})`);
        systemMessage(c, p.memberId, 'left the channel');
        emit('channel.updated', { channelId: c.id }, c);
      }
      return canReadChannel(p, c) ? channelView(p, c) : { id: c.id, left: true };
    },
  );

  r.add(
    'POST',
    '/api/channels/:id/read',
    { summary: 'Mark a channel read up to now (or `at`)', tag, responses: [401, 404, 422] },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const { at } = parse(readBody, ctx.body ?? {});
      const c = readableChannel(p, ctx.params.id);
      const when = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : nowIso();
      const key = `${p.memberId}:${c.id}`;
      const prev = channelReads.get(key)?.lastReadAt ?? '';
      if (when > prev)
        channelReads.set(key, { memberId: p.memberId, channelId: c.id, lastReadAt: when });
      return { channelId: c.id, lastReadAt: channelReads.get(key)?.lastReadAt ?? when };
    },
  );

  r.add(
    'GET',
    '/api/channels/:id/messages',
    {
      summary: 'Messages, newest page first (?before=cursor&limit=&thread=messageId)',
      tag,
      responses: [401, 404, 422],
    },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const c = readableChannel(p, ctx.params.id);
      const limit = Math.min(100, Math.max(1, Number(ctx.query.get('limit') ?? 50) || 50));
      const thread = ctx.query.get('thread');
      const before = ctx.query.get('before');
      const cursor = before ? decodeCursor(before) : undefined;
      if (thread) {
        const parent = messages.get(thread);
        if (!parent || parent.channelId !== c.id)
          throw new HttpError(404, 'not_found', 'Not found');
      }
      const all = [...messages.values()]
        .filter(
          (m) =>
            m.channelId === c.id &&
            retained(c, m) &&
            (thread ? m.threadOf === thread : !m.threadOf) &&
            (!cursor || m.at < cursor.at || (m.at === cursor.at && m.id < cursor.id)),
        )
        .sort(order);
      const page = all.slice(Math.max(0, all.length - limit));
      const counts = thread ? undefined : replyCounts(c.id);
      return {
        items: page.map((m) => messageView(m, counts)),
        ...(all.length > page.length && page.length ? { nextCursor: encodeCursor(page[0]) } : {}),
        ...(thread ? { parent: messageView(messages.get(thread)!) } : {}),
      };
    },
  );

  r.add(
    'GET',
    '/api/channels/:id/pins',
    { summary: 'Pinned messages in a channel', tag, responses: [401, 404] },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const c = readableChannel(ctx.principal!, ctx.params.id);
      return {
        items: [...messages.values()]
          .filter((m) => m.channelId === c.id && m.pinned && !m.deleted && retained(c, m))
          .sort(order),
      };
    },
  );

  r.add(
    'POST',
    '/api/channels/:id/messages',
    {
      summary: 'Post a message (text, code, poll, sticker, file) or thread reply',
      tag,
      responses: [401, 403, 404, 422, 429],
    },
    authenticate,
    async (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const c = readableChannel(p, ctx.params.id);
      await limitMessagePost(ctx);
      const body = parse(postBody, ctx.body);
      const kind =
        body.kind ??
        (body.poll
          ? 'poll'
          : body.code
            ? 'code'
            : body.sticker
              ? 'sticker'
              : body.file
                ? 'file'
                : 'text');
      const text = body.text ?? '';
      const parentRef = body.threadOf ?? body.parentId;

      let threadOf: string | undefined;
      if (parentRef) {
        const parent = messages.get(parentRef);
        if (!parent || parent.channelId !== c.id || parent.deleted)
          throw new HttpError(404, 'not_found', 'Thread not found');
        if (!c.permissions.threads)
          throw new HttpError(403, 'threads_disabled', 'Threads are off in this channel');
        threadOf = parent.threadOf ?? parent.id;
      }
      if (!(threadOf ? canReply(p, c) : canPost(p, c)))
        throw new HttpError(
          403,
          'forbidden',
          c.archived ? 'This channel is archived' : 'You can’t post in this channel',
        );

      if (kind === 'text' && !text.trim())
        throw new HttpError(422, 'validation_failed', 'text is required');
      if (kind === 'code' && !body.code)
        throw new HttpError(422, 'validation_failed', 'code is required');
      if (kind === 'poll') {
        if (!body.poll) throw new HttpError(422, 'validation_failed', 'poll is required');
        if (body.poll.options.length < 2)
          throw new HttpError(422, 'validation_failed', 'poll.options needs at least 2 options');
      }
      if (kind === 'sticker') {
        if (!body.sticker) throw new HttpError(422, 'validation_failed', 'sticker is required');
        if (!c.permissions.stickers)
          throw new HttpError(403, 'stickers_disabled', 'Stickers are off in this channel');
      }
      if (kind === 'file') {
        if (!body.file) throw new HttpError(422, 'validation_failed', 'file is required');
        if (!c.permissions.files)
          throw new HttpError(403, 'files_disabled', 'Files are off in this channel');
      }
      if (!c.permissions.externalLinks && /\bhttps?:\/\//i.test(text))
        throw new HttpError(422, 'links_disabled', 'External links are off in this channel');

      const mentions = await parseMentions(text);
      const msg: Message = {
        id: sortableId('msg'),
        channelId: c.id,
        author: p.memberId,
        at: nowIso(),
        kind,
        text,
        reactions: {},
        ...(threadOf ? { threadOf } : {}),
        ...(mentions.length ? { mentions } : {}),
        ...(kind === 'code' && body.code ? { code: body.code } : {}),
        ...(kind === 'sticker' ? { sticker: body.sticker } : {}),
        ...(kind === 'file' ? { file: body.file } : {}),
        ...(kind === 'poll' && body.poll
          ? {
              poll: {
                question: body.poll.question,
                options: body.poll.options.map((label) => ({ label, votes: [] })),
              },
            }
          : {}),
      };
      messages.set(msg.id, msg);
      // Posting implies the author has read the channel up to here.
      channelReads.set(`${p.memberId}:${c.id}`, {
        memberId: p.memberId,
        channelId: c.id,
        lastReadAt: msg.at,
      });
      auditChange(
        ctx,
        'message.posted',
        `${c.id} · ${msg.id} · ${kind}${threadOf ? ' · reply' : ''}`,
      );
      emit('message.created', { channelId: c.id }, messageView(msg));
      await notifyMentions(p, c, msg, mentions);
      ctx.status = 201;
      return messageView(msg);
    },
  );

  r.add(
    'PATCH',
    '/api/messages/:id',
    { summary: 'Edit your message, or close your poll', tag, responses: [401, 403, 404, 409, 422] },
    authenticate,
    async (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const body = parse(editBody, ctx.body);
      const { m, c } = findMessage(p, ctx.params.id);
      if (m.deleted) throw new HttpError(409, 'deleted', 'Message was deleted');
      if (m.kind === 'system')
        throw new HttpError(403, 'forbidden', 'System messages can’t be edited');
      const isAuthor = m.author === p.memberId;

      if (body.text !== undefined) {
        if (!isAuthor) throw new HttpError(403, 'forbidden', 'Only the author can edit a message');
        if (c.archived) throw new HttpError(403, 'forbidden', 'This channel is archived');
        if (m.kind === 'text' && !body.text.trim())
          throw new HttpError(422, 'validation_failed', 'text is required');
        if (!c.permissions.externalLinks && /\bhttps?:\/\//i.test(body.text))
          throw new HttpError(422, 'links_disabled', 'External links are off in this channel');
        const before = new Set(m.mentions ?? []);
        m.text = body.text;
        m.edited = true;
        m.editedAt = nowIso();
        const mentions = await parseMentions(body.text);
        if (mentions.length) m.mentions = mentions;
        else delete m.mentions;
        await notifyMentions(
          p,
          c,
          m,
          mentions.filter((id) => !before.has(id)),
        );
      }
      if (body.pollClosed !== undefined) {
        if (!m.poll) throw new HttpError(422, 'validation_failed', 'Not a poll');
        if (!isAuthor && !canModerate(p, c))
          throw new HttpError(
            403,
            'forbidden',
            'Only the author or a channel admin can close a poll',
          );
        m.poll.closed = body.pollClosed;
      }
      messages.save(m.id);
      auditChange(ctx, 'message.edited', `${c.id} · ${m.id}`);
      emit('message.updated', { channelId: c.id }, messageView(m));
      return messageView(m);
    },
  );

  r.add(
    'DELETE',
    '/api/messages/:id',
    {
      summary: 'Delete a message (author or channel admin) — leaves a tombstone',
      tag,
      responses: [401, 403, 404],
    },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const { m, c } = findMessage(p, ctx.params.id);
      const isAuthor = m.author === p.memberId;
      if (!isAuthor && !canModerate(p, c))
        throw new HttpError(403, 'forbidden', 'Only the author or a channel admin can delete this');
      if (!m.deleted) {
        m.deleted = true;
        m.deletedBy = p.memberId;
        m.deletedAt = nowIso();
        m.text = '';
        m.reactions = {};
        delete m.code;
        delete m.poll;
        delete m.file;
        delete m.sticker;
        delete m.mentions;
        delete m.pinned;
        delete m.pinnedBy;
        messages.save(m.id);
        auditChange(
          ctx,
          'message.deleted',
          `${c.id} · ${m.id}${isAuthor ? '' : ` · by moderator (author ${m.author})`}`,
          !isAuthor,
        );
        emit('message.deleted', { channelId: c.id }, messageView(m));
      }
      ctx.status = 200;
      return messageView(m);
    },
  );

  r.add(
    'POST',
    '/api/messages/:id/reactions',
    { summary: 'Toggle your reaction on a message', tag, responses: [401, 403, 404, 409, 422] },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const { emoji } = parse(reactionBody, ctx.body);
      const { m, c } = findMessage(p, ctx.params.id);
      if (m.deleted) throw new HttpError(409, 'deleted', 'Message was deleted');
      if (!c.permissions.reactions || c.archived)
        throw new HttpError(403, 'reactions_disabled', 'Reactions are off in this channel');
      const who = m.reactions[emoji] ?? [];
      if (!who.length && Object.keys(m.reactions).length >= 50)
        throw new HttpError(422, 'validation_failed', 'Too many different reactions');
      const next = who.includes(p.memberId)
        ? who.filter((x) => x !== p.memberId)
        : [...who, p.memberId];
      if (next.length) m.reactions[emoji] = next;
      else delete m.reactions[emoji];
      messages.save(m.id);
      auditChange(
        ctx,
        'message.reacted',
        `${c.id} · ${m.id} · ${next.includes(p.memberId) ? 'add' : 'remove'}`,
      );
      emit('message.updated', { channelId: c.id }, messageView(m));
      return messageView(m);
    },
  );

  r.add(
    'POST',
    '/api/messages/:id/pin',
    {
      summary: 'Pin or unpin a message (toggles when `pinned` is omitted)',
      tag,
      responses: [401, 403, 404, 409],
    },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const { pinned } = parse(pinBody, ctx.body ?? {});
      const { m, c } = findMessage(p, ctx.params.id);
      if (m.deleted) throw new HttpError(409, 'deleted', 'Message was deleted');
      if (!canPost(p, c) && !canModerate(p, c))
        throw new HttpError(403, 'forbidden', 'You can’t pin in this channel');
      const next = pinned ?? !m.pinned;
      if (next) {
        m.pinned = true;
        m.pinnedBy = p.memberId;
      } else {
        delete m.pinned;
        delete m.pinnedBy;
      }
      messages.save(m.id);
      auditChange(ctx, next ? 'message.pinned' : 'message.unpinned', `${c.id} · ${m.id}`);
      emit('message.updated', { channelId: c.id }, messageView(m));
      return messageView(m);
    },
  );

  r.add(
    'POST',
    '/api/messages/:id/vote',
    {
      summary: 'Vote on a poll (toggles; one option per member)',
      tag,
      responses: [401, 403, 404, 409, 422],
    },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const { option } = parse(voteBody, ctx.body);
      const { m, c } = findMessage(p, ctx.params.id);
      if (!m.poll || m.deleted) throw new HttpError(404, 'not_found', 'Poll not found');
      if (m.poll.closed || c.archived)
        throw new HttpError(409, 'poll_closed', 'This poll is closed');
      if (option >= m.poll.options.length)
        throw new HttpError(422, 'validation_failed', 'option is out of range');
      m.poll.options = m.poll.options.map((o, i) => ({
        ...o,
        votes:
          i === option
            ? o.votes.includes(p.memberId)
              ? o.votes.filter((x) => x !== p.memberId)
              : [...o.votes, p.memberId]
            : o.votes.filter((x) => x !== p.memberId),
      }));
      messages.save(m.id);
      auditChange(ctx, 'message.voted', `${c.id} · ${m.id}`);
      emit('message.updated', { channelId: c.id }, messageView(m));
      return messageView(m);
    },
  );
}
