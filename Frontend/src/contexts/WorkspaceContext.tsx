import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import { moduleCatalog } from '../data/workspaces';
import {
  errorMessage,
  isDemo,
  isUnavailable,
  itemsOf,
  type Availability,
} from '../components/work/apiState';
import type { ModuleKey, Workspace } from '../types/workspace';

/**
 * Workspaces on the API (`GET/POST /api/workspaces`, `PATCH /api/workspaces/:id`).
 *
 * Loads on sign-in, clears on sign-out, writes optimistically and resyncs with
 * the server when a write fails. When the workspaces module isn't deployed
 * (404) or configured (503) the list is empty and `status` says so — the page
 * renders a designed unavailable state; nothing falls back to seed workspaces.
 */

/**
 * `view()` in Backend/routes/workspaces.routes.ts. `role` is the caller's role
 * here: 'Owner' | 'Admin' for workspace owners/admins, else their org role.
 */
export interface ApiWorkspace {
  id: string;
  name: string;
  slug: string;
  color: string;
  template: string;
  modules: ModuleKey[];
  mfaRequired: boolean;
  ownerId: string;
  members: number;
  products: number;
  memberIds: string[];
  memberRoles: { memberId: string; role: 'owner' | 'admin' | 'member' }[];
  productIds: string[];
  role: string;
  pendingDeletionAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceTemplateId = 'product' | 'agency' | 'regulated' | 'startup';

/** `POST /api/workspaces` body (Organization:admin). The validator rejects unknown fields. */
export interface NewWorkspaceInput {
  name: string;
  slug: string;
  color?: string;
  template: WorkspaceTemplateId;
  modules?: ModuleKey[];
  mfaRequired?: boolean;
  /** Existing active member ids added as workspace members. */
  members?: string[];
  products?: ('renewberry' | 'blog' | 'mirror')[];
}

/**
 * `PATCH /api/workspaces/:id` body. Workspace owner/admin (or Organization:admin);
 * `scheduleDeletion` and `mfaRequired:false` need Organization:admin + step-up.
 */
export interface WorkspacePatch {
  name?: string;
  color?: string;
  modules?: ModuleKey[];
  mfaRequired?: boolean;
  addMembers?: string[];
  removeMembers?: string[];
  setRole?: { memberId: string; role: 'admin' | 'member' };
  scheduleDeletion?: boolean;
}

/** UI hint only: the caller is this workspace's owner/admin. The server decides. */
export const canAdminister = (w: Workspace) => w.role === 'Owner' || w.role === 'Admin';

interface WorkspaceValue {
  workspaces: Workspace[];
  /**
   * The selected workspace. While none is loaded this is a neutral placeholder
   * (id `''`, every module on) so the shell renders; it never contains seed data.
   */
  current: Workspace;
  status: Availability;
  error: string | null;
  /** True when the list came from a `source:'demo'` payload. */
  demo: boolean;
  switchTo: (id: string) => void;
  createWorkspace: (input: NewWorkspaceInput) => Promise<Workspace>;
  setModules: (modules: ModuleKey[]) => Promise<void>;
  hasModule: (m: ModuleKey) => boolean;
  updateWorkspace: (id: string, patch: WorkspacePatch) => Promise<void>;
  /** Schedules deletion with a 7-day grace period (server-side). */
  scheduleDeletion: (id: string) => Promise<void>;
  cancelDeletion: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}

const SELECTED = 'devhq.workspace.selected';

const placeholder: Workspace = {
  id: '',
  name: 'DevHQ',
  slug: '',
  color: '#475569',
  members: 0,
  products: 0,
  template: '',
  // Module gating is navigation only; the server still authorizes every call.
  modules: moduleCatalog.map((m) => m.key),
  role: '',
  mfaRequired: true,
};

function toWorkspace(w: ApiWorkspace): Workspace {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    color: w.color,
    members: w.members,
    products: w.products,
    template: w.template,
    modules: w.modules,
    role: w.role,
    mfaRequired: w.mfaRequired,
    pendingDeletionAt: w.pendingDeletionAt,
    ownerId: w.ownerId,
  };
}

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED);
  } catch {
    return null;
  }
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { readyMemberId } = useAuth();
  const memberId = readyMemberId;
  const [list, setList] = useState<Workspace[]>([]);
  const [status, setStatus] = useState<Availability>('loading');
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(readSelected);

  const current = list.find((w) => w.id === currentId) ?? list[0] ?? placeholder;

  const reload = useCallback(async () => {
    try {
      const body = await api<{ items: ApiWorkspace[] } | ApiWorkspace[]>('/api/workspaces');
      setList(itemsOf(body).map(toWorkspace));
      setDemo(isDemo(body));
      setStatus('ready');
      setError(null);
    } catch (e) {
      setList([]);
      setDemo(false);
      setStatus(isUnavailable(e) ? 'unavailable' : 'error');
      setError(errorMessage(e, 'The workspaces API did not respond.'));
    }
  }, []);

  useEffect(() => {
    if (!memberId) {
      setList([]);
      setStatus('loading');
      setError(null);
      return;
    }
    setStatus('loading');
    void reload();
  }, [memberId, reload]);

  const switchTo = useCallback((id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(SELECTED, id);
    } catch {
      /* a remembered selection is a convenience only */
    }
  }, []);

  const failed = useCallback(
    (action: string, e: unknown) => {
      toast.error(`${action} failed`, {
        description: errorMessage(e, 'The workspaces API did not respond.'),
      });
      void reload();
    },
    [reload],
  );

  const createWorkspace = useCallback<WorkspaceValue['createWorkspace']>(async (input) => {
    const created = toWorkspace(
      await api<ApiWorkspace>('/api/workspaces', { method: 'POST', body: input }),
    );
    setList((l) => [...l.filter((w) => w.id !== created.id), created]);
    return created;
  }, []);

  const updateWorkspace = useCallback(
    async (id: string, patch: WorkspacePatch) => {
      setList((l) =>
        l.map((w) =>
          w.id === id
            ? {
                ...w,
                ...(patch.name !== undefined && { name: patch.name }),
                ...(patch.color !== undefined && { color: patch.color }),
                // The server always keeps the core 'projects' module on.
                ...(patch.modules !== undefined && {
                  modules: Array.from(new Set<ModuleKey>(['projects', ...patch.modules])),
                }),
                ...(patch.mfaRequired !== undefined && { mfaRequired: patch.mfaRequired }),
                pendingDeletionAt:
                  patch.scheduleDeletion === undefined
                    ? w.pendingDeletionAt
                    : patch.scheduleDeletion
                      ? new Date(Date.now() + 7 * 86_400_000).toISOString()
                      : undefined,
              }
            : w,
        ),
      );
      try {
        const saved = await api<ApiWorkspace>(`/api/workspaces/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: patch,
        });
        setList((l) => l.map((w) => (w.id === id ? toWorkspace(saved) : w)));
      } catch (e) {
        failed('Saving the workspace', e);
        throw e;
      }
    },
    [failed],
  );

  const setModules = useCallback(
    (modules: ModuleKey[]) =>
      current.id ? updateWorkspace(current.id, { modules }) : Promise.resolve(),
    [current.id, updateWorkspace],
  );
  const hasModule = useCallback((m: ModuleKey) => current.modules.includes(m), [current]);
  const scheduleDeletion = useCallback(
    (id: string) => updateWorkspace(id, { scheduleDeletion: true }),
    [updateWorkspace],
  );
  const cancelDeletion = useCallback(
    (id: string) => updateWorkspace(id, { scheduleDeletion: false }),
    [updateWorkspace],
  );

  const value = useMemo(
    () => ({
      workspaces: list,
      current,
      status,
      error,
      demo,
      switchTo,
      createWorkspace,
      setModules,
      hasModule,
      updateWorkspace,
      scheduleDeletion,
      cancelDeletion,
      reload,
    }),
    [
      list,
      current,
      status,
      error,
      demo,
      switchTo,
      createWorkspace,
      setModules,
      hasModule,
      updateWorkspace,
      scheduleDeletion,
      cancelDeletion,
      reload,
    ],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
