import { useState } from 'react';
import { ExternalLinkIcon, GitBranchIcon, PlusIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { githubPermissions } from '../../hooks/useGitHubApp';
import { fetchInstallUrl } from './data/hooks';
import type { ResourceState } from './data/useApi';
import type { ApiGitHubApp } from './data/types';
import { GuardedButton, InlineError, SampleDataBadge } from './states';
import { Skeleton } from '../ui/Skeleton';
import { formatDay } from '../../utils/date';

interface GitHubAppPanelProps {
  app: ResourceState<ApiGitHubApp>;
  repoCount: number;
  onLink: () => void;
}

const MANAGE_REASON = 'Needs Repository: manage — ask an Owner';

/**
 * Installation status as the server reports it (`GET /api/github/app`).
 * Permissions, repository selection and suspension are managed on GitHub,
 * so this panel links there instead of pretending to change them.
 */
export function GitHubAppPanel({ app, repoCount, onLink }: GitHubAppPanelProps) {
  const { canDo } = useAuth();
  const allowed = canDo('github:configure');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);

  if (app.status === 'loading') return <Skeleton className="h-[120px] w-full" />;
  // Unconfigured/unavailable is rendered by the page's Connect GitHub state.
  if (app.status !== 'ready' || !app.data) return null;

  const inst = app.data;
  const perms = inst.permissions ?? {};
  const writes = Object.entries(perms)
    .filter(([, v]) => v === 'write')
    .map(([k]) => k.replace('_', ' '));

  const manage = async () => {
    setBusy(true);
    setErr(null);
    const url = await fetchInstallUrl();
    setBusy(false);
    if (url && /^https:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
    else setErr(new Error('The server did not return a GitHub install link.'));
  };

  return (
    <section
      className="grid overflow-hidden rounded-lg border border-line bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
      aria-label="GitHub App"
    >
      <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-ink text-white">
            <GitBranchIcon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink">
              TavetaHQ GitHub App
              <span
                className={`rounded px-1.5 py-px text-[11px] font-semibold ${
                  !inst.installed
                    ? 'bg-sunken text-muted'
                    : inst.suspended
                      ? 'bg-warn-soft text-warn'
                      : 'bg-ok-soft text-ok'
                }`}
              >
                {!inst.installed ? 'Not installed' : inst.suspended ? 'Suspended' : 'Active'}
              </span>
              <SampleDataBadge source={inst.source} />
            </h2>
            <p className="text-[12px] text-muted">
              {inst.installed ? (
                <>
                  Installed on <b className="text-ink">{inst.account ?? '—'}</b> ·{' '}
                  {inst.repositorySelection === 'all'
                    ? 'all repositories'
                    : `${repoCount} linked repositor${repoCount === 1 ? 'y' : 'ies'}`}
                  {inst.installedAt && ` · since ${formatDay(new Date(inst.installedAt))}`}
                </>
              ) : (
                'The app is configured on this server but not installed on an organisation.'
              )}
            </p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          <div>
            <dt className="text-muted">Write access</dt>
            <dd className="font-medium text-ink">
              {writes.length ? writes.join(', ') : 'None · read-only'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Webhook events</dt>
            <dd className="font-medium text-ink">
              {inst.events?.length ? `${inst.events.length} subscribed` : '—'}
            </dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <GuardedButton
            allowed={allowed}
            reason={MANAGE_REASON}
            size="sm"
            variant="primary"
            icon={<PlusIcon className="h-3.5 w-3.5" />}
            onClick={onLink}
            disabled={!inst.installed}
          >
            Link repository
          </GuardedButton>
          <GuardedButton
            allowed={allowed}
            reason={MANAGE_REASON}
            size="sm"
            icon={<ExternalLinkIcon className="h-3.5 w-3.5" />}
            onClick={manage}
            disabled={busy}
          >
            {inst.installed ? 'Manage on GitHub' : 'Install on GitHub'}
          </GuardedButton>
        </div>
        <InlineError error={err} />
      </div>
      <div className="min-w-0">
        <h3 className="border-b border-line px-4 py-2 text-[12.5px] font-semibold text-ink">
          Granted permissions
        </h3>
        <table className="w-full text-[12px]">
          <caption className="sr-only">GitHub App permissions as granted on GitHub</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Permission</th>
              <th scope="col">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {githubPermissions.map((p) => {
              const level = perms[p.id] ?? 'none';
              return (
                <tr key={p.id}>
                  <th scope="row" className="px-4 py-1.5 text-left font-normal text-ink">
                    {p.label}
                  </th>
                  <td
                    className={`px-4 py-1.5 text-right font-mono ${level === 'write' ? 'text-warn' : level === 'read' ? 'text-ink' : 'text-muted'}`}
                  >
                    {inst.permissions ? level : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
