import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ScrollTextIcon,
  ShieldOffIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useReauth } from '../../contexts/ReauthContext';
import { api } from '../../api/client';
import type { ApiMember } from '../../api/types';
import type { Member } from '../../types/team';

export interface MemberAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger: boolean;
}

/**
 * Card/row actions for members.
 *
 * Deactivation is a real `PATCH /api/team/:id` — the server revokes the
 * member's sessions and the page resyncs. Actions the API doesn't support
 * (resetting someone else's MFA) are not offered at all.
 */
export function useMemberActions(onReload?: () => Promise<void>) {
  const { log } = useAuth();
  const { requestReauth } = useReauth();
  const navigate = useNavigate();

  const deactivate = async (list: Member[], done?: () => void) => {
    try {
      for (const m of list) {
        await api<ApiMember>(`/api/team/${encodeURIComponent(m.id)}`, {
          method: 'PATCH',
          body: { status: 'deactivated' },
        });
      }
      log('Deactivated members', list.map((m) => m.name).join(', '), true);
      await onReload?.();
      done?.();
      toast.success(
        list.length === 1 ? `${list[0].name} deactivated` : `${list.length} members deactivated`,
        { description: 'Their sessions were revoked by the server.' },
      );
    } catch (e) {
      toast.error('Deactivation failed', {
        description: e instanceof Error ? e.message : 'The team API did not respond.',
      });
      await onReload?.();
    }
  };

  const revoke = (m: Member) =>
    requestReauth({
      title: `Revoke access for ${m.name}`,
      description:
        'All sessions end and production access is removed. Their history stays in the audit log.',
      actionLabel: 'Verify & revoke',
      onConfirm: () => void deactivate([m]),
    });

  const actionsFor = (m: Member): MemberAction[] =>
    [
      {
        label: 'Edit permissions',
        icon: SlidersHorizontalIcon,
        onClick: () => navigate(`/team/${m.id}`),
        danger: false,
        show: true,
      },
      {
        label: 'View audit log',
        icon: ScrollTextIcon,
        onClick: () => navigate(`/audit?actor=${m.id}`),
        danger: false,
        show: true,
      },
      {
        label: 'Revoke access',
        icon: ShieldOffIcon,
        onClick: () => revoke(m),
        danger: true,
        show: m.role !== 'Owner' && m.status !== 'deactivated',
      },
    ]
      .filter((a) => a.show)
      .map(({ show: _show, ...a }) => a);

  const bulkDeactivate = (picked: Member[], done: () => void) =>
    requestReauth({
      title: `Deactivate ${picked.length} member${picked.length > 1 ? 's' : ''}`,
      description: 'Sessions are revoked and production access removed immediately.',
      actionLabel: 'Verify & deactivate',
      onConfirm: () => void deactivate(picked, done),
    });

  return { actionsFor, bulkDeactivate };
}
