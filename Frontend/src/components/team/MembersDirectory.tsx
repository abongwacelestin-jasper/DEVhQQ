import { useEffect, useState } from 'react';
import { MembersToolbar, type MembersView } from './MembersToolbar';
import { MembersDataTable } from './MembersDataTable';
import { MemberCards } from './MemberCards';
import { exportMembersCsv, useMembersTable } from './useMembersTable';
import { useMemberActions } from './useMemberActions';
import type { Member, RoleName } from '../../types/team';

interface MembersDirectoryProps {
  members: Member[];
  /** Members who lead the project currently in scope. */
  leadIds: Set<string>;
  initialRole?: RoleName | '';
  /** Resyncs the directory after a server-side change. */
  onReload?: () => Promise<void>;
}

const VIEW_KEY = 'devhq.team.view';

/** Members tab: cards by default, a strict columnar table on demand. Choice is remembered. */
export function MembersDirectory({
  members,
  leadIds,
  initialRole = '',
  onReload,
}: MembersDirectoryProps) {
  const t = useMembersTable(members, initialRole);
  const { actionsFor, bulkDeactivate } = useMemberActions(onReload);
  const [view, setView] = useState<MembersView>(() =>
    localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards',
  );
  const picked = members.filter((m) => t.selected.has(m.id));

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  return (
    <section
      aria-label="Members"
      className="overflow-hidden rounded-lg border border-line bg-white"
    >
      <MembersToolbar
        t={t}
        members={members}
        view={view}
        onView={setView}
        picked={picked}
        onExport={() => exportMembersCsv(picked.length ? picked : t.rows)}
        onBulkDeactivate={() => bulkDeactivate(picked, t.clearSelection)}
      />

      {t.rows.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-[12.5px] font-medium text-ink">No members match these filters</p>
          <button
            onClick={t.resetFilters}
            className="mt-1 text-[12px] font-medium text-accent hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : view === 'cards' ? (
        <div className="bg-sunken/30">
          <MemberCards t={t} leadIds={leadIds} actionsFor={actionsFor} />
        </div>
      ) : (
        <MembersDataTable t={t} leadIds={leadIds} actionsFor={actionsFor} />
      )}
    </section>
  );
}
