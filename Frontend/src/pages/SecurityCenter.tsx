import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
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
import { useReauth } from '../contexts/ReauthContext';
import { accessGrants, securityChecks, securityPolicies, signIns } from '../data/security';
import { memberById } from '../utils/status';
import type { AccessGrant } from '../types/security';

const resultMeta = {
  success: { label: 'Success', tone: 'ok' as const },
  blocked: { label: 'Blocked · new country', tone: 'bad' as const },
  'mfa-failed': { label: 'MFA failed', tone: 'warn' as const },
};

export function SecurityCenter() {
  const { requestReauth } = useReauth();
  const [policies, setPolicies] = useState(securityPolicies);
  const [grants, setGrants] = useState<AccessGrant[]>(accessGrants);
  const pass = securityChecks.filter((c) => c.status === 'pass').length;
  const score = Math.round(
    ((pass + securityChecks.filter((c) => c.status === 'warn').length * 0.5) /
      securityChecks.length) *
      100,
  );

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
        <Panel title="Organization policies">
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
          <Panel title="Production access" meta={<span>{grants.length} active grants</span>}>
            <ul className="divide-y divide-line">
              {grants.map((g) => (
                <li key={g.id} className="flex items-center gap-2.5 px-3.5 py-2">
                  <Link to={`/team/${g.member}`}>
                    <Avatar id={g.member} size="sm" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-ink">
                      {memberById(g.member).name}{' '}
                      <span className="font-normal text-muted">· {g.scope}</span>
                    </p>
                    <p className="truncate text-[11.5px] text-muted">
                      {g.reason} · approved by {memberById(g.approvedBy).name.split(' ')[0]}
                    </p>
                  </div>
                  <StatusBadge
                    tone={g.expires === 'Standing' ? 'neutral' : 'warn'}
                    label={g.expires === 'Standing' ? 'Standing' : `Until ${g.expires}`}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-bad hover:text-bad"
                    onClick={() =>
                      requestReauth({
                        title: 'Revoke production access',
                        description: `${memberById(g.member).name} loses this access immediately.`,
                        actionLabel: 'Verify & revoke',
                        successMessage: 'Access revoked',
                        onConfirm: () => setGrants((l) => l.filter((x) => x.id !== g.id)),
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
        </div>
      </div>

      <Panel
        title="Sign-in activity"
        meta={
          <button
            onClick={() => toast.success('Export started')}
            className="font-medium text-accent hover:underline"
          >
            Export
          </button>
        }
      >
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
              {signIns.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-3.5 py-2">
                    <Link
                      to={`/team/${s.member}`}
                      className="flex items-center gap-2 font-medium text-ink hover:underline"
                    >
                      <Avatar id={s.member} size="xs" />
                      {memberById(s.member).name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px] text-muted">{s.when}</td>
                  <td className="px-3 py-2 text-ink">{s.method}</td>
                  <td className="px-3 py-2 text-muted">{s.location}</td>
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
