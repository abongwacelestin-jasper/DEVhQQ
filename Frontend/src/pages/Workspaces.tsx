import { toast } from 'sonner';
import {
  CheckIcon,
  DatabaseIcon,
  KeyRoundIcon,
  LockIcon,
  PlusIcon,
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { WorkspacesIllustration } from '../components/illustrations/WorkspacesIllustration';
import { WorkspaceMark } from '../components/layout/WorkspaceSwitcher';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { useReauth } from '../contexts/ReauthContext';
import { moduleCatalog, workspaceTemplates } from '../data/workspaces';
import type { ModuleKey } from '../types/workspace';

const isolation = [
  {
    icon: DatabaseIcon,
    title: 'Separate data',
    text: 'Every record carries a workspace id and is isolated at the database level.',
  },
  {
    icon: UsersIcon,
    title: 'Separate members',
    text: 'Joining one workspace never grants access to another.',
  },
  {
    icon: KeyRoundIcon,
    title: 'Separate credentials',
    text: 'Integrations and tokens are scoped to a single workspace.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Separate audit',
    text: 'Each workspace keeps its own append-only audit log.',
  },
];

export function Workspaces() {
  const { workspaces, current, switchTo, setModules } = useWorkspace();
  const { setCreateWorkspaceOpen } = useWorkspaceUI();
  const { requestReauth } = useReauth();
  const isOwner = current.role === 'Owner';

  const toggleModule = (key: ModuleKey) => {
    const on = current.modules.includes(key);
    const label = moduleCatalog.find((m) => m.key === key)?.label;
    requestReauth({
      title: `${on ? 'Turn off' : 'Turn on'} ${label}`,
      description: on
        ? 'Its pages disappear for everyone in this workspace. Data is kept and comes back if you turn it on again.'
        : 'Its pages appear in navigation for members with access.',
      actionLabel: 'Verify & save',
      successMessage: `${label} ${on ? 'turned off' : 'turned on'}`,
      onConfirm: () =>
        setModules(on ? current.modules.filter((m) => m !== key) : [...current.modules, key]),
    });
  };

  return (
    <div className="space-y-3.5">
      <section className="grid items-center gap-3 overflow-hidden rounded-lg border border-line bg-accent-soft/40 px-3.5 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto]">
        <WorkspacesIllustration className="hidden h-[84px] w-auto md:block" />
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold tracking-tight text-ink">Workspaces</h1>
          <p className="mt-0.5 max-w-xl text-[12.5px] text-muted">
            Run several companies from one DevHQ account. Each workspace has its own products,
            people, modules and security policies.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<PlusIcon className="h-3.5 w-3.5" />}
          onClick={() => setCreateWorkspaceOpen(true)}
        >
          Create workspace
        </Button>
      </section>

      <Panel
        title="Your workspaces"
        meta={<span className="tabular-nums">{workspaces.length}</span>}
      >
        <ul className="divide-y divide-line">
          {workspaces.map((w) => {
            const active = w.id === current.id;
            const tpl = workspaceTemplates.find((t) => t.id === w.template);
            return (
              <li
                key={w.id}
                className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-2 lg:grid-cols-[28px_minmax(0,1.2fr)_120px_100px_minmax(0,1.6fr)_96px]"
              >
                <WorkspaceMark ws={w} size={28} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-[12.5px] font-semibold text-ink">
                    {w.name}
                    {active && <StatusBadge tone="accent" label="Current" />}
                  </p>
                  <p className="truncate text-[11.5px] text-muted">
                    devhq.app/{w.slug} · {tpl?.name}
                  </p>
                </div>
                <span className="hidden text-[12px] text-ink lg:block">{w.role}</span>
                <span className="hidden text-[12px] tabular-nums text-muted lg:block">
                  {w.members} people · {w.products} prod.
                </span>
                <div className="col-span-3 col-start-2 flex flex-wrap gap-1 lg:col-span-1 lg:col-start-auto">
                  {w.modules.map((m) => (
                    <span
                      key={m}
                      className="rounded bg-sunken px-1.5 py-px text-[11px] font-medium text-ink"
                    >
                      {moduleCatalog.find((c) => c.key === m)?.label}
                    </span>
                  ))}
                  {w.mfaRequired && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-ok-soft px-1.5 py-px text-[11px] font-medium text-ok">
                      <LockIcon className="h-2.5 w-2.5" /> MFA
                    </span>
                  )}
                </div>
                <div className="col-start-3 row-start-1 justify-self-end lg:col-start-auto lg:row-start-auto">
                  {active ? (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-accent">
                      <CheckIcon className="h-3.5 w-3.5" /> Active
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        switchTo(w.id);
                        toast.success(`Switched to ${w.name}`);
                      }}
                    >
                      Switch
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel
          title={`Modules in ${current.name}`}
          meta={
            <span>{isOwner ? 'Owner · changes need MFA' : 'Only Owners can change modules'}</span>
          }
        >
          <ul className="grid gap-px bg-line sm:grid-cols-2">
            {moduleCatalog.map((m) => {
              const on = current.modules.includes(m.key);
              return (
                <li key={m.key} className="flex items-center gap-3 bg-white px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                      {m.label}
                      {m.core && (
                        <span className="rounded bg-sunken px-1 text-[10.5px] font-medium text-muted">
                          Core
                        </span>
                      )}
                    </p>
                    <p className="text-[11.5px] text-muted">{m.description}</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={on}
                    aria-label={m.label}
                    disabled={m.core || !isOwner}
                    onClick={() => toggleModule(m.key)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'bg-accent' : 'bg-line-strong'}`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="How workspaces stay isolated">
          <ul className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-1">
            {isolation.map((i) => (
              <li key={i.title} className="flex items-start gap-2.5 bg-white px-3.5 py-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                  <i.icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-ink">{i.title}</p>
                  <p className="text-[11.5px] text-muted">{i.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
