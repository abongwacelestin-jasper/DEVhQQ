import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  LockIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { SecurityIllustration } from '../components/illustrations/SecurityIllustration';
import { ApiTokens } from '../components/security/ApiTokens';
import { SecurityFramework } from '../components/security/SecurityFramework';
import { SessionsPanel } from '../components/security/SessionsPanel';
import { TotpEnrollment } from '../components/security/TotpEnrollment';
import { BackupCodes } from '../components/security/BackupCodes';
import { useReauth } from '../contexts/ReauthContext';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import {
  APPROVER_ROLES,
  decideGrant,
  durationLabel,
  grantsChanged,
  isLive,
  myGrants,
  onGrantsChanged,
  timeLeft,
} from '../components/jit/jit';
import { listSignIns } from '../api/auth/endpoints';
import type { ApiGrant, ApiSignIn } from '../api/types';
import { securityChecks, securityPolicies } from '../data/security';
import { memberById } from '../utils/status';

const resultMeta: Record<ApiSignIn['result'], { label: string; tone: 'ok' | 'bad' | 'warn' }> = {
  success: { label: 'Success', tone: 'ok' },
  blocked: { label: 'Blocked by risk policy', tone: 'bad' },
  failed: { label: 'Failed', tone: 'warn' },
  challenged: { label: 'Second factor pending', tone: 'warn' },
};

function when(iso: string | number) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function SecurityCenter() {
  const { requestReauth } = useReauth();
  const { member } = useAuth();
  const [policies, setPolicies] = useState(securityPolicies);
  const [grants, setGrants] = useState<ApiGrant[]>([]);
  /** `all` for Administration viewers (approvers); otherwise only the member's own grants. */
  const [grantView, setGrantView] = useState<'all' | 'mine'>('all');
  const [now, setNow] = useState(() => Date.now());
  const [signIns, setSignIns] = useState<ApiSignIn[] | null>(null);
  const isApprover = !!member && APPROVER_ROLES.includes(member.role);

  const loadGrants = useCallback(async () => {
    const open = (l: ApiGrant[]) => l.filter((g) => isLive(g) || g.status === 'pending');
    try {
      setGrants(open(await api<ApiGrant[]>('/api/access/grants')));
      setGrantView('all');
    } catch {
      // No Administration:view — show the member's own requests instead.
      try {
        setGrants(open(await myGrants()));
      } catch {
        setGrants([]);
      }
      setGrantView('mine');
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void loadGrants();
    const off = onGrantsChanged(() => void loadGrants());
    const poll = setInterval(() => void loadGrants(), 30_000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    listSignIns(50)
      .then(setSignIns)
      .catch(() => setSignIns([]));
    return () => {
      off();
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [loadGrants]);

  const decide = (g: ApiGrant, decision: 'approve' | 'revoke') => {
    const who = memberById(g.memberId).name;
    requestReauth({
      title:
        decision === 'approve'
          ? 'Approve production access'
          : g.status === 'pending'
            ? 'Deny production access'
            : 'Revoke production access',
      description:
        decision === 'approve'
          ? `${who} gets ${g.scope} for ${durationLabel(g.durationMs)}. Your approval is recorded in the audit log.`
          : `${who} loses ${g.scope} immediately.`,
      actionLabel:
        decision === 'approve'
          ? 'Verify & approve'
          : g.status === 'pending'
            ? 'Verify & deny'
            : 'Verify & revoke',
      successMessage:
        decision === 'approve'
          ? 'Access approved'
          : g.status === 'pending'
            ? 'Request denied'
            : 'Access revoked',
      onConfirm: async () => {
        await decideGrant(g.id, decision);
        grantsChanged();
        await loadGrants();
      },
    });
  };
  const pass = securityChecks.filter((c) => c.status === 'pass').length;
  const score = Math.round(
    ((pass + securityChecks.filter((c) => c.status === 'warn').length * 0.5) /
      securityChecks.length) *
      100,
  );

  // Policies are not yet stored by the server: toggles stay in this view and say so.
  const togglePolicy = (id: string) => {
    const p = policies.find((x) => x.id === id);
    if (!p || p.locked) return;
    requestReauth({
      title: `${p.enabled ? 'Disable' : 'Enable'} policy`,
      description: `“${p.label}” applies to the whole organization.`,
      actionLabel: 'Verify & save',
      successMessage: 'Policy updated',
      onConfirm: () =>
        setPolicies((l) => l.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x))),
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Security"
        description="Policies, production access, tokens and sign-ins in one place. Every change here needs MFA re-verification and is audited."
      />

      <section className="grid overflow-hidden rounded-lg border border-line md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex items-center gap-4 border-b border-line bg-accent-soft/40 p-4 md:border-b-0 md:border-r">
          <SecurityIllustration className="h-24 w-auto shrink-0 sm:h-28" />
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-muted">Security posture</p>
            <p className="text-[28px] font-semibold leading-none tabular-nums text-ink">
              {score}
              <span className="text-[14px] text-subtle">/100</span>
            </p>
            <p className="mt-1.5 text-[12px] text-muted">
              {pass} of {securityChecks.length} checks passing. Fix the items on the right to reach
              100.
            </p>
          </div>
        </div>
        <ul className="divide-y divide-line">
          {securityChecks.map((c) => {
            const Icon =
              c.status === 'pass'
                ? CircleCheckIcon
                : c.status === 'warn'
                  ? TriangleAlertIcon
                  : CircleXIcon;
            const row = (
              <>
                <Icon
                  className={`h-4 w-4 shrink-0 ${c.status === 'pass' ? 'text-ok' : c.status === 'warn' ? 'text-warn' : 'text-bad'}`}
                />
                <span className="w-32 shrink-0 text-[12.5px] font-medium text-ink">{c.label}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{c.detail}</span>
                {c.to && <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-subtle" />}
              </>
            );

            return (
              <li key={c.id}>
                {c.to ? (
                  <Link
                    to={c.to}
                    className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-sunken/50"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-center gap-2.5 px-3.5 py-2">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <SecurityFramework />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Organization policies"
          meta={<span>Preview · not yet enforced by the server</span>}
        >
          <ul className="divide-y divide-line">
            {policies.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
                    {p.label}
                    {p.locked && (
                      <LockIcon className="h-3 w-3 text-subtle" aria-label="Locked by DevHQ" />
                    )}
                  </p>
                  <p className="text-[11.5px] text-muted">{p.description}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={p.enabled}
                  aria-label={p.label}
                  disabled={p.locked}
                  onClick={() => togglePolicy(p.id)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${p.enabled ? 'bg-accent' : 'bg-line-strong'}`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${p.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
                  />
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Production access"
            meta={
              <span>
                {grantView === 'mine' ? 'Your grants · ' : ''}
                {grants.filter((g) => g.status === 'pending').length} pending ·{' '}
                {grants.filter((g) => g.status === 'active').length} active
              </span>
            }
          >
            {grants.length === 0 && (
              <p className="px-3.5 py-3 text-[12px] text-muted">
                No pending or active just-in-time grants.
              </p>
            )}
            <ul className="divide-y divide-line" aria-label="Just-in-time grants">
              {grants.map((g) => {
                const own = g.memberId === member?.id;
                const canApprove = grantView === 'all' && isApprover && !own;
                return (
                  <li key={g.id} className="flex flex-wrap items-center gap-2.5 px-3.5 py-2">
                    <Link to={`/team/${g.memberId}`}>
                      <Avatar id={g.memberId} size="sm" />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-ink">
                        {memberById(g.memberId).name}{' '}
                        <span className="font-normal text-muted">
                          · <span className="font-mono">{g.scope}</span> ·{' '}
                          {durationLabel(g.durationMs)}
                        </span>
                      </p>
                      <p className="truncate text-[11.5px] text-muted">
                        {g.reason}
                        {g.approvedBy
                          ? ` · approved by ${memberById(g.approvedBy).name.split(' ')[0]}`
                          : own
                            ? ' · needs another approver (two-person rule)'
                            : ' · awaiting approval'}
                      </p>
                    </div>
                    <StatusBadge
                      tone={g.status === 'pending' ? 'neutral' : 'warn'}
                      label={
                        g.status === 'pending'
                          ? 'Pending'
                          : g.expiresAt
                            ? `${timeLeft(g.expiresAt, now)} · until ${when(g.expiresAt)}`
                            : 'Active'
                      }
                    />
                    {grantView === 'all' && (
                      <span className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-bad hover:text-bad"
                          onClick={() => decide(g, 'revoke')}
                        >
                          {g.status === 'pending' ? 'Deny' : 'Revoke'}
                        </Button>
                        {g.status === 'pending' && canApprove && (
                          <Button size="sm" variant="primary" onClick={() => decide(g, 'approve')}>
                            Approve
                          </Button>
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-line px-3.5 py-2 text-[11.5px] text-muted">
              Members request time-boxed production access when an action needs it. Owners and
              Operations approve someone else’s request; grants end on their own.
            </p>
          </Panel>
          <ApiTokens />
          <TotpEnrollment />
          <BackupCodes />
        </div>
      </div>

      <SessionsPanel />

      <Panel title="Sign-in activity" meta={<span>From the server sign-in log</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] text-muted">
                <th className="px-3.5 py-2 font-medium">Member</th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Method</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3.5 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {signIns === null && (
                <tr>
                  <td colSpan={5} className="px-3.5 py-3 text-muted">
                    Loading sign-ins…
                  </td>
                </tr>
              )}
              {signIns?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3.5 py-3 text-muted">
                    No sign-ins recorded yet.
                  </td>
                </tr>
              )}
              {signIns?.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-3.5 py-2">
                    {s.memberId === 'unknown' ? (
                      <span className="text-muted">Unknown account</span>
                    ) : (
                      <Link
                        to={`/team/${s.memberId}`}
                        className="flex items-center gap-2 font-medium text-ink hover:underline"
                      >
                        <Avatar id={s.memberId} size="xs" />
                        {memberById(s.memberId).name}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px] text-muted">{when(s.at)}</td>
                  <td className="px-3 py-2 text-ink">{s.method}</td>
                  <td className="px-3 py-2 text-muted">
                    {[s.location?.city, s.location?.country].filter(Boolean).join(', ') || s.ip}
                  </td>
                  <td className="px-3.5 py-2">
                    <StatusBadge {...resultMeta[s.result]} dot />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
