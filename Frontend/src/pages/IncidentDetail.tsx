import React, { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BellRingIcon,
  CircleCheckIcon,
  EyeIcon,
  Link2Icon,
  MessageSquareIcon,
  RotateCcwIcon,
  SendIcon,
  SirenIcon,
  TriangleAlertIcon,
  UndoIcon,
} from 'lucide-react';
import { PageHero } from '../components/ui/PageHero';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ProductMark } from '../components/ui/ProductMark';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { NotFound } from '../components/ui/NotFound';
import { capitalize, incidentStatusTone, severityTone } from '../components/operations/IncidentRow';
import { FirefighterIllustration } from '../components/illustrations/FirefighterIllustration';
import { useIncidents } from '../contexts/IncidentContext';
import { useReauth } from '../contexts/ReauthContext';
import { useAuth } from '../contexts/AuthContext';
import { GuardedButton, InlineError, LoadingRows } from '../components/engineering/states';
import { useMonitors, useServerLevel } from '../components/engineering/data/hooks';
import { useDeployments, type DeploymentRow } from '../hooks/useDeployments';
import { currentUserId } from '../data/team';
import { firstName, memberById, productById } from '../utils/status';
import type { IncidentEvent } from '../types/operations';
import { ProductionAccessStatus } from '../components/jit/ProductionAccessStatus';

const RelationshipGraph = lazy(() => import('../components/operations/RelationshipGraph'));

/** Deployments of the same product in the 24h before the incident started: correlation, not cause. */
const WINDOW_MS = 24 * 3_600_000;
function correlatedDeploys(rows: DeploymentRow[], product: string, startedAt?: string) {
  if (!startedAt) return [];
  const start = new Date(startedAt).getTime();
  return rows
    .filter((d) => {
      const t = new Date(d.createdAt).getTime();
      return d.product === product && t <= start && start - t <= WINDOW_MS;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);
}

const eventIcon: Record<IncidentEvent['kind'], React.ComponentType<{ className?: string }>> = {
  alert: BellRingIcon,
  system: SirenIcon,
  link: Link2Icon,
  note: MessageSquareIcon,
  action: UndoIcon,
};

export function IncidentDetail() {
  const { incidentId } = useParams();
  const { incidents, setStatus, addEvent, loading, writeError, times } = useIncidents();
  const { requestReauth } = useReauth();
  const { canDo, canSeeProduct } = useAuth();
  const { atLeast } = useServerLevel();
  const { deployments, rollback, actionError } = useDeployments();
  const monitors = useMonitors();
  const [note, setNote] = useState('');
  const incident = incidents.find((i) => i.id === incidentId);
  const related = useMemo(
    () =>
      incident
        ? correlatedDeploys(deployments, incident.product, times[incident.id]?.startedAt)
        : [],
    [incident, deployments, times],
  );
  if (!incident && loading) return <LoadingRows rows={5} label="Loading incident" />;
  if (!incident || !canSeeProduct(incident.product))
    return <NotFound what="Incident" backTo="/incidents" backLabel="Back to incidents" />;

  const resolved = incident.status === 'resolved';
  const deploy = related.find((d) => d.env === 'production') ?? related[0];
  // A monitor watching this service: same product, service name in its name or URL.
  const monitor =
    monitors.status === 'ready'
      ? monitors.items.find(
          (m) =>
            m.product === incident.product &&
            `${m.name} ${m.url}`.toLowerCase().includes(incident.service.toLowerCase()),
        )
      : undefined;
  const isOps = canDo('incident:declare');
  const mayRollback = atLeast('Deployment', 'manage');

  const postNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    addEvent(incident.id, {
      title: `Note from ${firstName(currentUserId)}`,
      detail: note.trim(),
      kind: 'note',
    });
    setNote('');
  };

  return (
    <div className="space-y-3.5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12px] text-muted">
        <Link to="/incidents" className="hover:text-ink hover:underline">
          Incidents
        </Link>
        <span className="text-line-strong">/</span>
        <span className="font-mono font-medium text-ink">{incident.id}</span>
      </nav>

      <PageHero
        tint={resolved ? 'accent' : 'bad'}
        illustration={<FirefighterIllustration className="h-[84px] w-auto" />}
        eyebrow={
          <>
            <ProductMark product={incident.product} size="sm" />
            <span className="font-mono">{incident.id}</span> · {productById(incident.product).name}{' '}
            · <span className="font-mono">{incident.service}</span>
          </>
        }
        title={incident.title}
        badges={
          <>
            <StatusBadge tone={severityTone[incident.severity]} label={incident.severity} />
            <StatusBadge
              tone={incidentStatusTone[incident.status]}
              label={capitalize(incident.status)}
              dot
            />
          </>
        }
        description={incident.impact}
        actions={
          isOps && !resolved ? (
            <>
              {incident.status === 'investigating' && (
                <Button
                  size="sm"
                  icon={<EyeIcon className="h-3.5 w-3.5" />}
                  onClick={() =>
                    setStatus(incident.id, 'monitoring', 'Mitigation applied — watching metrics')
                  }
                >
                  Mitigated · monitor
                </Button>
              )}
              <Button
                size="sm"
                variant="primary"
                icon={<CircleCheckIcon className="h-3.5 w-3.5" />}
                onClick={() =>
                  void setStatus(
                    incident.id,
                    'resolved',
                    `Resolved by ${firstName(currentUserId)}`,
                  ).then((ok) => ok && toast.success(`${incident.id} resolved`))
                }
              >
                Resolve
              </Button>
            </>
          ) : undefined
        }
        stats={[
          { label: 'Owner', value: firstName(incident.owner), to: `/team/${incident.owner}` },
          { label: 'Started', value: incident.started },
          { label: 'Duration', value: incident.duration, tone: resolved ? undefined : 'bad' },
          {
            label: 'Monitor uptime',
            value: monitor?.uptimePct !== undefined ? `${monitor.uptimePct.toFixed(2)}%` : '—',
          },
          { label: 'Events', value: incident.events.length },
        ]}
      />

      {!!writeError && <InlineError error={writeError} />}
      {!resolved &&
        ((isOps && incident.severity === 'SEV1') ||
          (mayRollback && deploy?.env === 'production')) && (
          <ProductionAccessStatus
            scope={`production:${incident.product}`}
            what="Changing severity, resolving a SEV1 or rolling back production"
          />
        )}

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="Connected records"
          meta={<span className="hidden sm:inline">Product · service · deploy · code · owner</span>}
        >
          <div className="p-2.5">
            <Suspense fallback={<LoadingRows rows={3} label="Loading graph" />}>
              <RelationshipGraph
                incident={incident}
                related={related.map((d) => ({
                  kind: 'Deployment',
                  label: `${d.sha} · ${d.env}`,
                }))}
              />
            </Suspense>
          </div>
          {deploy && (
            <div className="mx-3 mb-3 flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">
              <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Deploy{' '}
                <Link
                  to={`/deployments/${deploy.id}`}
                  className="font-mono font-semibold underline"
                >
                  {deploy.sha}
                </Link>{' '}
                reached {deploy.env} within 24h before this incident started. Correlation only, no
                evidence yet that it caused this.
              </span>
            </div>
          )}
        </Panel>

        <Panel title="Key details">
          <dl className="divide-y divide-line text-[12.5px]">
            {[
              {
                k: 'Owner',
                v: (
                  <Link
                    to={`/team/${incident.owner}`}
                    className="flex items-center gap-1.5 font-medium text-ink hover:underline"
                  >
                    <Avatar id={incident.owner} size="xs" />
                    {memberById(incident.owner).name}
                  </Link>
                ),
              },
              {
                k: 'Product',
                v: (
                  <Link
                    to={`/products/${incident.product}`}
                    className="flex items-center gap-1.5 font-medium text-ink hover:underline"
                  >
                    <ProductMark product={incident.product} size="sm" />
                    {productById(incident.product).name}
                  </Link>
                ),
              },
              { k: 'Service', v: <span className="font-mono text-ink">{incident.service}</span> },
              {
                k: 'Deploy',
                v: deploy ? (
                  <Link
                    to={`/deployments/${deploy.id}`}
                    className="font-mono text-accent hover:underline"
                  >
                    {deploy.sha} · {deploy.env}
                  </Link>
                ) : (
                  <span className="text-muted">None in the 24h before</span>
                ),
              },
              {
                k: 'Monitor',
                v: monitor ? (
                  <Link to="/monitors" className="text-ink hover:underline">
                    {monitor.name}
                    {monitor.lastLatencyMs !== undefined ? ` · ${monitor.lastLatencyMs}ms` : ''}
                  </Link>
                ) : (
                  <span className="text-muted">
                    {monitors.status === 'ready' ? 'None for this service' : 'Unavailable'}
                  </span>
                ),
              },
              {
                k: 'On call',
                v: <span className="text-muted">Schedule not connected</span>,
              },
            ].map((r) => (
              <div
                key={r.k}
                className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 px-3.5 py-2"
              >
                <dt className="text-muted">{r.k}</dt>
                <dd className="min-w-0 truncate">{r.v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="Timeline"
          meta={<span className="tabular-nums">{incident.events.length} events</span>}
        >
          <ol className="divide-y divide-line">
            {[...incident.events].reverse().map((e, idx) => {
              const Icon = eventIcon[e.kind];
              return (
                <li
                  key={`${e.time}-${e.title}-${idx}`}
                  className="grid grid-cols-[44px_24px_minmax(0,1fr)] items-start gap-2.5 px-3.5 py-2"
                >
                  <time className="pt-0.5 font-mono text-[11.5px] tabular-nums text-muted">
                    {e.time}
                  </time>
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full ${e.kind === 'alert' ? 'bg-bad-soft text-bad' : e.kind === 'link' ? 'bg-warn-soft text-warn' : e.kind === 'note' ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink'}`}
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-ink">{e.title}</p>
                    <p className="text-[12px] text-muted">{e.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          {!resolved && (
            <form
              onSubmit={postNote}
              className="flex items-center gap-2 border-t border-line p-2.5"
            >
              <Avatar id={currentUserId} size="sm" />
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note to the timeline…"
                aria-label="Timeline note"
                className="h-8 min-w-0 flex-1 rounded-md border border-line px-2.5 text-[12.5px] outline-none focus:border-accent"
              />
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={!note.trim()}
                icon={<SendIcon className="h-3.5 w-3.5" />}
              >
                Add
              </Button>
            </form>
          )}
        </Panel>

        <Panel title="Recovery">
          <p className="px-3.5 py-2.5 text-[12px] text-muted">
            Next steps aren’t recorded by the API yet. Use timeline notes to track actions.
          </p>
          {deploy && !resolved && deploy.status !== 'rolled-back' && (
            <div className="border-t border-line px-3.5 py-2.5">
              <GuardedButton
                variant="danger"
                className="w-full"
                allowed={mayRollback}
                reason="Needs Deployment: manage"
                icon={<RotateCcwIcon className="h-3.5 w-3.5" />}
                onClick={() =>
                  requestReauth({
                    title: `Roll back ${deploy.sha}`,
                    description: `Marks ${deploy.version} on ${productById(incident.product).name} ${deploy.env} as rolled back.`,
                    actionLabel: 'Verify & roll back',
                    onConfirm: () =>
                      void rollback(deploy.id).then((ok) => {
                        if (ok)
                          addEvent(incident.id, {
                            title: 'Rollback',
                            detail: `${deploy.sha} (${deploy.env}) rolled back`,
                            kind: 'action',
                          });
                      }),
                  })
                }
              >
                Roll back {deploy.sha}
              </GuardedButton>
              {actionError?.id === deploy.id && <InlineError error={actionError.error} />}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
