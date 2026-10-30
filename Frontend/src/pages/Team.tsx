import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderIcon, UserPlusIcon } from 'lucide-react';
import { UnderlineTabs } from '../components/ui/UnderlineTabs';
import { MembersDirectory } from '../components/team/MembersDirectory';
import { RolesPanel } from '../components/team/RolesPanel';
import { AccessReview, accessReviewItems } from '../components/team/AccessReview';
import { InviteModal } from '../components/team/InviteModal';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useAuth } from '../contexts/AuthContext';
import { useWork } from '../contexts/WorkContext';
import { members } from '../data/team';
import type { RoleName } from '../types/team';

type Tab = 'members' | 'roles' | 'review';

export function Team() {
  const { matches, activeProject, scopeLabel } = useProductFilter();
  const { canDo } = useAuth();
  const { tasks } = useWork();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('members');
  const [roleFilter, setRoleFilter] = useState<RoleName | ''>('');
  const inviteOpen = params.get('invite') === '1';

  // Project scope narrows to people who lead or hold work on that project.
  const projectPeople = activeProject
    ? new Set([
        activeProject.lead,
        ...tasks
          .filter((t) => t.projectId === activeProject.id)
          .flatMap((t) => [t.assignee, t.reviewer ?? '']),
      ])
    : null;
  const scoped = members.filter(
    (m) => m.products.some(matches) && (!projectPeople || projectPeople.has(m.id)),
  );
  const leadIds = new Set(activeProject ? [activeProject.lead] : []);
  const active = scoped.filter((m) => m.status === 'active');
  const noMfa = active.filter((m) => !m.mfa).length;
  const prod = scoped.filter((m) => m.productionAccess).length;
  const invited = scoped.filter((m) => m.status === 'invited').length;
  const reviewCount = accessReviewItems(scoped).length;

  const stats: { label: string; value: number; tone?: 'bad' | 'warn' }[] = [
    { label: 'Members', value: scoped.length },
    { label: 'Active', value: active.length },
    { label: 'Invited', value: invited },
    { label: 'Without MFA', value: noMfa, tone: noMfa ? 'bad' : undefined },
    { label: 'Production', value: prod, tone: prod ? 'warn' : undefined },
  ];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold tracking-tight text-ink">Team & roles</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
            {activeProject && <FolderIcon className="h-3.5 w-3.5 text-subtle" />}
            {activeProject
              ? `People working on ${scopeLabel}`
              : `Members see only the products they’re assigned to · ${scopeLabel}`}
          </p>
        </div>
        <dl className="no-scrollbar flex max-w-full items-stretch divide-x divide-line overflow-x-auto rounded-md border border-line bg-white">
          {stats.map((s) => (
            <div key={s.label} className="flex shrink-0 items-baseline gap-1.5 px-2.5 py-1">
              <dd
                className={`text-[13px] font-semibold tabular-nums ${s.tone === 'bad' ? 'text-bad' : s.tone === 'warn' ? 'text-warn' : 'text-ink'}`}
              >
                {s.value}
              </dd>
              <dt className="whitespace-nowrap text-[11px] text-muted">{s.label}</dt>
            </div>
          ))}
        </dl>
        {canDo('member:invite') && (
          <button
            onClick={() => setParams({ invite: '1' })}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12.5px] font-semibold text-white transition-colors duration-150 hover:bg-ink/90"
          >
            <UserPlusIcon className="h-3.5 w-3.5" /> Invite
          </button>
        )}
      </header>

      <UnderlineTabs<Tab>
        label="Team view"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'members', label: 'Members', count: scoped.length },
          {
            value: 'roles',
            label: 'Roles & permissions',
            count: new Set(scoped.map((m) => m.role)).size,
          },
          { value: 'review', label: 'Access review', count: reviewCount, tone: 'warn' },
        ]}
      />

      {tab === 'members' && (
        <MembersDirectory
          key={roleFilter}
          members={scoped}
          leadIds={leadIds}
          initialRole={roleFilter}
        />
      )}
      {tab === 'roles' && (
        <RolesPanel
          members={scoped}
          onViewMembers={(r) => {
            setRoleFilter(r);
            setTab('members');
          }}
        />
      )}
      {tab === 'review' && <AccessReview members={scoped} />}

      <InviteModal open={inviteOpen} onClose={() => setParams({})} />
    </div>
  );
}
