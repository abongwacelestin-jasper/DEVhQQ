import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CheckIcon,
  ListPlusIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ShieldOffIcon,
  WrenchIcon,
} from 'lucide-react';
import { PageHero } from '../components/ui/PageHero';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { ProductMark } from '../components/ui/ProductMark';
import { Avatar } from '../components/ui/Avatar';
import { Modal, Field, inputClass } from '../components/ui/Modal';
import { FilterBar } from '../components/filters/FilterBar';
import { BugShieldIllustration } from '../components/illustrations/BugShieldIllustration';
import { useAuth } from '../contexts/AuthContext';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useWorkspaceUI } from '../contexts/WorkspaceUIContext';
import { useReauth } from '../contexts/ReauthContext';
import { useUrlFilters } from '../hooks/useUrlFilters';
import {
  kindLabel,
  securityPolicies,
  seedFindings,
  severityMeta,
  type SecurityFinding,
} from '../data/codeSecurity';
import { repositories } from '../data/engineering';
import { firstName } from '../utils/status';
import { relative } from '../utils/date';

const keys = ['q', 'severity', 'kind', 'repo', 'status', 'mine'] as const;

export function CodeSecurity() {
  const { session, canDo, log } = useAuth();
  const { matches } = useProductFilter();
  const { openCreateTask } = useWorkspaceUI();
  const { requestReauth } = useReauth();
  const f = useUrlFilters(keys);
  const v = f.values;
  const [findings, setFindings] = useState<SecurityFinding[]>(seedFindings);
  const [policies, setPolicies] = useState(securityPolicies);
  const [scanning, setScanning] = useState(false);
  const [dismissing, setDismissing] = useState<SecurityFinding | null>(null);
  const [reason, setReason] = useState('');
  const me = session?.memberId ?? 'm1';
  const apply = useCallback(
    (vals: Record<string, string>) =>
      f.setMany(Object.fromEntries(keys.map((k) => [k, vals[k] ?? '']))),
    [f],
  );

  const scoped = findings.filter((x) => matches(x.product));
  const rows = useMemo(
    () =>
      scoped
        .filter(
          (x) =>
            (!v.q ||
              `${x.title} ${x.location} ${x.cve ?? ''}`
                .toLowerCase()
                .includes(v.q.toLowerCase())) &&
            (!v.severity || x.severity === v.severity) &&
            (!v.kind || x.kind === v.kind) &&
            (!v.repo || x.repo === v.repo) &&
            ((v.status || 'open') === 'all' || x.status === (v.status || 'open')) &&
            (!v.mine || x.owner === me),
        )
        .sort((a, b) => severityMeta[a.severity].rank - severityMeta[b.severity].rank),
    [scoped, v, me],
  );
  const open = scoped.filter((x) => x.status === 'open');
  const score = Math.max(
    0,
    100 - open.reduce((s, x) => s + { critical: 25, high: 12, medium: 5, low: 2 }[x.severity], 0),
  );

  const patch = (id: string, p: Partial<SecurityFinding>) =>
    setFindings((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const rescan = () => {
    setScanning(true);
    setTimeout(() => {
      setScanning(false);
      toast.success('Scan complete', {
        description: `${repositories.filter((r) => matches(r.product)).length} repositories · no new findings`,
      });
      log('Ran code security scan', 'All repositories');
    }, 1400);
  };

  return (
    <div className="space-y-3.5">
      <PageHero
        illustration={<BugShieldIllustration className="h-[84px] w-auto" />}
        title="Code security"
        description="Dependency vulnerabilities, leaked secrets, unsafe code and license problems across your repositories — each with an owner and a fix."
        actions={
          <>
            <Button
              size="sm"
              variant="primary"
              icon={
                scanning ? (
                  <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCwIcon className="h-3.5 w-3.5" />
                )
              }
              onClick={rescan}
              disabled={scanning}
            >
              {scanning ? 'Scanning…' : 'Run scan'}
            </Button>
            <Link
              to="/dev-tools"
              className="inline-flex h-7 items-center rounded-md border border-line bg-white px-2.5 text-[12px] font-medium text-ink hover:border-line-strong"
            >
              Install pre-commit hook
            </Link>
          </>
        }
        stats={[
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
          { label: 'Assigned to me', value: open.filter((x) => x.owner === me).length },
          { label: 'Fixed', value: scoped.filter((x) => x.status === 'fixed').length, tone: 'ok' },
        ]}
      />

      <FilterBar
        id="code-security"
        values={v}
        onChange={(k, val) => f.set(k as (typeof keys)[number], val)}
        onApply={apply}
        onReset={f.reset}
        activeCount={f.activeCount}
        count={rows.length}
        noun="findings"
        search={{ key: 'q', placeholder: 'Search title, file, CVE…' }}
        selects={[
          {
            key: 'severity',
            label: 'Severity',
            options: Object.entries(severityMeta).map(([value, m]) => ({ value, label: m.label })),
          },
          {
            key: 'kind',
            label: 'Type',
            options: Object.entries(kindLabel).map(([value, label]) => ({ value, label })),
          },
          {
            key: 'repo',
            label: 'Repo',
            options: repositories
              .filter((r) => matches(r.product))
              .map((r) => ({ value: r.name, label: r.name })),
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
        toggles={[{ key: 'mine', label: 'Assigned to me' }]}
        presets={[
          { label: 'Critical & high', values: { severity: 'critical' } },
          { label: 'Leaked secrets', values: { kind: 'secret', status: 'all' } },
        ]}
      />

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section
          className="min-w-0 overflow-hidden rounded-lg border border-line bg-white"
          aria-label="Findings"
        >
          <div className="hidden grid-cols-[76px_minmax(0,1fr)_150px_90px_auto] gap-3 border-b border-line bg-sunken/40 px-3.5 py-1.5 text-[11px] font-medium text-muted md:grid">
            <span>Severity</span>
            <span>Finding</span>
            <span>Repository</span>
            <span>Owner</span>
            <span className="text-right">Actions</span>
          </div>
          {rows.length === 0 && (
            <p className="px-3.5 py-8 text-center text-[12.5px] text-muted">
              No findings match. 🎉 Nice and clean.
            </p>
          )}
          <ul className="divide-y divide-line">
            {rows.map((x) => (
              <li
                key={x.id}
                className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 px-3.5 py-2 md:grid-cols-[76px_minmax(0,1fr)_150px_90px_auto] md:items-center"
              >
                <span
                  className={`w-fit rounded px-1.5 py-0.5 text-[10.5px] font-bold ${severityMeta[x.severity].cls}`}
                >
                  {severityMeta[x.severity].label}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                    <span className="font-mono text-[11px] font-medium text-muted">{x.id}</span>{' '}
                    {x.title}
                    <span className="rounded bg-sunken px-1 text-[10.5px] font-medium text-ink">
                      {kindLabel[x.kind]}
                    </span>
                    {x.cve && <span className="font-mono text-[10.5px] text-muted">{x.cve}</span>}
                  </p>
                  <p className="truncate font-mono text-[11.5px] text-muted">{x.location}</p>
                  <p className="mt-0.5 text-[12px] text-ink">
                    <WrenchIcon className="mr-1 inline h-3 w-3 text-ok" />
                    {x.fix}
                    {x.status !== 'open' && (
                      <span className="ml-1 text-muted">
                        · {x.status}
                        {x.dismissReason ? ` — ${x.dismissReason}` : ''}
                      </span>
                    )}
                  </p>
                </div>
                <span className="col-start-2 flex items-center gap-1.5 text-[12px] text-ink md:col-start-auto">
                  <ProductMark product={x.product} size="sm" />
                  <span className="truncate font-mono text-[11.5px]">{x.repo}</span>
                </span>
                <span className="col-start-2 flex items-center gap-1.5 text-[12px] text-ink md:col-start-auto">
                  {x.owner && (
                    <>
                      <Avatar id={x.owner} size="xs" />
                      {firstName(x.owner)}
                    </>
                  )}
                  <span className="text-[11px] text-muted md:hidden">
                    · {relative(new Date(x.detectedAt))}
                  </span>
                </span>
                <span className="col-start-2 flex justify-start gap-1 md:col-start-auto md:justify-end">
                  {x.status === 'open' ? (
                    <>
                      <Button
                        size="sm"
                        aria-label="Create task"
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
                      <Button
                        size="sm"
                        icon={<CheckIcon className="h-3.5 w-3.5 text-ok" />}
                        onClick={() => {
                          patch(x.id, { status: 'fixed' });
                          log('Marked finding fixed', `${x.id} ${x.title}`);
                          toast.success(`${x.id} marked fixed`, {
                            description: 'Will be re-verified on the next scan.',
                          });
                        }}
                      >
                        Fixed
                      </Button>
                      {canDo('security:dismiss') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Dismiss"
                          icon={<ShieldOffIcon className="h-3.5 w-3.5" />}
                          onClick={() => {
                            setReason('');
                            setDismissing(x);
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => patch(x.id, { status: 'open', dismissReason: undefined })}
                    >
                      Reopen
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid content-start gap-3.5 md:grid-cols-2 xl:grid-cols-1">
          <Panel title="By repository">
            <ul className="divide-y divide-line">
              {repositories
                .filter((r) => matches(r.product))
                .map((r) => {
                  const n = open.filter((x) => x.repo === r.name);
                  return (
                    <li key={r.name}>
                      <button
                        onClick={() => f.set('repo', v.repo === r.name ? '' : r.name)}
                        className={`flex w-full items-center gap-2 px-3.5 py-1.5 text-left hover:bg-sunken/50 ${v.repo === r.name ? 'bg-accent-soft/50' : ''}`}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                          {r.name}
                        </span>
                        {(['critical', 'high', 'medium', 'low'] as const).map((s) => {
                          const c = n.filter((x) => x.severity === s).length;
                          return c ? (
                            <span
                              key={s}
                              className={`rounded px-1 text-[10.5px] font-bold ${severityMeta[s].cls}`}
                            >
                              {c}
                            </span>
                          ) : null;
                        })}
                        {n.length === 0 && <CheckIcon className="h-3.5 w-3.5 text-ok" />}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </Panel>
          <Panel title="Policies">
            <ul className="divide-y divide-line">
              {policies.map((p) => (
                <li key={p.id}>
                  <label className="flex items-center justify-between gap-3 px-3.5 py-2 text-[12.5px] text-ink">
                    {p.label}
                    <input
                      type="checkbox"
                      checked={p.on}
                      disabled={!canDo('security:dismiss')}
                      onChange={() =>
                        requestReauth({
                          title: `${p.on ? 'Disable' : 'Enable'} policy`,
                          description: p.label,
                          actionLabel: 'Verify & save',
                          onConfirm: () => {
                            setPolicies((l) =>
                              l.map((x) => (x.id === p.id ? { ...x, on: !x.on } : x)),
                            );
                            log(
                              'Changed security policy',
                              `${p.label} → ${p.on ? 'off' : 'on'}`,
                              true,
                            );
                          },
                        })
                      }
                      className="h-4 w-4 accent-[#0F1115]"
                    />
                  </label>
                </li>
              ))}
            </ul>
            {!canDo('security:dismiss') && (
              <p className="border-t border-line px-3.5 py-2 text-[11.5px] text-muted">
                Only admins change policies.
              </p>
            )}
          </Panel>
        </div>
      </div>

      <Modal
        open={!!dismissing}
        onClose={() => setDismissing(null)}
        title={`Dismiss ${dismissing?.id}`}
        description="Dismissals need a reason and MFA. They’re reviewed in the audit log."
        size="sm"
        footer={
          <>
            <Button onClick={() => setDismissing(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 10}
              onClick={() => {
                const x = dismissing!;
                requestReauth({
                  title: `Dismiss ${x.id}`,
                  description: reason,
                  actionLabel: 'Verify & dismiss',
                  onConfirm: () => {
                    patch(x.id, { status: 'dismissed', dismissReason: reason.trim() });
                    log('Dismissed security finding', `${x.id} · ${reason.trim()}`, true);
                    setDismissing(null);
                  },
                });
              }}
            >
              Dismiss
            </Button>
          </>
        }
      >
        <Field label="Reason" hint="At least 10 characters.">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className={`${inputClass} h-auto py-1.5`}
            placeholder="e.g. Not reachable from user input"
          />
        </Field>
      </Modal>
    </div>
  );
}
