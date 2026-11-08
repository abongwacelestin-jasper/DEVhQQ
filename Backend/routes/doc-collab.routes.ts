/**
 * Doc collaboration: versions and inline comments.
 *
 * Readability mirrors routes/docs.routes.ts exactly (product scope, and
 * `restricted` docs only for editors and Owners); an unreadable doc is 404
 * for every sub-resource too.
 *
 * Versions are full-body snapshots (diffable via /diff). They are taken:
 *  - on explicit save (POST …/versions),
 *  - whenever a published doc's content changes (observed from the audit
 *    stream of docs.routes.ts, which this lane doesn't edit),
 *  - around a restore (the pre-restore state is kept, so restore is undoable).
 * Restore needs Project:contribute. Comments need Project:view; resolving
 * needs the comment author, a doc editor, or Project:manage.
 */

import type { Ctx, Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { can, canSeeProduct, hasOwnerPowers, requireArea } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { subscribe } from '../lib/events.ts';
import { db } from '../store/db.ts';
import { repos } from '../data/index.ts';
import type { Member } from '../types.ts';
import { HttpError, type Principal, type ProjectDoc } from '../types.ts';
import { docComments, docVersions, saveDoc, sortableId } from '../domain/collab/store.ts';
import { lineDiff } from '../domain/collab/diff.ts';
import { excerpt, notify, parseMentions } from '../domain/collab/notify.ts';
import type { DocComment, DocVersion } from '../domain/collab/types.ts';

const saveBody = v.object({
  summary: v.string({ min: 1, max: 200 }),
  title: v.optional(v.string({ min: 1, max: 140 })),
  body: v.optional(v.string({ max: 200_000, trim: false })),
});
const restoreBody = v.object({ summary: v.optional(v.string({ max: 200 })) });
const commentBody = v.object({
  text: v.string({ min: 1, max: 4_000 }),
  parentId: v.optional(v.string({ max: 80 })),
  anchor: v.optional(
    v.object({
      quote: v.string({ min: 1, max: 1_000, trim: false }),
      start: v.optional(v.int({ min: 0, max: 200_000 })),
      end: v.optional(v.int({ min: 0, max: 200_000 })),
      heading: v.optional(v.string({ max: 200 })),
    }),
  ),
});
const commentPatch = v.object({
  resolved: v.optional(v.boolean()),
  text: v.optional(v.string({ min: 1, max: 4_000 })),
});

function readable(p: Principal, d: ProjectDoc) {
  return (
    canSeeProduct(p, d.product) &&
    (d.visibility !== 'restricted' || d.editors.includes(p.memberId) || hasOwnerPowers(p))
  );
}

function readableDoc(p: Principal, id: string): ProjectDoc {
  const d = db.docs.get(id);
  if (!d || !readable(p, d)) throw new HttpError(404, 'not_found', 'Not found');
  return d;
}

function versionsOf(docId: string): DocVersion[] {
  return [...docVersions.values()]
    .filter((x) => x.docId === docId)
    .sort((a, b) => b.number - a.number);
}

function snapshot(d: ProjectDoc, by: string, summary: string): DocVersion {
  const latest = versionsOf(d.id)[0];
  const ver: DocVersion = {
    id: sortableId('ver'),
    docId: d.id,
    number: (latest?.number ?? 0) + 1,
    at: new Date().toISOString(),
    by,
    summary,
    title: d.title,
    body: d.body,
    status: d.status,
    sourceUpdatedAt: d.updatedAt,
  };
  docVersions.set(ver.id, ver);
  return ver;
}

/** Snapshots published docs whose content moved past their latest snapshot. */
function snapshotPublished(only?: ProjectDoc) {
  for (const d of only ? [only] : db.docs.values()) {
    if (d.status !== 'published') continue;
    const latest = versionsOf(d.id)[0];
    if (
      latest &&
      (latest.sourceUpdatedAt >= d.updatedAt ||
        (latest.body === d.body && latest.title === d.title))
    )
      continue;
    const ver = snapshot(d, d.updatedBy, latest ? 'Published update' : 'Published');
    audit.append({
      actor: d.updatedBy,
      action: 'doc.version_snapshot',
      target: `${d.title} · v${ver.number}`,
    });
  }
}

function meta(x: DocVersion) {
  return {
    id: x.id,
    docId: x.docId,
    number: x.number,
    at: x.at,
    by: x.by,
    summary: x.summary,
    title: x.title,
    status: x.status,
    size: x.body.length,
  };
}

function versionOf(d: ProjectDoc, id: string): DocVersion {
  const x = docVersions.get(id);
  if (!x || x.docId !== d.id) throw new HttpError(404, 'not_found', 'Version not found');
  return x;
}

function touchDoc(d: ProjectDoc, by: string) {
  d.updatedBy = by;
  d.updatedAt = new Date().toISOString();
  if (!d.editors.includes(by)) d.editors.push(by);
  saveDoc(d.id);
}

function log(ctx: Ctx, action: string, target: string) {
  audit.append({ actor: ctx.principal!.memberId, action, target, requestId: ctx.requestId });
}

function viewerOf(m: Member | undefined) {
  return m && m.status === 'active'
    ? {
        memberId: m.id,
        role: m.role,
        products: m.products,
        sessionId: '',
        verifiedAt: 0,
        elevations: [],
      }
    : undefined;
}

let observing = false;

export function registerDocCollabRoutes(r: Router) {
  const tag = 'docs';
  if (!observing) {
    observing = true;
    subscribe((e) => {
      const action = e.data.action;
      if (e.type === 'audit' && (action === 'doc.updated' || action === 'doc.created'))
        snapshotPublished();
    });
  }

  r.add(
    'GET',
    '/api/docs/:docId/versions',
    { summary: 'Version history (newest first, without bodies)', tag, responses: [401, 404] },
    authenticate,
    requireArea('Project', 'view'),
    (ctx) => {
      const d = readableDoc(ctx.principal!, ctx.params.docId);
      snapshotPublished(d);
      return { items: versionsOf(d.id).map(meta) };
    },
  );

  r.add(
    'GET',
    '/api/docs/:docId/versions/:versionId',
    { summary: 'One version with its body', tag, responses: [401, 404] },
    authenticate,
    requireArea('Project', 'view'),
    (ctx) => versionOf(readableDoc(ctx.principal!, ctx.params.docId), ctx.params.versionId),
  );

  r.add(
    'GET',
    '/api/docs/:docId/versions/:versionId/diff',
    {
      summary: 'Line diff of a version against `?against=current|<versionId>`',
      tag,
      responses: [401, 404],
    },
    authenticate,
    requireArea('Project', 'view'),
    (ctx) => {
      const d = readableDoc(ctx.principal!, ctx.params.docId);
      const from = versionOf(d, ctx.params.versionId);
      const against = ctx.query.get('against') ?? 'current';
      const to =
        against === 'current'
          ? { id: 'current', title: d.title, body: d.body }
          : versionOf(d, against);
      return {
        from: from.id,
        to: to.id,
        titleChanged: from.title !== to.title,
        ...lineDiff(from.body, to.body),
      };
    },
  );

  r.add(
    'POST',
    '/api/docs/:docId/versions',
    {
      summary: 'Save a named version (optionally with new title/body)',
      tag,
      responses: [401, 403, 404, 422],
    },
    authenticate,
    requireArea('Project', 'contribute'),
    (ctx) => {
      const p = ctx.principal!;
      const body = parse(saveBody, ctx.body);
      const d = readableDoc(p, ctx.params.docId);
      if (body.title !== undefined) d.title = body.title;
      if (body.body !== undefined) d.body = body.body;
      if (body.title !== undefined || body.body !== undefined) touchDoc(d, p.memberId);
      const ver = snapshot(d, p.memberId, body.summary);
      log(ctx, 'doc.version_saved', `${d.title} · v${ver.number}`);
      ctx.status = 201;
      return meta(ver);
    },
  );

  r.add(
    'POST',
    '/api/docs/:docId/versions/:versionId/restore',
    {
      summary: 'Restore a version (current state is kept as a version first)',
      tag,
      responses: [401, 403, 404],
    },
    authenticate,
    requireArea('Project', 'contribute'),
    (ctx) => {
      const p = ctx.principal!;
      const body = parse(restoreBody, ctx.body ?? {});
      const d = readableDoc(p, ctx.params.docId);
      const target = versionOf(d, ctx.params.versionId);
      const latest = versionsOf(d.id)[0];
      if (!latest || latest.body !== d.body || latest.title !== d.title)
        snapshot(d, p.memberId, 'Before restore');
      d.title = target.title;
      d.body = target.body;
      touchDoc(d, p.memberId);
      const ver = snapshot(d, p.memberId, body.summary || `Restored v${target.number}`);
      log(ctx, 'doc.version_restored', `${d.title} · v${target.number} → v${ver.number}`);
      return { doc: d, version: meta(ver) };
    },
  );

  r.add(
    'GET',
    '/api/docs/:docId/comments',
    { summary: 'Inline comments (?resolved=0|1)', tag, responses: [401, 404] },
    authenticate,
    requireArea('Project', 'view'),
    (ctx) => {
      const d = readableDoc(ctx.principal!, ctx.params.docId);
      const resolved = ctx.query.get('resolved');
      return {
        items: [...docComments.values()]
          .filter(
            (c) => c.docId === d.id && (resolved === null || (resolved === '1') === !!c.resolved),
          )
          .sort((a, b) => a.at.localeCompare(b.at)),
      };
    },
  );

  r.add(
    'POST',
    '/api/docs/:docId/comments',
    {
      summary: 'Comment on a doc (anchored to a quote, or a thread reply)',
      tag,
      responses: [401, 404, 422],
    },
    authenticate,
    requireArea('Project', 'view'),
    async (ctx) => {
      const p = ctx.principal!;
      const body = parse(commentBody, ctx.body);
      const d = readableDoc(p, ctx.params.docId);
      let parent: DocComment | undefined;
      if (body.parentId) {
        parent = docComments.get(body.parentId);
        if (!parent || parent.docId !== d.id)
          throw new HttpError(404, 'not_found', 'Comment not found');
        if (parent.parentId) parent = docComments.get(parent.parentId) ?? parent;
      }
      if (
        body.anchor &&
        body.anchor.end !== undefined &&
        (body.anchor.start ?? 0) > body.anchor.end
      )
        throw new HttpError(422, 'validation_failed', 'anchor.start must not exceed anchor.end');
      const c: DocComment = {
        id: sortableId('dc'),
        docId: d.id,
        at: new Date().toISOString(),
        by: p.memberId,
        text: body.text,
        ...(body.anchor && !parent ? { anchor: body.anchor } : {}),
        ...(parent ? { parentId: parent.id } : {}),
      };
      docComments.set(c.id, c);
      log(ctx, 'doc.commented', `${d.title} · ${c.id}${parent ? ' · reply' : ''}`);

      const recipients = new Set([
        ...d.editors,
        ...(parent ? [parent.by] : []),
        ...(await parseMentions(body.text)),
      ]);
      const people = await repos.members.getMany([p.memberId, ...recipients]);
      const author = people.get(p.memberId)?.name ?? p.memberId;
      for (const id of recipients) {
        const viewer = viewerOf(people.get(id));
        if (!viewer || !readable(viewer, d)) continue;
        await notify({
          memberId: id,
          kind: 'doc-comment',
          title: `${author} commented on ${d.title}`,
          body: excerpt(body.text),
          link: `/docs/${encodeURIComponent(d.id)}?comment=${encodeURIComponent(c.id)}`,
          refId: `doc-comment:${c.id}`,
          actor: p.memberId,
        });
      }
      ctx.status = 201;
      return c;
    },
  );

  r.add(
    'PATCH',
    '/api/docs/:docId/comments/:commentId',
    { summary: 'Resolve/reopen a comment, or edit your own', tag, responses: [401, 403, 404, 422] },
    authenticate,
    requireArea('Project', 'view'),
    (ctx) => {
      const p = ctx.principal!;
      const body = parse(commentPatch, ctx.body);
      const d = readableDoc(p, ctx.params.docId);
      const c = docComments.get(ctx.params.commentId);
      if (!c || c.docId !== d.id) throw new HttpError(404, 'not_found', 'Not found');
      if (body.text !== undefined) {
        if (c.by !== p.memberId)
          throw new HttpError(403, 'forbidden', 'Only the author can edit a comment');
        c.text = body.text;
        c.editedAt = new Date().toISOString();
      }
      if (body.resolved !== undefined) {
        const allowed =
          c.by === p.memberId || d.editors.includes(p.memberId) || can(p, 'Project', 'manage');
        if (!allowed)
          throw new HttpError(
            403,
            'forbidden',
            'Only the author, an editor or a manager can resolve',
          );
        if (body.resolved) {
          c.resolved = true;
          c.resolvedBy = p.memberId;
          c.resolvedAt = new Date().toISOString();
        } else {
          delete c.resolved;
          delete c.resolvedBy;
          delete c.resolvedAt;
        }
      }
      docComments.save(c.id);
      log(
        ctx,
        body.resolved === true
          ? 'doc.comment_resolved'
          : body.resolved === false
            ? 'doc.comment_reopened'
            : 'doc.comment_edited',
        `${d.title} · ${c.id}`,
      );
      return c;
    },
  );
}
