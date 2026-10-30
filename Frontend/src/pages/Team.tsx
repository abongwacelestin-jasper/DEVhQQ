import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderIcon, UserPlusIcon } from 'lucide-react';
import { UnderlineTabs } from '../components/ui/UnderlineTabs';
import { StatCard, StatStrip } from '../components/ui/StatCard';
import { MembersDirectory } from '../components/team/MembersDirectory';
import { RolesPanel } from '../components/team/RolesPanel';
import { AccessReview, accessReviewItems } from '../components/team/AccessReview';
import { InviteModal } from '../components/team/InviteModal';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useAuth } from '../contexts/AuthContext';
import { useWork } from '../contexts/WorkContext';
import { useTeamData } from '../hooks/useTeamData';
import type { RoleName } from '../types/team';

type Tab = 'members' | 'roles' | 'review';

export function Team() {
  const { matches, activeProject, scopeLabel } = useProductFilter();
  const { canDo } = useAuth();
  const { tasks } = useWork();
  const { members, matrix, pendingGrants, activeGrants, loading, error, reload } = useTeamData();
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
  const invited = scoped.filter((m) => m.status === 'invited').length;
  const noMfa = active.filter((m) => !m.mfa).length;
  const scopedGrants = pendingGrants.filter((g) => scoped.some((m) => m.id === g.memberId));
  const reviewCount = accessReviewItems(scoped, pendingGrants).length;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold tracking-tight text-ink">Team & roles</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
            {activeProject && <FolderIcon className="h-3.5 w-3.5 text-subtle" />}
            {activeProject
              ? `People working on ${scopeLabel}`
              : `Members see only the products they’re assigned to · ${scopeLabel}`}
          </p>
        </div>
        {canDo('member:invite') && (
          <button
            onClick={() => setParams({ invite: '1' })}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12.5px] font-semibold text-white transition-colors duration-150 hover:bg-ink/90"
          >
            <UserPlusIcon className="h-3.5 w-3.5" /> Invite
          </button>
        )}
      </header>

      {error && (
        <p className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-1.5 text-[12px] text-warn">
          {error} The directory below may be incomplete.
        </p>
      )}

      <StatStrip>
        <StatCard label="Members" value={scoped.length} note={loading ? 'Loading…' : 'In your scope'} />
        <StatCard label="Active" value={active.length} note="Can sign in today" />
        <StatCard label="Invited" value={invited} note="Not yet activated" tone={invited ? 'info' : undefined} />
        <StatCard
          label="Without MFA"
          value={noMfa}
          note="Blocked from production"
          tone={noMfa ? 'bad' : 'ok'}
        />
        <StatCard
          label="Pending grants"
          value={scopedGrants.length}
          note="JIT access awaiting approval"
          tone={scopedGrants.length ? 'warn' : 'neutral'}
        />
        <StatCard label="Active grants" value={activeGrants.length} note="Time-boxed production" />
      </StatStrip>

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
          onReload={reload}
        />
      )}
      {tab === 'roles' && (
        <RolesPanel
          members={scoped}
          matrix={matrix}
          onViewMembers={(r) => {
            setRoleFilter(r);
            setTab('members');
          }}
        />
      )}
      {tab === 'review' && (
        <AccessReview members={scoped} grants={pendingGrants} onReload={reload} />
      )}

      <InviteModal open={inviteOpen} onClose={() => setParams({})} onInvited={reload} />
    </div>
  );
}
