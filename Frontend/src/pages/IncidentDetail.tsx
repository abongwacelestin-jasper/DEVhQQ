import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowUpCircleIcon,
  BellRingIcon,
  CircleCheckIcon,
  EyeIcon,
  Link2Icon,
  MegaphoneIcon,
  MessageSquareIcon,
  SendIcon,
  ShieldCheckIcon,
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
import { RelationshipGraph } from '../components/operations/RelationshipGraph';
import { capitalize, incidentStatusTone, severityTone } from '../components/operations/IncidentRow';
import { FirefighterIllustration } from '../components/illustrations/FirefighterIllustration';
import { useIncidents } from '../contexts/IncidentContext';
import { useReauth } from '../contexts/ReauthContext';
import { useAuth } from '../contexts/AuthContext';
import { deployments, incidentRelations, monitors } from '../data/operations';
import { onCall } from '../data/incidentHistory';
import { currentUserId } from '../data/team';
import { firstName, memberById, productById } from '../utils/status';
import type { IncidentEvent } from '../types/operations';

const eventIcon: Record<IncidentEvent['kind'], React.ComponentType<{ className?: string }>> = {
  alert: BellRingIcon,
  system: SirenIcon,
  link: Link2Icon,
  note: MessageSquareIcon,
  action: UndoIcon,
};

export function IncidentDetail() {
  const { incidentId } = useParams();
  const { incidents, setStatus, addEvent } = useIncidents();
  const { requestReauth } = useReauth();
  const { canDo, canSeeProduct } = useAuth();
  const [note, setNote] = useState('');
  const incident = incidents.find((i) => i.id === incidentId);
  if (!incident || !canSeeProduct(incident.product))
    return <NotFound what="Incident" backTo="/incidents" backLabel="Back to incidents" />;

  const resolved = incident.status === 'resolved';
  const deploy = deployments.find((d) => d.sha === incident.correlatedDeploy);
  const monitor = monitors.find(
    (m) =>
      m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === incident.service ||
      m.product === incident.product,
  );
  const isOps = canDo('incident:declare');

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
              <Button
                size="sm"
                icon={<MegaphoneIcon className="h-3.5 w-3.5" />}
                onClick={() => {
                  addEvent(incident.id, {
                    title: 'Status update posted',
                    detail: 'Shared to #incidents and the status page',
                    kind: 'action',
                  });
                  toast.success('Status update posted');
                }}
              >
                Post update
              </Button>
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
                icon={<ArrowUpCircleIcon className="h-3.5 w-3.5" />}
                onClick={() => {
                  addEvent(incident.id, {
                    title: 'Escalated',
                    detail: `Paged ${memberById(onCall[1].member).name} (secondary)`,
                    kind: 'action',
                  });
                  toast('Secondary on-call paged');
                }}
              >
                Escalate
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<CircleCheckIcon className="h-3.5 w-3.5" />}
                onClick={() => {
                  setStatus(incident.id, 'resolved', 'Resolved · postmortem doc created');
                  toast.success(`${incident.id} resolved`);
                }}
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
          { label: 'Uptime 30d', value: monitor ? `${monitor.uptime}%` : '—' },
          { label: 'Events', value: incident.events.length },
        ]}
      />

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="Connected records"
          meta={<span className="hidden sm:inline">Product · service · deploy · code · owner</span>}
        >
          <div className="p-2.5">
            <RelationshipGraph incident={incident} related={incidentRelations[incident.id] ?? []} />
          </div>
          {incident.correlatedDeploy && (
            <div className="mx-3 mb-3 flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">
              <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Deploy{' '}
                <Link
                  to={deploy ? `/deployments/${deploy.id}` : '/deployments'}
                  className="font-mono font-semibold underline"
                >
                  {incident.correlatedDeploy}
                </Link>{' '}
                reached production before the alert. Correlation only — no evidence yet that it
                caused this.
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
                  <span className="text-muted">None linked</span>
                ),
              },
              {
                k: 'Monitor',
                v: monitor ? (
                  <span className="text-ink">
                    {monitor.name} · {monitor.responseMs}ms
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                ),
              },
              {
                k: 'On call',
                v: <span className="text-ink">{memberById(onCall[0].member).name}</span>,
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

        <Panel title="Next steps">
          {incident.nextSteps.length === 0 || resolved ? (
            <p className="px-3.5 py-3 text-[12.5px] text-muted">
              Resolved. Postmortem linked in project documents.
            </p>
          ) : (
            <ol className="divide-y divide-line">
              {incident.nextSteps.map((s, i) => (
                <li key={s} className="flex items-start gap-2 px-3.5 py-2 text-[12.5px] text-ink">
                  <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sunken font-mono text-[10px] text-ink">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          )}
          {incident.correlatedDeploy && !resolved && canDo('deploy:approve') && (
            <div className="border-t border-line px-3.5 py-2.5">
              <Button
                variant="danger"
                className="w-full"
                icon={<ShieldCheckIcon className="h-3.5 w-3.5" />}
                onClick={() =>
                  requestReauth({
                    title: 'Approve production rollback',
                    description: `Redeploys the previous release of ${productById(incident.product).name} to production.`,
                    actionLabel: 'Verify & approve',
                    successMessage: 'Rollback approved',
                    onConfirm: () =>
                      setStatus(
                        incident.id,
                        'monitoring',
                        'Rollback approved with MFA — watching metrics',
                      ),
                  })
                }
              >
                Approve rollback
              </Button>
              <p className="mt-1 text-center text-[11px] text-muted">
                Requires deploy approval rights + MFA
              </p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
