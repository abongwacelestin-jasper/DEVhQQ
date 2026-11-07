import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import type { ApiDocDetail } from '../../api/types';
import { useAuth } from '../../contexts/AuthContext';
import { errorMessage, isDemo, isUnavailable, itemsOf, type Availability } from '../work/apiState';

/**
 * Version history and inline comments for one doc, from B-COLLAB's
 * `Backend/routes/doc-collab.routes.ts`:
 *
 *   GET  /api/docs/:docId/versions                         → {items: VersionMeta[]} (newest first, no bodies)
 *   GET  /api/docs/:docId/versions/:versionId              → DocVersion (with body)
 *   GET  /api/docs/:docId/versions/:versionId/diff?against=current|<versionId>
 *                                                          → {from, to, titleChanged, ops, added, removed}
 *   POST /api/docs/:docId/versions {summary, title?, body?} → 201 VersionMeta (writes the doc + snapshots it)
 *   POST /api/docs/:docId/versions/:versionId/restore {summary?} → {doc, version: VersionMeta}
 *   GET  /api/docs/:docId/comments                         → {items: DocComment[]} (oldest first)
 *   POST /api/docs/:docId/comments {text, parentId?, anchor?} → 201 DocComment
 *   PATCH /api/docs/:docId/comments/:commentId {resolved?, text?} → DocComment
 *
 * A 404/503 on the list marks the panel unavailable. Nothing is kept or invented locally.
 * The server also snapshots published docs on change, so the client never double-posts.
 */

export interface ApiDocVersionMeta {
  id: string;
  docId: string;
  /** 1-based, increasing per doc. */
  number: number;
  at: string;
  by: string;
  summary: string;
  title: string;
  status: 'draft' | 'in-review' | 'published';
  /** Body length in characters. */
  size: number;
}

export interface ApiDocVersion extends Omit<ApiDocVersionMeta, 'size'> {
  body: string;
  sourceUpdatedAt: string;
}

export type ApiDiffOp = { op: 'equal' | 'add' | 'remove'; line: string };

export interface ApiDocDiff {
  from: string;
  to: string;
  titleChanged: boolean;
  ops: ApiDiffOp[];
  added: number;
  removed: number;
}

export interface ApiDocCommentAnchor {
  /** The quoted text the comment is attached to (≤ 1000 chars). */
  quote: string;
  /** Advisory character offsets into the body when the comment was made. */
  start?: number;
  end?: number;
  /** Nearest `## ` heading, to help re-anchor after edits. */
  heading?: string;
}

export interface ApiDocComment {
  id: string;
  docId: string;
  at: string;
  by: string;
  text: string;
  anchor?: ApiDocCommentAnchor;
  parentId?: string;
  resolved?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  editedAt?: string;
}

export interface ApiRestoreResponse {
  doc: ApiDocDetail;
  version: ApiDocVersionMeta;
}

type ListBody<T> = { items: T[]; nextCursor?: string; source?: string } | T[];

interface Panel<T> {
  status: Availability;
  items: T[];
  demo: boolean;
  error: string | null;
}

const initial = <T>(): Panel<T> => ({ status: 'loading', items: [], demo: false, error: null });

export function useDocCollab(docId: string) {
  const { session } = useAuth();
  const me = session?.memberId ?? null;
  const base = `/api/docs/${encodeURIComponent(docId)}`;
  const [versions, setVersions] = useState<Panel<ApiDocVersionMeta>>(initial);
  const [comments, setComments] = useState<Panel<ApiDocComment>>(initial);

  const loadVersions = useCallback(async () => {
    setVersions((p) => ({ ...p, status: p.items.length ? p.status : 'loading', error: null }));
    try {
      const body = await api<ListBody<ApiDocVersionMeta>>(`${base}/versions`);
      setVersions({
        status: 'ready',
        items: [...itemsOf(body)].sort((a, b) => b.number - a.number),
        demo: isDemo(body),
        error: null,
      });
    } catch (e) {
      setVersions({
        status: isUnavailable(e) ? 'unavailable' : 'error',
        items: [],
        demo: false,
        error: errorMessage(e),
      });
    }
  }, [base]);

  const loadComments = useCallback(async () => {
    setComments((p) => ({ ...p, status: p.items.length ? p.status : 'loading', error: null }));
    try {
      const body = await api<ListBody<ApiDocComment>>(`${base}/comments`);
      setComments({
        status: 'ready',
        items: [...itemsOf(body)].sort((a, b) => a.at.localeCompare(b.at)),
        demo: isDemo(body),
        error: null,
      });
    } catch (e) {
      setComments({
        status: isUnavailable(e) ? 'unavailable' : 'error',
        items: [],
        demo: false,
        error: errorMessage(e),
      });
    }
  }, [base]);

  useEffect(() => {
    if (!me) return;
    setVersions(initial());
    setComments(initial());
    void loadVersions();
    void loadComments();
  }, [me, loadVersions, loadComments]);

  /**
   * Saves title + body and snapshots them in one server call.
   * Resolves `'saved'`, or `'unavailable'` when doc-collab isn't deployed (the
   * caller then falls back to a plain PATCH). Other failures reject.
   */
  const saveVersion = useCallback(
    async (input: { summary: string; title: string; body: string }) => {
      try {
        const created = await api<ApiDocVersionMeta>(`${base}/versions`, {
          method: 'POST',
          body: input,
        });
        setVersions((p) => ({
          ...p,
          status: 'ready',
          items: [created, ...p.items.filter((v) => v.id !== created.id)].sort(
            (a, b) => b.number - a.number,
          ),
        }));
        return 'saved' as const;
      } catch (e) {
        if (isUnavailable(e) && versions.status !== 'ready') {
          setVersions((p) => ({ ...p, status: 'unavailable', error: errorMessage(e) }));
          return 'unavailable' as const;
        }
        throw e;
      }
    },
    [base, versions.status],
  );

  /** Server-side line diff of a version against the current doc. */
  const diff = useCallback(
    async (versionId: string): Promise<ApiDocDiff | null> => {
      try {
        return await api<ApiDocDiff>(
          `${base}/versions/${encodeURIComponent(versionId)}/diff?against=current`,
        );
      } catch (e) {
        toast.error("Couldn't load the comparison", { description: errorMessage(e) });
        return null;
      }
    },
    [base],
  );

  /** Server-side restore; the pre-restore state is kept as a version, so it's undoable. */
  const restore = useCallback(
    async (versionId: string, summary?: string): Promise<ApiRestoreResponse | null> => {
      try {
        const res = await api<ApiRestoreResponse>(
          `${base}/versions/${encodeURIComponent(versionId)}/restore`,
          { method: 'POST', body: summary ? { summary } : {} },
        );
        // The server may have added a "Before restore" snapshot as well, so re-read the list.
        void loadVersions();
        return res;
      } catch (e) {
        toast.error('Restoring the version failed', { description: errorMessage(e) });
        return null;
      }
    },
    [base, loadVersions],
  );

  const addComment = useCallback(
    async (input: { text: string; anchor?: ApiDocCommentAnchor; parentId?: string }) => {
      try {
        const created = await api<ApiDocComment>(`${base}/comments`, {
          method: 'POST',
          body: input,
        });
        setComments((p) => ({
          ...p,
          status: 'ready',
          items: [...p.items.filter((c) => c.id !== created.id), created],
        }));
        return true;
      } catch (e) {
        toast.error('Posting the comment failed', { description: errorMessage(e) });
        return false;
      }
    },
    [base],
  );

  /** Optimistic resolve/reopen; the server's copy replaces it, and a failure reloads. */
  const setResolved = useCallback(
    async (commentId: string, resolved: boolean) => {
      setComments((p) => ({
        ...p,
        items: p.items.map((c) =>
          c.id === commentId
            ? {
                ...c,
                resolved: resolved || undefined,
                resolvedBy: resolved ? (me ?? undefined) : undefined,
                resolvedAt: resolved ? new Date().toISOString() : undefined,
              }
            : c,
        ),
      }));
      try {
        const saved = await api<ApiDocComment>(
          `${base}/comments/${encodeURIComponent(commentId)}`,
          { method: 'PATCH', body: { resolved } },
        );
        setComments((p) => ({
          ...p,
          items: p.items.map((c) => (c.id === commentId ? saved : c)),
        }));
      } catch (e) {
        toast.error(resolved ? 'Resolving failed' : 'Reopening failed', {
          description: errorMessage(e),
        });
        void loadComments();
      }
    },
    [base, me, loadComments],
  );

  /** Authors may edit their own comment text. */
  const editComment = useCallback(
    async (commentId: string, text: string) => {
      try {
        const saved = await api<ApiDocComment>(
          `${base}/comments/${encodeURIComponent(commentId)}`,
          { method: 'PATCH', body: { text } },
        );
        setComments((p) => ({
          ...p,
          items: p.items.map((c) => (c.id === commentId ? saved : c)),
        }));
        return true;
      } catch (e) {
        toast.error('Editing the comment failed', { description: errorMessage(e) });
        return false;
      }
    },
    [base],
  );

  const openCount = useMemo(
    () => comments.items.filter((c) => !c.parentId && !c.resolved).length,
    [comments.items],
  );

  return {
    versions,
    comments,
    openCount,
    loadVersions,
    loadComments,
    saveVersion,
    diff,
    restore,
    addComment,
    setResolved,
    editComment,
  };
}
