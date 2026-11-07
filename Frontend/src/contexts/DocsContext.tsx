import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import type { ApiDoc, ApiDocDetail } from '../api/types';
import { useAuth } from './AuthContext';
import { nowISO } from '../utils/date';
import type { ProjectDoc } from '../types/docs';

/**
 * Project docs.
 *
 * List, read, create, patch and delete go through `/api/docs`; the server
 * decides who may see a doc (`restricted` docs are editor-only) and records who
 * changed what. Version history and inline comments live on the doc-collab
 * endpoints (`/api/docs/:id/versions|comments`) and are loaded per doc by
 * `components/docs/useDocCollab.ts`. This context keeps no local copy of them,
 * so `ProjectDoc.versions` / `.comments` are always empty here.
 *
 * Saving: the editor saves through `POST /api/docs/:id/versions` (which writes
 * the doc and snapshots it in one call) and then `refreshDoc`s; `save` (a plain
 * PATCH) is the fallback when doc-collab isn't deployed, and is used for small
 * edits such as ticking a checklist item.
 */
interface DocsValue {
  docs: ProjectDoc[];
  create: (
    d: Pick<ProjectDoc, 'projectId' | 'product' | 'title' | 'kind' | 'visibility' | 'body'>,
  ) => Promise<ProjectDoc>;
  /** PATCHes title + body. Resolves with the server's copy; rejects (after resyncing) on failure. */
  save: (id: string, body: string, title: string) => Promise<ProjectDoc>;
  /** Replaces one doc with the server's copy (e.g. the `doc` returned by a restore). */
  applyServerDoc: (d: ApiDocDetail) => void;
  /** Re-reads one doc from `GET /api/docs/:id`. */
  refreshDoc: (id: string) => Promise<void>;
  /** Status changes (the only other field the API accepts). Optimistic; resyncs on failure. */
  update: (id: string, patch: DocPatch) => void;
  remove: (id: string) => void;
  reload: () => Promise<void>;
}

type DocPatch = Partial<Pick<ProjectDoc, 'title' | 'body' | 'status'>>;

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
    // Loaded per doc from /api/docs/:id/versions|comments (useDocCollab), never kept here.
    versions: [],
    comments: [],
    editors: d.editors,
  };
}

/** Only fields the API accepts may be sent. */
function apiPatch(p: DocPatch) {
  return Object.fromEntries(
    (['title', 'body', 'status'] as const).filter((k) => p[k] !== undefined).map((k) => [k, p[k]]),
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

  const save = useCallback<DocsValue['save']>(
    async (id, body, title) => {
      try {
        const saved = toDoc(
          await api<ApiDocDetail>(`/api/docs/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: { title, body },
          }),
        );
        setDocs((l) => l.map((d) => (d.id === id ? saved : d)));
        return saved;
      } catch (e) {
        failed('Saving the doc', e);
        throw e;
      }
    },
    [failed],
  );

  const update = useCallback<DocsValue['update']>(
    (id, p) => {
      setDocs((l) =>
        l.map((d) =>
          d.id === id ? { ...d, ...p, updatedAt: nowISO(), updatedBy: memberId ?? d.updatedBy } : d,
        ),
      );
      const body = apiPatch(p);
      if (!Object.keys(body).length) return;
      api<ApiDocDetail>(`/api/docs/${encodeURIComponent(id)}`, { method: 'PATCH', body }).catch(
        (e) => failed('Updating the doc', e),
      );
    },
    [failed, memberId],
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

  const applyServerDoc = useCallback((d: ApiDocDetail) => {
    const next = toDoc(d);
    setDocs((l) =>
      l.some((x) => x.id === next.id) ? l.map((x) => (x.id === next.id ? next : x)) : [next, ...l],
    );
  }, []);

  const refreshDoc = useCallback(
    async (id: string) => {
      try {
        applyServerDoc(await api<ApiDocDetail>(`/api/docs/${encodeURIComponent(id)}`));
      } catch (e) {
        failed('Refreshing the doc', e);
      }
    },
    [applyServerDoc, failed],
  );

  const value = useMemo(
    () => ({ docs, create, save, applyServerDoc, refreshDoc, update, remove, reload }),
    [docs, create, save, applyServerDoc, refreshDoc, update, remove, reload],
  );
  return <DocsContext.Provider value={value}>{children}</DocsContext.Provider>;
}

export function useDocs() {
  const ctx = useContext(DocsContext);
  if (!ctx) throw new Error('useDocs must be used inside DocsProvider');
  return ctx;
}
