import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NewTaskInput } from './WorkContext';

interface WorkspaceUIValue {
  assistantOpen: boolean;
  setAssistantOpen: (v: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  /** Navigates to the task's detail route. */
  openTask: (key: string | null) => void;
  /** Opens the global "New task" modal, optionally pre-filled. */
  createTaskDefaults: Partial<NewTaskInput> | null;
  openCreateTask: (defaults?: Partial<NewTaskInput>) => void;
  closeCreateTask: () => void;
  createWorkspaceOpen: boolean;
  setCreateWorkspaceOpen: (v: boolean) => void;
}

const WorkspaceUIContext = createContext<WorkspaceUIValue | null>(null);

export function WorkspaceUIProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [createTaskDefaults, setCreateTaskDefaults] = useState<Partial<NewTaskInput> | null>(null);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const openTask = useCallback(
    (key: string | null) => {
      if (key) navigate(`/tasks/${key}`);
    },
    [navigate],
  );
  const openCreateTask = useCallback(
    (d?: Partial<NewTaskInput>) => setCreateTaskDefaults(d ?? {}),
    [],
  );
  const closeCreateTask = useCallback(() => setCreateTaskDefaults(null), []);
  const value = useMemo(
    () => ({
      assistantOpen,
      setAssistantOpen,
      mobileNavOpen,
      setMobileNavOpen,
      sidebarCollapsed,
      setSidebarCollapsed,
      openTask,
      createTaskDefaults,
      openCreateTask,
      closeCreateTask,
      createWorkspaceOpen,
      setCreateWorkspaceOpen,
    }),
    [
      assistantOpen,
      mobileNavOpen,
      sidebarCollapsed,
      openTask,
      createTaskDefaults,
      openCreateTask,
      closeCreateTask,
      createWorkspaceOpen,
    ],
  );
  return <WorkspaceUIContext.Provider value={value}>{children}</WorkspaceUIContext.Provider>;
}

export function useWorkspaceUI() {
  const ctx = useContext(WorkspaceUIContext);
  if (!ctx) throw new Error('useWorkspaceUI must be used inside WorkspaceUIProvider');
  return ctx;
}
