import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { NOW, nowISO } from '../utils/date';

export type ResignationStatus = 'pending' | 'accepted' | 'withdrawn' | 'completed';

export interface Resignation {
  id: string;
  memberId: string;
  lastDay: string;
  reason: string;
  note?: string;
  handoverTo: string;
  submittedAt: string;
  status: ResignationStatus;
  decidedBy?: string;
  decidedAt?: string;
  checklist: { id: string; label: string; done: boolean }[];
}

const baseChecklist = () => [
  { id: 'tasks', label: 'Open tasks reassigned', done: false },
  { id: 'docs', label: 'Handover doc written', done: false },
  { id: 'tokens', label: 'Personal API tokens revoked', done: false },
  { id: 'devices', label: 'Trusted devices removed', done: false },
  { id: 'access', label: 'Repository & production access removed', done: false },
  { id: 'nda', label: 'NDA exit confirmation signed', done: false },
];

const seed: Resignation[] = [
  {
    id: 'rs1',
    memberId: 'm8',
    lastDay: new Date(NOW.getTime() + 14 * 86_400_000).toISOString().slice(0, 10),
    reason: 'New opportunity',
    note: 'Happy to pair on the SEO work before I go.',
    handoverTo: 'm6',
    submittedAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
    status: 'pending',
    checklist: baseChecklist(),
  },
];

interface OffboardingValue {
  resignations: Resignation[];
  submit: (r: Omit<Resignation, 'id' | 'submittedAt' | 'status' | 'checklist'>) => void;
  withdraw: (id: string) => void;
  decide: (id: string, accept: boolean, by: string) => void;
  toggleStep: (id: string, stepId: string) => void;
  complete: (id: string, by: string) => void;
}

const OffboardingContext = createContext<OffboardingValue | null>(null);

export function OffboardingProvider({ children }: { children: React.ReactNode }) {
  const [resignations, setList] = useState<Resignation[]>(seed);
  const patch = useCallback(
    (id: string, fn: (r: Resignation) => Resignation) =>
      setList((l) => l.map((r) => (r.id === id ? fn(r) : r))),
    [],
  );

  const submit = useCallback<OffboardingValue['submit']>(
    (r) =>
      setList((l) => [
        {
          ...r,
          id: `rs${Date.now()}`,
          submittedAt: nowISO(),
          status: 'pending',
          checklist: baseChecklist(),
        },
        ...l.filter((x) => !(x.memberId === r.memberId && x.status === 'pending')),
      ]),
    [],
  );
  const withdraw = useCallback(
    (id: string) => patch(id, (r) => ({ ...r, status: 'withdrawn', decidedAt: nowISO() })),
    [patch],
  );
  const decide = useCallback(
    (id: string, accept: boolean, by: string) =>
      patch(id, (r) => ({
        ...r,
        status: accept ? 'accepted' : 'withdrawn',
        decidedBy: by,
        decidedAt: nowISO(),
      })),
    [patch],
  );
  const toggleStep = useCallback(
    (id: string, stepId: string) =>
      patch(id, (r) => ({
        ...r,
        checklist: r.checklist.map((c) => (c.id === stepId ? { ...c, done: !c.done } : c)),
      })),
    [patch],
  );
  const complete = useCallback(
    (id: string, by: string) =>
      patch(id, (r) => ({
        ...r,
        status: 'completed',
        decidedBy: by,
        decidedAt: nowISO(),
        checklist: r.checklist.map((c) => ({ ...c, done: true })),
      })),
    [patch],
  );

  const value = useMemo(
    () => ({ resignations, submit, withdraw, decide, toggleStep, complete }),
    [resignations, submit, withdraw, decide, toggleStep, complete],
  );
  return <OffboardingContext.Provider value={value}>{children}</OffboardingContext.Provider>;
}

export function useOffboarding() {
  const ctx = useContext(OffboardingContext);
  if (!ctx) throw new Error('useOffboarding must be used inside OffboardingProvider');
  return ctx;
}
