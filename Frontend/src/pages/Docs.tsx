import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, LockIcon } from 'lucide-react';
import { DocsSidebar, type DocsView } from '../components/docs/DocsSidebar';
import { DocsHome, type DocSort } from '../components/docs/DocsHome';
import { NewDocModal } from '../components/docs/NewDocModal';
import { DocView } from '../components/docs/DocView';
import { useDocs } from '../contexts/DocsContext';
import { useAuth } from '../contexts/AuthContext';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { useStarredDocs } from '../hooks/useStarredDocs';
import { NOW } from '../utils/date';
import type { DocKind, DocStatus } from '../types/docs';

const keys = ['q', 'kind', 'status', 'view', 'sort'] as const;
const viewTitles: Record<DocsView, string> = {
  all: 'All docs',
  recent: 'Updated this week',
  starred: 'Starred',
  review: 'Needs review',
  mine: 'Edited by me',
};
const emptyHints: Record<DocsView, string> = {
  all: 'No docs in this scope yet. Start from a template above.',
  recent: 'Nothing changed in the last 7 days.',
  starred: 'Star a doc to pin it here.',
  review: 'No docs waiting on review.',
  mine: 'You haven’t edited any docs in this scope.',
};

export function Docs() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const { docs } = useDocs();
  const { canSeeProduct, session, canDo } = useAuth();
  const { matchesTask, allowedProjects, matchesProject, activeProject, scopeLabel } =
    useProductFilter();
  const { starred, isStarred, toggle } = useStarredDocs();
  const f = useUrlFilters(keys);
  const v = f.values;
  const view = (v.view as DocsView) || 'all';
  const [newOpen, setNewOpen] = useState(false);
  const [templateKind, setTemplateKind] = useState<DocKind>('spec');
  const me = session?.memberId ?? '';
  const canCreate = canDo('doc:create');

  // Access rules first (role + visibility), then the global product/project scope.
  const readable = useMemo(
    () =>
      docs.filter(
        (d) =>
          canSeeProduct(d.product) &&
          (d.visibility !== 'restricted' || d.editors.includes(me) || canDo('workspace:delete')),
      ),
    [docs, canSeeProduct, me, canDo],
  );
  const inScope = readable.filter((d) => matchesTask(d));
  const searched = inScope.filter(
    (d) => !v.q || `${d.title} ${d.body}`.toLowerCase().includes(v.q.toLowerCase()),
  );
  const weekAgo = NOW.getTime() - 7 * 86_400_000;

  const byView: Record<DocsView, typeof searched> = {
    all: searched,
    recent: searched.filter((d) => new Date(d.updatedAt).getTime() >= weekAgo),
    starred: searched.filter((d) => starred.includes(d.id)),
    review: searched.filter((d) => d.status === 'in-review'),
    mine: searched.filter((d) => d.editors.includes(me)),
  };
  const counts = Object.fromEntries(
    Object.entries(byView).map(([k, l]) => [k, l.length]),
  ) as Record<DocsView, number>;
  const list = byView[view].filter(
    (d) => (!v.kind || d.kind === v.kind) && (!v.status || d.status === v.status),
  );
  const doc = readable.find((d) => d.id === docId);
  const sidebarProjects = allowedProjects.filter((p) => matchesProject(p.id, p.product));

  const openTemplate = (k: DocKind) => {
    setTemplateKind(k);
    setNewOpen(true);
  };

  return (
    <div className="-mx-3 -mt-3.5 sm:-mx-4 lg:-mx-5 lg:-mt-4">
      <div className="flex min-h-[calc(100dvh-3rem)] flex-col bg-white md:flex-row">
        <DocsSidebar
          className={docId ? 'hidden md:flex' : 'flex'}
          docs={searched}
          projects={sidebarProjects}
          docId={docId}
          view={view}
          onView={(x) => {
            f.set('view', x === 'all' ? '' : x);
            if (docId) navigate(`/docs${x === 'all' ? '' : `?view=${x}`}`);
          }}
          counts={counts}
          query={v.q}
          onQuery={(q) => f.set('q', q)}
          activeProjectId={activeProject?.id}
          onNew={canCreate ? () => openTemplate('spec') : undefined}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {docId && (
            <Link
              to="/docs"
              className="flex items-center gap-1 border-b border-line px-4 py-2 text-[12px] font-medium text-muted hover:text-ink md:hidden"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" /> All docs
            </Link>
          )}
          {doc ? (
            <DocView doc={doc} />
          ) : docId ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <div>
                <LockIcon className="mx-auto h-5 w-5 text-subtle" />
                <p className="mt-2 text-[13px] font-semibold text-ink">
                  You don’t have access to this doc
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  It belongs to a project you aren’t assigned to, or it’s restricted to its editors.
                </p>
                <Link
                  to="/docs"
                  className="mt-2 inline-block text-[12.5px] font-medium text-accent hover:underline"
                >
                  Back to docs
                </Link>
              </div>
            </div>
          ) : (
            <DocsHome
              title={viewTitles[view]}
              scopeLabel={scopeLabel}
              docs={list}
              kind={v.kind as DocKind | ''}
              onKind={(k) => f.set('kind', k)}
              status={v.status as DocStatus | ''}
              onStatus={(s) => f.set('status', s)}
              sort={(v.sort as DocSort) || 'updated'}
              onSort={(s) => f.set('sort', s === 'updated' ? '' : s)}
              isStarred={isStarred}
              toggleStar={toggle}
              onTemplate={canCreate ? openTemplate : undefined}
              showTemplates={canCreate && view === 'all' && !v.q && !v.kind && !v.status}
              emptyHint={emptyHints[view]}
            />
          )}
        </div>
      </div>
      <NewDocModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        projectId={activeProject?.id}
        initialKind={templateKind}
      />
    </div>
  );
}
