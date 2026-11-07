import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { MailIcon, ShieldOffIcon, UserCheckIcon, UserXIcon } from 'lucide-react';
import { DetailHeader } from '../components/ui/DetailHeader';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ProductMark } from '../components/ui/ProductMark';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { NotFound } from '../components/ui/NotFound';
import { TaskList } from '../components/work/TaskList';
import { useReauth } from '../contexts/ReauthContext';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import type { ApiAuditEntry, ApiGrant, ApiProduct, ApiRole } from '../api/types';
import { areaFor } from '../utils/audit';
import { roles } from '../data/team';
import type { AuditEvent, RoleName } from '../types/team';
import { useTeamData } from '../hooks/useTeamData';
import { errorMessage } from '../components/work/apiState';
import { products } from '../data/portfolio';
import { useWork } from '../contexts/WorkContext';
import { describeEvent } from '../utils/taskEvents';
import { formatDateTime } from '../utils/date';
import type { ProductId } from '../types/portfolio';

const expiresIn = (g: ApiGrant) => {
  if (!g.expiresAt) return 'no expiry recorded';
  const mins = Math.max(0, Math.round((g.expiresAt - Date.now()) / 60_000));
  return mins >= 60 ? `expires in ${Math.round(mins / 60)}h` : `expires in ${mins}m`;
};

/**
 * One member, as the server knows them. Role, product access and status
 * changes are `PATCH /api/team/:id` behind step-up; production access is
 * just-in-time grants from `/api/access/grants`, revocable here.
 */
export function MemberDetail() {
  const { memberId } = useParams();
  const { requestReauth } = useReauth();
  const { members, matrix, activeGrants, loading, error, reload, updateMember } = useTeamData();
  const member = members.find((m) => m.id === memberId);
  const { tasks, events: taskEvents } = useWork();
  const { session } = useAuth();
  const me = session?.memberId ?? '';
  const myRole = members.find((m) => m.id === me)?.role;
  // The live matrix decides who administers the organization; the server enforces it again.
  const canAdminister = !!myRole && matrix?.Organization[myRole as ApiRole] === 'admin';
  const [busy, setBusy] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  // This member's trail, straight from the server's hash-chained log.
  useEffect(() => {
    if (!session?.memberId || !memberId) {
      setAuditEvents([]);
      return;
    }
    let alive = true;
    api<ApiAuditEntry[]>(`/api/audit?limit=200&actor=${encodeURIComponent(memberId)}`)
      .then((rows) => {
        if (!alive) return;
        setAuditEvents(
          rows.map((e) => ({
            id: `s${e.seq}`,
            when: formatDateTime(new Date(e.at)),
            actor: e.actor,
            action: e.action,
            target: e.target,
            area: areaFor(e.action),
            sensitive: e.sensitive,
          })),
        );
      })
      .catch(() => {
        /* the panel simply shows no entries rather than inventing them */
      });
    return () => {
      alive = false;
    };
  }, [session?.memberId, memberId]);
  const recentTaskEvents = taskEvents
    .filter((e) => e.actor === memberId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  if (!member) {
    if (loading) return <p className="px-1 py-6 text-[12.5px] text-muted">Loading member…</p>;
    if (error)
      return (
        <div className="rounded-lg border border-line px-4 py-6 text-center text-[12.5px] text-muted">
          {error}{' '}
          <button onClick={() => void reload()} className="font-medium text-accent hover:underline">
            Try again
          </button>
        </div>
      );
    return <NotFound what="Member" backTo="/team" backLabel="Back to team" />;
  }

  const isOwner = member.role === 'Owner';
  const isMe = member.id === me;
  const active = member.status !== 'deactivated';
  const access = member.products;
  const assigned = tasks.filter((t) => t.assignee === member.id);
  const events = auditEvents.filter((e) => e.actor === member.id);
  const grants = activeGrants.filter((g) => g.memberId === member.id);
  const level = (area: 'Product' | 'Deployment') =>
    matrix ? matrix[area][member.role as ApiRole] : '…';

  /** Every change is a server write behind step-up; the page shows what the server returns. */
  const change = (
    title: string,
    description: string,
    patch: { role?: RoleName; products?: ApiProduct[]; status?: 'active' | 'deactivated' },
    success: string,
  ) =>
    requestReauth({
      title,
      description,
      actionLabel: 'Verify & save',
      onConfirm: () => {
        setBusy(true);
        updateMember(member.id, patch)
          .then(() =>
            toast.success(success, { description: 'Their sessions were revoked by the server.' }),
          )
          .catch((e: unknown) =>
            toast.error(`${title} failed`, {
              description: errorMessage(e, 'The team API did not respond.'),
            }),
          )
          .finally(() => setBusy(false));
      },
    });

  const toggleProduct = (id: ProductId) => {
    const removing = access.includes(id);
    const next = (removing ? access.filter((x) => x !== id) : [...access, id]) as ApiProduct[];
    change(
      removing ? 'Remove product access' : 'Grant product access',
      `${member.name} will ${removing ? 'lose' : 'gain'} access to ${products.find((p) => p.id === id)?.name}.`,
      { products: next },
      'Access updated',
    );
  };

  const revokeGrant = (g: ApiGrant) =>
    requestReauth({
      title: 'Revoke production access',
      description: `${member.name} loses ${g.scope} access immediately.`,
      actionLabel: 'Verify & revoke',
      onConfirm: () => {
        api(`/api/access/grants/${encodeURIComponent(g.id)}/revoke`, { method: 'POST' })
          .then(() => {
            toast.success('Access revoked');
            return reload();
          })
          .catch((e: unknown) =>
            toast.error('Revocation failed', { description: errorMessage(e) }),
          );
      },
    });

  return (
    <div className="space-y-4">
      <DetailHeader
        crumbs={[{ label: 'Team & roles', to: '/team' }, { label: member.name }]}
        leading={<Avatar id={member.id} size="lg" />}
        title={member.name}
        eyebrow={
          <span className="flex items-center gap-1">
            <MailIcon className="h-3 w-3" />
            {member.email}
          </span>
        }
        badges={
          <>
            <StatusBadge tone="neutral" label={member.role} />
            {member.mfa ? (
              <StatusBadge tone="ok" label="MFA on" dot />
            ) : (
              <StatusBadge tone="bad" label="MFA off" dot />
            )}
            {grants.length > 0 && <StatusBadge tone="warn" label="Production access" />}
            {!active && <StatusBadge tone="bad" label="Deactivated" />}
            {member.status === 'invited' && <StatusBadge tone="info" label="Invite pending" />}
          </>
        }
        actions={
          canAdminister && !isOwner && !isMe ? (
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              Role
              <select
                value={member.role}
                disabled={busy}
                onChange={(e) => {
                  const role = e.target.value as RoleName;
                  change(
                    'Change role',
                    `${member.name} becomes ${role}. Their sessions end so the new permissions apply at once.`,
                    { role },
                    `${member.name} is now ${role}`,
                  );
                }}
                className="h-8 rounded-md border border-line bg-white px-2 text-[12.5px] font-medium text-ink"
              >
                {roles
                  .filter((r) => r.name !== 'Owner')
                  .map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <Panel title="Product access" meta={<span>Role: {member.role}</span>}>
            <ul className="divide-y divide-line">
              {products.map((p) => {
                const has = access.includes(p.id);
                return (
                  <li key={p.id} className="flex items-center gap-2.5 px-3.5 py-2">
                    <ProductMark product={p.id} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-ink">{p.name}</p>
                      <p className="text-[11.5px] text-muted">
                        {has
                          ? `Product: ${level('Product')} · Deployments: ${level('Deployment')}`
                          : 'No access'}
                      </p>
                    </div>
                    {isOwner ? (
                      <span className="text-[11.5px] text-subtle">Always</span>
                    ) : !canAdminister ? (
                      <span className="text-[11.5px] text-subtle">{has ? 'Granted' : '—'}</span>
                    ) : (
                      <button
                        role="switch"
                        aria-checked={has}
                        aria-label={`Access to ${p.name}`}
                        disabled={busy}
                        onClick={() => toggleProduct(p.id)}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ${has ? 'bg-accent' : 'bg-line-strong'}`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${has ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
                        />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>

          <div>
            <h2 className="mb-2 text-[12.5px] font-semibold text-ink">
              Assigned tasks · {assigned.length}
            </h2>
            {assigned.length ? (
              <TaskList tasks={assigned} />
            ) : (
              <p className="rounded-lg border border-line px-3.5 py-4 text-[12.5px] text-muted">
                No tasks assigned.
              </p>
            )}
          </div>

          <Panel
            title="Task activity"
            meta={
              <Link
                to={`/activity?member=${member.id}`}
                className="font-medium text-accent hover:underline"
              >
                All activity
              </Link>
            }
          >
            <ul className="divide-y divide-line">
              {recentTaskEvents.map((e) => (
                <li
                  key={e.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3.5 py-1.5 text-[12.5px]"
                >
                  <p className="min-w-0 truncate text-ink">
                    <Link
                      to={`/tasks/${e.taskKey}`}
                      className="font-mono font-semibold text-accent hover:underline"
                    >
                      {e.taskKey}
                    </Link>{' '}
                    <span className="text-muted">{describeEvent(e)}</span>
                  </p>
                  <time className="text-[11.5px] tabular-nums text-muted">
                    {formatDateTime(new Date(e.at))}
                  </time>
                </li>
              ))}
              {recentTaskEvents.length === 0 && (
                <li className="px-3.5 py-3 text-[12.5px] text-muted">No task activity recorded.</li>
              )}
            </ul>
          </Panel>

          <Panel
            title="Security & admin actions"
            meta={
              <Link to="/audit" className="font-medium text-accent hover:underline">
                Audit log
              </Link>
            }
          >
            <ul className="divide-y divide-line">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3.5 py-2 text-[12.5px]"
                >
                  <span className="w-28 shrink-0 font-mono text-[11px] text-subtle">{e.when}</span>
                  <span className="min-w-0 flex-1 text-ink">
                    {e.action} <span className="font-medium">{e.target}</span>
                  </span>
                  {e.sensitive && <StatusBadge tone="warn" label="Sensitive" />}
                </li>
              ))}
              {events.length === 0 && (
                <li className="px-3.5 py-3 text-[12.5px] text-muted">No recorded actions.</li>
              )}
            </ul>
          </Panel>
        </div>

        <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
          <Panel title="Production access" meta={<span>Just-in-time</span>}>
            <div className="space-y-2.5 px-3.5 py-3">
              {grants.length ? (
                <ul className="space-y-2">
                  {grants.map((g) => (
                    <li key={g.id} className="space-y-1">
                      <p className="text-[12.5px] text-ink">{g.scope}</p>
                      <p className="text-[11.5px] text-muted">
                        {g.reason} · {expiresIn(g)}
                      </p>
                      {canAdminister && !isOwner && (
                        <Button
                          variant="danger"
                          size="sm"
                          className="w-full"
                          icon={<ShieldOffIcon className="h-3.5 w-3.5" />}
                          onClick={() => revokeGrant(g)}
                        >
                          Revoke now
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-muted">
                  No active production access. Members request time-boxed access themselves; it
                  expires automatically and approvals appear in Access review.
                </p>
              )}
              {!member.mfa && (
                <p className="text-[11.5px] text-bad">
                  MFA must be enabled before production access can be approved.
                </p>
              )}
            </div>
          </Panel>

          {canAdminister && !isOwner && !isMe && (
            <Panel title="Danger zone">
              <div className="space-y-2 px-3.5 py-3">
                <p className="text-[12px] text-muted">
                  {active
                    ? `Deactivating signs ${member.name.split(' ')[0]} out everywhere and keeps their history.`
                    : `${member.name.split(' ')[0]} is deactivated. Reactivating restores sign-in with their current role.`}
                </p>
                <Button
                  variant={active ? 'danger' : 'secondary'}
                  size="sm"
                  className="w-full"
                  disabled={busy}
                  icon={
                    active ? (
                      <UserXIcon className="h-3.5 w-3.5" />
                    ) : (
                      <UserCheckIcon className="h-3.5 w-3.5" />
                    )
                  }
                  onClick={() =>
                    active
                      ? change(
                          `Deactivate ${member.name}`,
                          'Signs them out of all sessions. Their history stays in the audit log.',
                          { status: 'deactivated' },
                          'Member deactivated',
                        )
                      : change(
                          `Reactivate ${member.name}`,
                          'They can sign in again with their current role and products.',
                          { status: 'active' },
                          'Member reactivated',
                        )
                  }
                >
                  {active ? 'Deactivate member' : 'Reactivate member'}
                </Button>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
