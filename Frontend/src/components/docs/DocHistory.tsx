import { GitCompareIcon, HistoryIcon, RotateCcwIcon } from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { DemoBadge, Unavailable } from '../work/Unavailable';
import { formatDateTime } from '../../utils/date';
import type { Member } from '../../types/team';
import type { ApiDocVersionMeta } from './useDocCollab';
import type { Availability } from '../work/apiState';

interface DocHistoryProps {
  status: Availability;
  versions: ApiDocVersionMeta[];
  demo: boolean;
  error: string | null;
  canEdit: boolean;
  comparing?: string;
  memberById: (id: string) => Member;
  onCompare: (v: ApiDocVersionMeta, label: string) => void;
  onRestore: (v: ApiDocVersionMeta, label: string) => void;
  onRetry: () => void;
}

/** The server numbers versions per doc (1-based), so labels stay stable. */
export function versionLabel(v: ApiDocVersionMeta) {
  return `v${v.number}`;
}

/** Server-recorded version history with compare and restore. */
export function DocHistory({
  status,
  versions,
  demo,
  error,
  canEdit,
  comparing,
  memberById,
  onCompare,
  onRestore,
  onRetry,
}: DocHistoryProps) {
  if (status === 'loading')
    return (
      <div className="space-y-2 p-3" aria-busy="true">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  if (status === 'unavailable')
    return (
      <Unavailable
        compact
        title="Version history isn't available"
        detail="The doc-collab service isn't deployed on this server, so versions aren't recorded. Saving still updates the doc."
        onRetry={onRetry}
      />
    );
  if (status === 'error')
    return (
      <Unavailable
        compact
        title="Couldn't load version history"
        detail={error ?? undefined}
        onRetry={onRetry}
      />
    );

  return (
    <div>
      {demo && (
        <p className="border-b border-line px-3 py-1.5">
          <DemoBadge />
        </p>
      )}
      {versions.length === 0 ? (
        <p className="px-3 py-6 text-center text-[12px] text-muted">
          No versions yet. Each save records one, and published docs are snapshotted when they
          change.
        </p>
      ) : (
        <ol className="divide-y divide-line" aria-label="Version history">
          {versions.map((ver, i) => {
            const label = versionLabel(ver);
            return (
              <li
                key={ver.id}
                className={`flex items-start gap-2 px-3 py-2 ${comparing === ver.id ? 'bg-accent-soft/40' : ''}`}
              >
                <HistoryIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-ink">
                    <span className="mr-1 font-mono text-[11px] text-muted">{label}</span>
                    {ver.summary || 'Edited'}
                  </p>
                  <p className="text-[11px] text-muted">
                    {memberById(ver.by).name} · {formatDateTime(new Date(ver.at))} ·{' '}
                    <span className="capitalize">{ver.status.replace('-', ' ')}</span>
                  </p>
                  <span className="mt-1 flex gap-3">
                    <button
                      type="button"
                      onClick={() => onCompare(ver, label)}
                      className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
                    >
                      <GitCompareIcon className="h-3 w-3" aria-hidden /> Compare
                    </button>
                    {canEdit && i > 0 && (
                      <button
                        type="button"
                        onClick={() => onRestore(ver, label)}
                        className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
                      >
                        <RotateCcwIcon className="h-3 w-3" aria-hidden /> Restore
                      </button>
                    )}
                  </span>
                </div>
                {i === 0 && <span className="text-[10.5px] font-semibold text-ok">Latest</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
