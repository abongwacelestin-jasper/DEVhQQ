import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import type { ApiDoc, ApiDocDetail } from '../api/types';
import { useAuth } from './AuthContext';
import { currentUserId } from '../data/team';
import { nowISO } from '../utils/date';
import type { ProjectDoc } from '../types/docs';

/**
 * Project docs.
 *
 * List, read, create and patch go through the API — the server decides who may
 * see a doc (`restricted` docs are editor-only) and records who changed what.
 * Versions and inline comments have no backend yet, so they are kept for the
 * life of the page and never presented as durable.
 */
interface DocsValue {
  docs: ProjectDoc[];
  create: (
    d: Pick<ProjectDoc, 'projectId' | 'product' | 'title' | 'kind' | 'visibility' | 'body'>,
  ) => Promise<ProjectDoc>;
  save: (id: string, body: string, title: string, summary: string) => void;
  update: (id: string, patch: Partial<ProjectDoc>) => void;
  restore: (id: string, versionId: string) => void;
  comment: (id: string, text: string) => void;
  resolveComment: (id: string, commentId: string) => void;
  remove: (id: string) => void;
  reload: () => Promise<void>;
}

const DocsContext = createContext<DocsValue | null>(null);

function toDoc(d: ApiDoc | ApiDocDetail): ProjectDoc {
  return {
    id: d.id,
    projectId: d.projectId,
    product: d.product,
    title: d.title,
    kind: d.kind,
    status: d.status,
    visibility: d.visibility,
    body: 'body' in d ? d.body : '',
    createdBy: d.updatedBy,
    createdAt: d.updatedAt,
    updatedBy: d.updatedBy,
    updatedAt: d.updatedAt,
    versions: [],
    comments: [],
    editors: d.editors,
  };
}

/** Only fields the API accepts may be sent; the rest stay presentation-only. */
function apiPatch(p: Partial<ProjectDoc>) {
  return Object.fromEntries(
    (['title', 'body', 'status'] as const)
      .filter((k) => p[k] !== undefined)
      .map((k) => [k, p[k]]),
  );
}

export function DocsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const memberId = session?.memberId ?? null;
  const [docs, setDocs] = useState<ProjectDoc[]>([]);

  const reload = useCallback(async () => {
    const list = await api<ApiDoc[]>('/api/docs');
    // The list is metadata-only so it stays cheap; bodies are what the views render.
    const full = await Promise.all(
      list.map((d) => api<ApiDocDetail>(`/api/docs/${encodeURIComponent(d.id)}`)),
    );
    setDocs(full.map(toDoc));
  }, []);

  useEffect(() => {
    if (!memberId) {
      setDocs([]);
      return;
    }
    let alive = true;
    reload().catch((e) => {
      if (!alive) return;
      toast.error("Couldn't load docs", {
        description: e instanceof Error ? e.message : 'The docs API did not respond.',
      });
    });
    return () => {
      alive = false;
    };
  }, [memberId, reload]);

  const patch = useCallback(
    (id: string, fn: (d: ProjectDoc) => ProjectDoc) =>
      setDocs((l) => l.map((d) => (d.id === id ? fn(d) : d))),
    [],
  );

  const failed = useCallback(
    (action: string, e: unknown) => {
      toast.error(`${action} failed`, {
        description: e instanceof Error ? e.message : 'The docs API did not respond.',
      });
      void reload().catch(() => undefined);
    },
    [reload],
  );

  const create = useCallback<DocsValue['create']>(async (d) => {
    const created = await api<ApiDocDetail>('/api/docs', {
      method: 'POST',
      body: {
        projectId: d.projectId,
        title: d.title,
        kind: d.kind,
        visibility: d.visibility,
        body: d.body,
      },
    });
    const doc = toDoc(created);
    setDocs((l) => [doc, ...l]);
    return doc;
  }, []);

  const save = useCallback(
    (id: string, body: string, title: string, summary: string) => {
      const at = nowISO();
      patch(id, (d) => ({
        ...d,
        body,
        title,
        updatedAt: at,
        updatedBy: currentUserId,
        editors: Array.from(new Set([...d.editors, currentUserId])),
        versions: [
          {
            id: `v${d.versions.length + 1}`,
            at,
            by: currentUserId,
            summary: summary || 'Edited',
            body,
          },
          ...d.versions,
        ],
      }));
      api<ApiDocDetail>(`/api/docs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { title, body },
      }).catch((e) => failed('Saving the doc', e));
    },
    [patch, failed],
  );

  const update = useCallback(
    (id: string, p: Partial<ProjectDoc>) => {
      patch(id, (d) => ({ ...d, ...p, updatedAt: nowISO(), updatedBy: currentUserId }));
      const body = apiPatch(p);
      if (!Object.keys(body).length) return;
      api<ApiDocDetail>(`/api/docs/${encodeURIComponent(id)}`, { method: 'PATCH', body }).catch(
        (e) => failed('Updating the doc', e),
      );
    },
    [patch, failed],
  );

  const restore = useCallback(
    (id: string, versionId: string) => {
      let body: string | undefined;
      patch(id, (d) => {
        const ver = d.versions.find((x) => x.id === versionId);
        if (!ver || !ver.body) return d;
        body = ver.body;
        const at = nowISO();
        return {
          ...d,
          body: ver.body,
          updatedAt: at,
          updatedBy: currentUserId,
          versions: [
            {
              id: `v${d.versions.length + 1}`,
              at,
              by: currentUserId,
              summary: `Restored ${ver.id}`,
              body: ver.body,
            },
            ...d.versions,
          ],
        };
      });
      if (body !== undefined)
        api<ApiDocDetail>(`/api/docs/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { body },
        }).catch((e) => failed('Restoring the version', e));
    },
    [patch, failed],
  );

  // Comments are not stored server-side yet: they last for this page's lifetime.
  const comment = useCallback(
    (id: string, text: string) =>
      patch(id, (d) => ({
        ...d,
        comments: [...d.comments, { id: `c${Date.now()}`, at: nowISO(), by: currentUserId, text }],
      })),
    [patch],
  );
  const resolveComment = useCallback(
    (id: string, cid: string) =>
      patch(id, (d) => ({
        ...d,
        comments: d.comments.map((c) => (c.id === cid ? { ...c, resolved: !c.resolved } : c)),
      })),
    [patch],
  );

  const remove = useCallback(
    (id: string) => {
      setDocs((l) => l.filter((d) => d.id !== id));
      api(`/api/docs/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch((e) =>
        failed('Deleting the doc', e),
      );
    },
    [failed],
  );

  const value = useMemo(
    () => ({ docs, create, save, update, restore, comment, resolveComment, remove, reload }),
    [docs, create, save, update, restore, comment, resolveComment, remove, reload],
  );
  return <DocsContext.Provider value={value}>{children}</DocsContext.Provider>;
}

export function useDocs() {
  const ctx = useContext(DocsContext);
  if (!ctx) throw new Error('useDocs must be used inside DocsProvider');
  return ctx;
}
