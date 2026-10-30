import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BugIcon,
  ChevronLeftIcon,
  ClockIcon,
  ListPlusIcon,
  SirenIcon,
  UserPlusIcon,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ProductMark } from '../ui/ProductMark';
import { LogTimeModal } from '../work/LogTimeModal';
import { useAuth } from '../../contexts/AuthContext';
import { useWork } from '../../contexts/WorkContext';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { useIncidents } from '../../contexts/IncidentContext';
import { currentUserId } from '../../data/team';
import type { Action } from '../../data/roles';

interface QuickAction {
  action: Action;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}

const actions: QuickAction[] = [
  {
    action: 'task:create',
    label: 'New task',
    hint: 'Plan and assign work',
    icon: ListPlusIcon,
    tone: 'bg-accent-soft text-accent',
  },
  {
    action: 'bug:report',
    label: 'Report bug',
    hint: 'Log a defect with steps',
    icon: BugIcon,
    tone: 'bg-warn-soft text-warn',
  },
  {
    action: 'time:log',
    label: 'Log time',
    hint: 'Against one of your tasks',
    icon: ClockIcon,
    tone: 'bg-sunken text-ink',
  },
  {
    action: 'incident:declare',
    label: 'Declare incident',
    hint: 'Page the owner now',
    icon: SirenIcon,
    tone: 'bg-bad-soft text-bad',
  },
  {
    action: 'member:invite',
    label: 'Invite member',
    hint: 'Role + product access',
    icon: UserPlusIcon,
    tone: 'bg-ok-soft text-ok',
  },
];

/** The centre "New" button's action sheet — only actions the signed-in role may take. */
export function QuickActions({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { canDo } = useAuth();
  const { tasks } = useWork();
  const { openCreateTask } = useWorkspaceUI();
  const { setDeclareOpen } = useIncidents();
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const [logKey, setLogKey] = useState<string | null>(null);
  const mine = tasks.filter((t) => t.assignee === currentUserId && t.status !== 'done');

  const close = () => {
    setPicking(false);
    onClose();
  };

  const run = (a: Action) => {
    if (a === 'time:log') return setPicking(true);
    close();
    if (a === 'task:create') openCreateTask();
    if (a === 'bug:report') openCreateTask({ type: 'bug', priority: 'high' });
    if (a === 'incident:declare') setDeclareOpen(true);
    if (a === 'member:invite') navigate('/team?invite=1');
  };

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title={picking ? 'Log time on…' : 'Create'}
        description={
          picking
            ? 'Pick one of your open tasks.'
            : 'Everything you create is recorded with your name and the time.'
        }
        size="sm"
      >
        {picking ? (
          <div>
            <button
              onClick={() => setPicking(false)}
              className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-ink"
            >
              <ChevronLeftIcon className="h-3.5 w-3.5" /> Back
            </button>
            {mine.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-muted">You have no open tasks.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line scroll-thin">
                {mine.map((t) => (
                  <li key={t.key}>
                    <button
                      onClick={() => {
                        setLogKey(t.key);
                        close();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sunken/60"
                    >
                      <ProductMark product={t.product} size="sm" />
                      <span className="font-mono text-[11px] text-muted">{t.key}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                        {t.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {actions
              .filter((a) => canDo(a.action))
              .map((a) => (
                <li key={a.action}>
                  <button
                    onClick={() => run(a.action)}
                    className="flex h-full w-full flex-col items-start gap-1.5 rounded-lg border border-line p-2.5 text-left transition-colors duration-150 hover:border-line-strong hover:bg-sunken/40"
                  >
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-md ${a.tone}`}
                    >
                      <a.icon className="h-4 w-4" />
                    </span>
                    <span className="text-[12.5px] font-semibold text-ink">{a.label}</span>
                    <span className="text-[11px] leading-snug text-muted">{a.hint}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </Modal>
      <LogTimeModal taskKey={logKey} onClose={() => setLogKey(null)} />
    </>
  );
}
