import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, ListPlusIcon, ShieldOffIcon, WrenchIcon } from 'lucide-react';
import { PageHero } from '../components/ui/PageHero';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { ProductMark } from '../components/ui/ProductMark';
import { FilterBar } from '../components/filters/FilterBar';
import { BugShieldIllustration } from '../components/illustrations/BugShieldIllustration';
import {
  DataState,
  GuardedButton,
  LoadMore,
  SampleDataBadge,
} from '../components/engineering/states';
import { kindLabel, severityMeta, severityWeight } from '../components/engineering/findingMeta';
import { ago } from '../components/engineering/format';
import { useCodeFindings } from '../components/engineering/data/hooks';
import type { ApiCodeFinding } from '../components/engineering/data/types';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { useUrlFilters } from '../hooks/useUrlFilters';

const keys = ['q', 'severity', 'kind', 'repo', 'status'] as const;
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

const location = (x: ApiCodeFinding) =>
  x.file
    ? `${x.file}${x.line ? `:${x.line}` : ''}`
    : x.package
      ? `${x.package}${x.version ? `@${x.version}` : ''}`
      : x.repo;

export function CodeSecurity() {
  const { matches } = useProductFilter();
  const { openCreateTask } = useWorkspaceUI();
  const f = useUrlFilters(keys);
  const v = f.values;
  const list = useCodeFindings({ repo: v.repo || undefined });
  const apply = useCallback(
    (vals: Record<string, string>) =>
      f.setMany(Object.fromEntries(keys.map((k) => [k, vals[k] ?? '']))),
    [f],
  );

  // Findings without a product (repo not linked to one) are shown to everyone the server already scoped them to.
  const scoped = useMemo(
    () => list.items.filter((x) => !x.product || matches(x.product)),
    [list.items, matches],
  );
  const rows = useMemo(
    () =>
      scoped
        .filter(
          (x) =>
            (!v.q ||
              `${x.title} ${location(x)} ${x.advisory ?? ''}`
                .toLowerCase()
                .includes(v.q.toLowerCase())) &&
            (!v.severity || x.severity === v.severity) &&
            (!v.kind || x.kind === v.kind) &&
            ((v.status || 'open') === 'all' || x.status === (v.status || 'open')),
        )
        .sort((a, b) => severityMeta[a.severity].rank - severityMeta[b.severity].rank),
    [scoped, v],
  );
  const open = scoped.filter((x) => x.status === 'open');
  const repos = useMemo(() => [...new Set(scoped.map((x) => x.repo))].sort(), [scoped]);
  const ready = list.status === 'ready';
  const score = Math.max(0, 100 - open.reduce((s, x) => s + severityWeight[x.severity], 0));

  return (
    <div className="space-y-3.5">
      <PageHero
        illustration={<BugShieldIllustration className="h-[84px] w-auto" />}
        title="Code security"
        description="Dependency vulnerabilities, leaked secrets, unsafe code and license problems reported by CI and GitHub — each with a fix."
        actions={
          <>
            <SampleDataBadge source={list.source} />
            <Link
              to="/dev-tools"
              className="inline-flex h-7 items-center rounded-md border border-line bg-white px-2.5 text-[12px] font-medium text-ink hover:border-line-strong"
            >
              Install pre-commit hook
            </Link>
          </>
        }
        stats={
          ready
            ? [
                {
                  label: 'Security score',
                  value: `${score}/100`,
                  tone: score >= 80 ? 'ok' : score >= 60 ? 'warn' : 'bad',
                },
                {
                  label: 'Critical',
                  value: open.filter((x) => x.severity === 'critical').length,
                  tone: open.some((x) => x.severity === 'critical') ? 'bad' : undefined,
                },
                {
                  label: 'High',
                  value: open.filter((x) => x.severity === 'high').length,
                  tone: open.some((x) => x.severity === 'high') ? 'warn' : undefined,
                },
                { label: 'Open', value: open.length },
                {
                  label: 'Fixed',
                  value: scoped.filter((x) => x.status === 'fixed').length,
                  tone: 'ok',
                },
              ]
            : undefined
        }
      />

      {!ready ? (
        <DataState
          status={list.status}
          error={list.error}
          what="Code findings"
          github
          onRetry={list.reload}
        />
      ) : (
        <>
          <FilterBar
            id="code-security"
            values={v}
            onChange={(k, val) => f.set(k as (typeof keys)[number], val)}
            onApply={apply}
            onReset={f.reset}
            activeCount={f.activeCount}
            count={rows.length}
            noun="findings"
            search={{ key: 'q', placeholder: 'Search title, file, advisory…' }}
            selects={[
              {
                key: 'severity',
                label: 'Severity',
                options: Object.entries(severityMeta).map(([value, m]) => ({
                  value,
                  label: m.label,
                })),
              },
              {
                key: 'kind',
                label: 'Type',
                options: Object.entries(kindLabel).map(([value, label]) => ({ value, label })),
              },
              {
                key: 'repo',
                label: 'Repo',
                options: repos.map((r) => ({ value: r, label: r })),
              },
              {
                key: 'status',
                label: 'Status',
                options: [
                  { value: 'all', label: 'Any status' },
                  { value: 'fixed', label: 'Fixed' },
                  { value: 'dismissed', label: 'Dismissed' },
                ],
              },
            ]}
            presets={[
              { label: 'Critical', values: { severity: 'critical' } },
              { label: 'Leaked secrets', values: { kind: 'secret', status: 'all' } },
            ]}
          />

          <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section
              className="min-w-0 overflow-hidden rounded-lg border border-line bg-white"
              aria-label="Findings"
            >
              {rows.length === 0 ? (
                <p className="px-3.5 py-8 text-center text-[12.5px] text-muted">
                  {scoped.length ? 'No findings match these filters.' : 'No findings reported.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[12px]">
                    <caption className="sr-only">Code security findings</caption>
                    <thead className="border-b border-line bg-sunken/40 text-[11px] text-muted">
                      <tr>
                        <th scope="col" className="w-[76px] px-3.5 py-1.5 font-medium">
                          Severity
                        </th>
                        <th scope="col" className="px-2 py-1.5 font-medium">
                          Finding
                        </th>
                        <th scope="col" className="w-[160px] px-2 py-1.5 font-medium">
                          Repository
                        </th>
                        <th scope="col" className="px-3.5 py-1.5 text-right font-medium">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map((x) => (
                        <tr key={x.id} className="align-top">
                          <td className="px-3.5 py-2">
                            <span
                              className={`w-fit rounded px-1.5 py-0.5 text-[10.5px] font-bold ${severityMeta[x.severity].cls}`}
                            >
                              {severityMeta[x.severity].label}
                            </span>
                          </td>
                          <td className="min-w-0 px-2 py-2">
                            <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                              {x.title}
                              <span className="rounded bg-sunken px-1 text-[10.5px] font-medium text-ink">
                                {kindLabel[x.kind]}
                              </span>
                              {x.advisory && (
                                <span className="font-mono text-[10.5px] text-muted">
                                  {x.advisory}
                                </span>
                              )}
                            </p>
                            <p className="truncate font-mono text-[11.5px] text-muted">
                              {location(x)} · {ago(x.detectedAt)}
                            </p>
                            {(x.fixedIn || x.detail) && (
                              <p className="mt-0.5 text-ink">
                                <WrenchIcon className="mr-1 inline h-3 w-3 text-ok" aria-hidden />
                                {x.fixedIn ? `Upgrade to ${x.fixedIn}` : x.detail}
                              </p>
                            )}
                            {x.status !== 'open' && (
                              <p className="text-muted">Status: {x.status}</p>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <span className="flex items-center gap-1.5">
                              {x.product && <ProductMark product={x.product} size="sm" />}
                              <span className="truncate font-mono text-[11.5px]">{x.repo}</span>
                            </span>
                          </td>
                          <td className="px-3.5 py-2">
                            {x.status === 'open' && (
                              <span className="flex justify-end gap-1">
                                <Button
                                  size="sm"
                                  aria-label={`Create task for ${x.title}`}
                                  title="Create task"
                                  icon={<ListPlusIcon className="h-3.5 w-3.5" />}
                                  onClick={() =>
                                    openCreateTask({
                                      title: `Security: ${x.title}`,
                                      type: 'bug',
                                      priority:
                                        x.severity === 'critical' || x.severity === 'high'
                                          ? 'urgent'
                                          : 'medium',
                                    })
                                  }
                                />
                                <GuardedButton
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Dismiss ${x.title}`}
                                  allowed={false}
                                  reason="No backend endpoint yet — dismiss in GitHub"
                                  icon={<ShieldOffIcon className="h-3.5 w-3.5" />}
                                />
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
            </section>

            <div className="grid content-start gap-3.5 md:grid-cols-2 xl:grid-cols-1">
              <Panel title="By repository">
                {repos.length === 0 ? (
                  <p className="px-3.5 py-3 text-[12px] text-muted">No repositories reported.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {repos.map((r) => {
                      const n = open.filter((x) => x.repo === r);
                      return (
                        <li key={r}>
                          <button
                            onClick={() => f.set('repo', v.repo === r ? '' : r)}
                            aria-pressed={v.repo === r}
                            className={`flex w-full items-center gap-2 px-3.5 py-1.5 text-left hover:bg-sunken/50 ${v.repo === r ? 'bg-accent-soft/50' : ''}`}
                          >
                            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                              {r}
                            </span>
                            {SEVERITIES.map((s) => {
                              const c = n.filter((x) => x.severity === s).length;
                              return c ? (
                                <span
                                  key={s}
                                  title={`${c} ${severityMeta[s].label}`}
                                  className={`rounded px-1 text-[10.5px] font-bold ${severityMeta[s].cls}`}
                                >
                                  {c}
                                </span>
                              ) : null;
                            })}
                            {n.length === 0 && (
                              <CheckIcon
                                className="h-3.5 w-3.5 text-ok"
                                aria-label="No open findings"
                              />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
              <Panel title="Policies">
                <p className="px-3.5 py-3 text-[12px] leading-relaxed text-muted">
                  Merge blocking, secret push protection and signed-commit rules aren’t served by
                  the DevHQ API yet. Configure them in GitHub branch protection and repository
                  security settings.
                </p>
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
