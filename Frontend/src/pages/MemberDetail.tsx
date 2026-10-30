import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { LaptopIcon, MailIcon, ShieldCheckIcon, ShieldOffIcon, UserXIcon } from 'lucide-react';
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
import type { ApiAuditEntry } from '../api/types';
import { areaFor } from '../utils/audit';
import { currentUserId, members, permissionMatrix } from '../data/team';
import type { AuditEvent } from '../types/team';
import { products } from '../data/portfolio';
import { useWork } from '../contexts/WorkContext';
import { describeEvent } from '../utils/taskEvents';
import { formatDateTime } from '../utils/date';
import { accessGrants, sessions } from '../data/security';
import type { ProductId } from '../types/portfolio';

const jitOptions = ['1 hour', '4 hours', 'Until end of day', '24 hours'];

export function MemberDetail() {
  const { memberId } = useParams();
  const { requestReauth } = useReauth();
  const member = members.find((m) => m.id === memberId);
  const [access, setAccess] = useState<ProductId[]>(member?.products ?? []);
  const [prod, setProd] = useState(member?.productionAccess ?? false);
  const [jit, setJit] = useState(jitOptions[0]);
  const [active, setActive] = useState(member?.status !== 'deactivated');
  const [memberSessions, setMemberSessions] = useState(
    sessions.filter((s) => s.member === memberId),
  );
  const { tasks, events: taskEvents } = useWork();
  const { session } = useAuth();
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

  if (!member) return <NotFound what="Member" backTo="/team" backLabel="Back to team" />;

  const isOwner = member.role === 'Owner';
  const isMe = member.id === currentUserId;
  const assigned = tasks.filter((t) => t.assignee === member.id);
  const events = auditEvents.filter((e) => e.actor === member.id);
  const grant = accessGrants.find((g) => g.member === member.id);

  const toggleProduct = (id: ProductId) => {
    const removing = access.includes(id);
    requestReauth({
      title: removing ? 'Remove product access' : 'Grant product access',
      description: `${member.name} will ${removing ? 'lose' : 'gain'} access to ${products.find((p) => p.id === id)?.name}.`,
      actionLabel: 'Verify & save',
      successMessage: 'Access updated',
      onConfirm: () => setAccess((a) => (removing ? a.filter((x) => x !== id) : [...a, id])),
    });
  };

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
            {prod && <StatusBadge tone="warn" label="Production access" />}
            {!active && <StatusBadge tone="bad" label="Deactivated" />}
            {member.status === 'invited' && <StatusBadge tone="info" label="Invite pending" />}
          </>
        }
        actions={
          !member.mfa && member.status === 'active' ? (
            <Button
              icon={<ShieldCheckIcon className="h-3.5 w-3.5" />}
              onClick={() =>
                toast.success('MFA reminder sent', {
                  description: `${member.name} has 7 days before sign-in is blocked.`,
                })
              }
            >
              Require MFA
            </Button>
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
                          ? `Product: ${permissionMatrix.Product[member.role]} · Deployments: ${permissionMatrix.Deployment[member.role]}`
                          : 'No access'}
                      </p>
                    </div>
                    {isOwner ? (
                      <span className="text-[11.5px] text-subtle">Always</span>
                    ) : (
                      <button
                        role="switch"
                        aria-checked={has}
                        aria-label={`Access to ${p.name}`}
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
          <Panel title="Production access">
            <div className="space-y-2.5 px-3.5 py-3">
              {prod ? (
                <>
                  <p className="text-[12.5px] text-ink">
                    {grant ? grant.scope : 'Production · granted'}
                  </p>
                  <p className="text-[11.5px] text-muted">
                    {grant ? `${grant.reason} · expires ${grant.expires}` : 'Standing access'}
                  </p>
                  {!isOwner && (
                    <Button
                      variant="danger"
                      size="sm"
                      className="w-full"
                      icon={<ShieldOffIcon className="h-3.5 w-3.5" />}
                      onClick={() =>
                        requestReauth({
                          title: 'Revoke production access',
                          description: `${member.name} loses production access immediately.`,
                          actionLabel: 'Verify & revoke',
                          successMessage: 'Access revoked',
                          onConfirm: () => setProd(false),
                        })
                      }
                    >
                      Revoke now
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-[12px] text-muted">
                    Grant time-boxed access. It expires automatically and every action is audited.
                  </p>
                  <label className="block">
                    <span className="text-[11.5px] font-medium text-ink">Duration</span>
                    <select
                      value={jit}
                      onChange={(e) => setJit(e.target.value)}
                      className="mt-1 h-8 w-full rounded-md border border-line bg-white px-2 text-[12.5px]"
                    >
                      {jitOptions.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    disabled={!member.mfa || member.status !== 'active'}
                    icon={<ShieldCheckIcon className="h-3.5 w-3.5" />}
                    onClick={() =>
                      requestReauth({
                        title: 'Grant production access',
                        description: `${member.name} gets production access for ${jit.toLowerCase()}.`,
                        actionLabel: 'Verify & grant',
                        successMessage: 'Time-boxed access granted',
                        onConfirm: () => setProd(true),
                      })
                    }
                  >
                    Grant for {jit.toLowerCase()}
                  </Button>
                  {!member.mfa && (
                    <p className="text-[11.5px] text-bad">
                      MFA must be enabled before production access can be granted.
                    </p>
                  )}
                </>
              )}
            </div>
          </Panel>

          <Panel title="Sessions" meta={<span>{memberSessions.length}</span>}>
            <ul className="divide-y divide-line">
              {memberSessions.map((s) => (
                <li key={s.id} className="flex items-center gap-2.5 px-3.5 py-2">
                  <LaptopIcon className="h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-ink">{s.device}</p>
                    <p className="truncate text-[11px] text-muted">
                      {s.location} · {s.ip} · {s.lastSeen}
                    </p>
                  </div>
                  {s.current ? (
                    <span className="text-[11px] font-medium text-ok">This device</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setMemberSessions((l) => l.filter((x) => x.id !== s.id));
                        toast.success('Session signed out');
                      }}
                    >
                      Sign out
                    </Button>
                  )}
                </li>
              ))}
              {memberSessions.length === 0 && (
                <li className="px-3.5 py-3 text-[12.5px] text-muted">No active sessions.</li>
              )}
            </ul>
          </Panel>

          {!isOwner && !isMe && (
            <Panel title="Danger zone">
              <div className="space-y-2 px-3.5 py-3">
                <p className="text-[12px] text-muted">
                  Deactivating signs {member.name.split(' ')[0]} out everywhere, revokes tokens and
                  keeps their history.
                </p>
                <Button
                  variant="danger"
                  size="sm"
                  className="w-full"
                  disabled={!active}
                  icon={<UserXIcon className="h-3.5 w-3.5" />}
                  onClick={() =>
                    requestReauth({
                      title: `Deactivate ${member.name}`,
                      description: 'Signs them out of all sessions and revokes their API tokens.',
                      actionLabel: 'Verify & deactivate',
                      successMessage: 'Member deactivated',
                      onConfirm: () => {
                        setActive(false);
                        setMemberSessions([]);
                        setProd(false);
                      },
                    })
                  }
                >
                  {active ? 'Deactivate member' : 'Deactivated'}
                </Button>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
