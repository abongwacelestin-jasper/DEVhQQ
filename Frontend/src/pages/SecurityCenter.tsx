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
import { api } from '../api/client';
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
  const [policies, setPolicies] = useState(securityPolicies);
  const [grants, setGrants] = useState<ApiGrant[]>([]);
  const [signIns, setSignIns] = useState<ApiSignIn[] | null>(null);

  const loadGrants = useCallback(async () => {
    try {
      const list = await api<ApiGrant[]>('/api/access/grants');
      setGrants(list.filter((g) => g.status === 'active' || g.status === 'pending'));
    } catch {
      setGrants([]);
    }
  }, []);

  useEffect(() => {
    void loadGrants();
    listSignIns(50)
      .then(setSignIns)
      .catch(() => setSignIns([]));
  }, [loadGrants]);
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
          <Panel title="Production access" meta={<span>{grants.length} open grants</span>}>
            {grants.length === 0 && (
              <p className="px-3.5 py-3 text-[12px] text-muted">No active just-in-time grants.</p>
            )}
            <ul className="divide-y divide-line">
              {grants.map((g) => (
                <li key={g.id} className="flex items-center gap-2.5 px-3.5 py-2">
                  <Link to={`/team/${g.memberId}`}>
                    <Avatar id={g.memberId} size="sm" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-ink">
                      {memberById(g.memberId).name}{' '}
                      <span className="font-normal text-muted">· {g.scope}</span>
                    </p>
                    <p className="truncate text-[11.5px] text-muted">
                      {g.reason}
                      {g.approvedBy
                        ? ` · approved by ${memberById(g.approvedBy).name.split(' ')[0]}`
                        : ' · awaiting approval'}
                    </p>
                  </div>
                  <StatusBadge
                    tone={g.status === 'pending' ? 'neutral' : 'warn'}
                    label={
                      g.status === 'pending'
                        ? 'Pending'
                        : g.expiresAt
                          ? `Until ${when(g.expiresAt)}`
                          : 'Active'
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-bad hover:text-bad"
                    onClick={() =>
                      requestReauth({
                        title: 'Revoke production access',
                        description: `${memberById(g.memberId).name} loses this access immediately.`,
                        actionLabel: 'Verify & revoke',
                        successMessage: 'Access revoked',
                        onConfirm: async () => {
                          await api(`/api/access/grants/${encodeURIComponent(g.id)}/revoke`, {
                            method: 'POST',
                          });
                          await loadGrants();
                        },
                      })
                    }
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-3.5 py-2 text-[11.5px] text-muted">
              Grant new time-boxed access from a member’s profile.
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
