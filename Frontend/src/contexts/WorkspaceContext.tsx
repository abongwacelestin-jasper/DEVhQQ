import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { workspaces as seed } from '../data/workspaces';
import { nowISO } from '../utils/date';
import type { ModuleKey, Workspace } from '../types/workspace';

interface WorkspaceValue {
  workspaces: Workspace[];
  current: Workspace;
  switchTo: (id: string) => void;
  addWorkspace: (w: Workspace) => void;
  setModules: (modules: ModuleKey[]) => void;
  hasModule: (m: ModuleKey) => boolean;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;
  /** Schedules deletion with a 7-day grace period. */
  scheduleDeletion: (id: string) => void;
  cancelDeletion: (id: string) => void;
  /** Removes immediately. Returns false when it is the last workspace. */
  deleteNow: (id: string) => boolean;
  leaveWorkspace: (id: string) => boolean;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Workspace[]>(seed);
  const [currentId, setCurrentId] = useState(seed[0].id);
  const current = list.find((w) => w.id === currentId) ?? list[0];

  const addWorkspace = useCallback((w: Workspace) => setList((l) => [...l, w]), []);
  const updateWorkspace = useCallback(
    (id: string, patch: Partial<Workspace>) =>
      setList((l) => l.map((w) => (w.id === id ? { ...w, ...patch } : w))),
    [],
  );
  const setModules = useCallback(
    (modules: ModuleKey[]) =>
      setList((l) => l.map((w) => (w.id === currentId ? { ...w, modules } : w))),
    [currentId],
  );
  const hasModule = useCallback((m: ModuleKey) => current.modules.includes(m), [current]);
  const scheduleDeletion = useCallback(
    (id: string) => updateWorkspace(id, { pendingDeletionAt: nowISO() }),
    [updateWorkspace],
  );
  const cancelDeletion = useCallback(
    (id: string) => updateWorkspace(id, { pendingDeletionAt: undefined }),
    [updateWorkspace],
  );

  const remove = useCallback(
    (id: string) => {
      if (list.length <= 1) return false;
      const rest = list.filter((w) => w.id !== id);
      setList(rest);
      if (id === currentId) setCurrentId(rest[0].id);
      return true;
    },
    [list, currentId],
  );

  const value = useMemo(
    () => ({
      workspaces: list,
      current,
      switchTo: setCurrentId,
      addWorkspace,
      setModules,
      hasModule,
      updateWorkspace,
      scheduleDeletion,
      cancelDeletion,
      deleteNow: remove,
      leaveWorkspace: remove,
    }),
    [
      list,
      current,
      addWorkspace,
      setModules,
      hasModule,
      updateWorkspace,
      scheduleDeletion,
      cancelDeletion,
      remove,
    ],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
