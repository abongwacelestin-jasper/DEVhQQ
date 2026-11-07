import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckIcon, ChevronRightIcon, KeyRoundIcon, ServerIcon, XIcon } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { SearchInput } from '../ui/SearchInput';
import { useReauth } from '../../contexts/ReauthContext';
import { api } from '../../api/client';
import type { ApiGrant } from '../../api/types';
import type { Member } from '../../types/team';

export interface ReviewItem {
  key: string;
  member: Member;
  kind: 'mfa' | 'grant';
  grant?: ApiGrant;
}

/**
 * What actually needs a decision right now: standing grants waiting for a
 * second approver, and active accounts without a second factor. Both come from
 * the API — there is no seeded review list.
 */
export function accessReviewItems(members: Member[], grants: ApiGrant[] = []): ReviewItem[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const mfa = members
    .filter((m) => m.status === 'active' && !m.mfa)
    .map((m) => ({ key: `mfa:${m.id}`, member: m, kind: 'mfa' as const }));
  const pending = grants
    .filter((g) => g.status === 'pending' && byId.has(g.memberId))
    .map((g) => ({
      key: `grant:${g.id}`,
      member: byId.get(g.memberId)!,
      kind: 'grant' as const,
      grant: g,
    }));
  return [...pending, ...mfa];
}

const minutes = (ms: number) => `${Math.round(ms / 60_000)}m`;

export function AccessReview({
  members,
  grants,
  onReload,
}: {
  members: Member[];
  grants: ApiGrant[];
  onReload: () => Promise<void>;
}) {
  const { requestReauth } = useReauth();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const items = accessReviewItems(members, grants);
  const term = q.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      !term ||
      `${i.member.name} ${i.member.role} ${i.kind} ${i.grant?.scope ?? ''}`
        .toLowerCase()
        .includes(term),
  );

  const decideGrant = async (grant: ApiGrant, action: 'approve' | 'deny') => {
    setBusy(grant.id);
    try {
      await api(`/api/access/grants/${encodeURIComponent(grant.id)}/${action}`, { method: 'POST' });
      await onReload();
      toast.success(action === 'approve' ? 'Grant approved' : 'Grant revoked', {
        description: `${grant.scope} · ${grant.memberId}`,
      });
    } catch (e) {
      toast.error(action === 'approve' ? 'Approval failed' : 'Revocation failed', {
        description: e instanceof Error ? e.message : 'The access API did not respond.',
      });
    } finally {
      setBusy(null);
    }
  };

  const ask = (grant: ApiGrant, action: 'approve' | 'deny') =>
    requestReauth({
      title: action === 'approve' ? 'Approve production access' : 'Revoke production access',
      description:
        action === 'approve'
          ? `${grant.scope} for ${minutes(grant.durationMs)} — your approval is recorded in the audit log.`
          : `${grant.scope} is withdrawn immediately.`,
      actionLabel: action === 'approve' ? 'Verify & approve' : 'Verify & revoke',
      onConfirm: () => void decideGrant(grant, action),
    });

  return (
    <section
      aria-label="Access review"
      className="overflow-hidden rounded-lg border border-line bg-white"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3.5 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-ink">Access review</h2>
          <p className="text-[11.5px] text-muted">
            Approve time-boxed production grants and chase accounts without a second factor.
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-warn-soft px-1.5 text-[11px] font-semibold text-warn">
          {items.length} to review
        </span>
      </header>
      <div className="border-b border-line px-2.5 py-1.5">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Filter by person, scope or reason…"
          label="Filter access review"
        />
      </div>

      {shown.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-[12.5px] text-ok">
          {items.length === 0
            ? 'Nothing to review — everyone in scope has MFA and no grant is waiting.'
            : 'No review items match this filter.'}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map(({ key, member, kind, grant }) => (
            <li
              key={key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3.5 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]"
            >
              <Link to={`/team/${member.id}`} className="flex min-w-0 items-center gap-2">
                <Avatar id={member.id} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold text-ink hover:underline">
                    {member.name}
                  </span>
                  <span className="block truncate text-[11px] text-muted">{member.role}</span>
                </span>
              </Link>

              <span className="col-span-2 flex min-w-0 items-center gap-1.5 text-[12px] text-ink md:col-span-1">
                {kind === 'grant' ? (
                  <>
                    <ServerIcon className="h-3.5 w-3.5 shrink-0 text-warn" />
                    <span className="truncate">
                      <span className="font-mono">{grant?.scope}</span> ·{' '}
                      {minutes(grant?.durationMs ?? 0)}{' '}
                      <span className="text-muted">— {grant?.reason}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <KeyRoundIcon className="h-3.5 w-3.5 shrink-0 text-bad" />
                    <span className="truncate">
                      No second factor — production stays blocked
                      <span className="text-muted"> · ask them to enrol</span>
                    </span>
                  </>
                )}
              </span>

              <span className="col-start-2 row-start-1 flex justify-end gap-1.5 md:col-auto md:row-auto">
                {kind === 'grant' && grant ? (
                  <>
                    <button
                      onClick={() => ask(grant, 'deny')}
                      disabled={busy === grant.id}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] font-medium text-ink hover:bg-sunken disabled:opacity-50"
                    >
                      <XIcon className="h-3.5 w-3.5" /> Deny
                    </button>
                    <button
                      onClick={() => ask(grant, 'approve')}
                      disabled={busy === grant.id}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-ink px-2 text-[12px] font-semibold text-white hover:bg-ink/90 disabled:opacity-50"
                    >
                      <CheckIcon className="h-3.5 w-3.5" /> Approve
                    </button>
                  </>
                ) : (
                  <Link
                    to={`/team/${member.id}`}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] font-medium text-ink hover:bg-sunken"
                  >
                    Open <ChevronRightIcon className="h-3.5 w-3.5" />
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
