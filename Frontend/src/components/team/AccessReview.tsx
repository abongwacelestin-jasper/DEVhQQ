import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckIcon, KeyRoundIcon, ServerIcon } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import { useReauth } from '../../contexts/ReauthContext';
import type { Member } from '../../types/team';

type Decision = 'kept' | 'revoked' | 'reminded';

export function accessReviewItems(members: Member[]) {
  const active = members.filter((m) => m.status === 'active');
  return [
    ...active.filter((m) => !m.mfa).map((m) => ({ m, kind: 'mfa' as const })),
    ...members
      .filter((m) => m.productionAccess && m.role !== 'Owner')
      .map((m) => ({ m, kind: 'prod' as const })),
  ];
}

export function AccessReview({ members }: { members: Member[] }) {
  const { log } = useAuth();
  const { requestReauth } = useReauth();
  const [reviewed, setReviewed] = useState<Record<string, Decision>>({});
  const items = accessReviewItems(members);
  const done = items.filter((i) => reviewed[`${i.kind}:${i.m.id}`]).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 100;

  const decide = (key: string, d: Decision, m: Member) => {
    const apply = () => {
      setReviewed((r) => ({ ...r, [key]: d }));
      log(
        d === 'revoked'
          ? 'Revoked production access'
          : d === 'kept'
            ? 'Confirmed production access'
            : 'Sent MFA reminder',
        m.name,
        d === 'revoked',
      );
      toast.success(
        d === 'revoked'
          ? `Production access removed for ${m.name}`
          : d === 'kept'
            ? `Access confirmed for ${m.name}`
            : `Reminder sent to ${m.email}`,
      );
    };
    if (d === 'revoked')
      requestReauth({
        title: 'Revoke production access',
        description: `${m.name} loses production access immediately.`,
        actionLabel: 'Verify & revoke',
        onConfirm: apply,
      });
    else apply();
  };

  return (
    <section
      aria-label="Access review"
      className="overflow-hidden rounded-lg border border-line bg-white"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-ink">Q4 2026 access review</h2>
          <p className="text-[12px] text-muted">
            Confirm each standing production grant and chase anyone without MFA. Every decision is
            audited.
          </p>
        </div>
        <div className="flex w-44 items-center gap-2">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
            <span
              className="block h-full rounded-full bg-ok transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="text-[11.5px] tabular-nums text-muted">
            {done}/{items.length}
          </span>
        </div>
      </header>
      {items.length === 0 ? (
        <p className="px-4 py-10 text-center text-[12.5px] text-ok">
          Nothing to review — everyone in scope has MFA and no standing production access.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map(({ m, kind }) => {
            const key = `${kind}:${m.id}`;
            const d = reviewed[key];
            return (
              <li
                key={key}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]"
              >
                <Link to={`/team/${m.id}`} className="flex min-w-0 items-center gap-2.5">
                  <Avatar id={m.id} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold text-ink hover:underline">
                      {m.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted">{m.role}</span>
                  </span>
                </Link>
                <span className="col-span-2 flex items-center gap-1.5 text-[12px] text-ink md:col-span-1">
                  {kind === 'mfa' ? (
                    <KeyRoundIcon className="h-3.5 w-3.5 shrink-0 text-bad" />
                  ) : (
                    <ServerIcon className="h-3.5 w-3.5 shrink-0 text-warn" />
                  )}
                  {kind === 'mfa'
                    ? 'No phishing-resistant MFA — blocked from production'
                    : `Standing production access · ${m.products.length} product${m.products.length > 1 ? 's' : ''} — convert to just-in-time?`}
                </span>
                <span className="col-start-2 row-start-1 flex justify-end gap-1.5 md:col-auto md:row-auto">
                  {d ? (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ok">
                      <CheckIcon className="h-3.5 w-3.5" />{' '}
                      {d === 'kept' ? 'Kept' : d === 'revoked' ? 'Revoked' : 'Reminded'}
                    </span>
                  ) : kind === 'mfa' ? (
                    <button
                      onClick={() => decide(key, 'reminded', m)}
                      className="h-7 rounded-md border border-line px-2.5 text-[12px] font-medium text-ink hover:bg-sunken"
                    >
                      Send reminder
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => decide(key, 'kept', m)}
                        className="h-7 rounded-md border border-line px-2.5 text-[12px] font-medium text-ink hover:bg-sunken"
                      >
                        Keep
                      </button>
                      <button
                        onClick={() => decide(key, 'revoked', m)}
                        className="h-7 rounded-md bg-bad px-2.5 text-[12px] font-semibold text-white hover:bg-bad/90"
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
