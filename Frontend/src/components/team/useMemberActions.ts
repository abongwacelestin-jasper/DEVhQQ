import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  KeyRoundIcon,
  ScrollTextIcon,
  ShieldOffIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useReauth } from '../../contexts/ReauthContext';
import type { Member } from '../../types/team';

export interface MemberAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger: boolean;
}

/** Row/card actions and bulk actions for members; sensitive ones go through MFA re-verification. */
export function useMemberActions() {
  const { log } = useAuth();
  const { requestReauth } = useReauth();
  const navigate = useNavigate();

  const revoke = (m: Member) =>
    requestReauth({
      title: `Revoke access for ${m.name}`,
      description:
        'All sessions end, API tokens are revoked and production access is removed. Their history stays in the audit log.',
      actionLabel: 'Verify & revoke',
      successMessage: `${m.name}’s access revoked`,
      onConfirm: () => log('Revoked member access', m.name, true),
    });

  const resetMfa = (m: Member) =>
    requestReauth({
      title: `Reset MFA for ${m.name}`,
      description:
        'Their authenticators and passkeys are removed. They must enrol again at next sign-in.',
      actionLabel: 'Verify & reset',
      successMessage: `MFA reset — ${m.email} will re-enrol`,
      onConfirm: () => log('Reset MFA', m.name, true),
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
        label: 'Reset MFA',
        icon: KeyRoundIcon,
        onClick: () => resetMfa(m),
        danger: false,
        show: m.mfa && m.status === 'active',
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

  const bulkMfa = (picked: Member[], done: () => void) => {
    const targets = picked.filter((m) => !m.mfa);
    log('Required MFA', `${picked.length} member${picked.length > 1 ? 's' : ''}`, true);
    toast.success(
      targets.length
        ? `MFA enforced for ${targets.length} member${targets.length > 1 ? 's' : ''}`
        : 'Everyone selected already uses MFA',
    );
    done();
  };

  const bulkDeactivate = (picked: Member[], done: () => void) =>
    requestReauth({
      title: `Deactivate ${picked.length} member${picked.length > 1 ? 's' : ''}`,
      description: 'Sessions are revoked and production access removed immediately.',
      actionLabel: 'Verify & deactivate',
      successMessage: 'Members deactivated',
      onConfirm: () => {
        log('Deactivated members', picked.map((m) => m.name).join(', '), true);
        done();
      },
    });

  return { actionsFor, bulkMfa, bulkDeactivate };
}
