import type { AuthStage } from '../contexts/AuthContext';
import type { DemoRole } from '../data/roles';

/** Where a session at a given stage belongs. */
export function pathForStage(stage: AuthStage, role: DemoRole | null) {
  switch (stage) {
    case 'signed-out':
      return '/sign-in';
    case 'mfa':
      return '/verify';
    case 'nda':
      return '/onboarding/nda';
    case 'profile':
      return '/onboarding/profile';
    default:
      return role?.home ?? '/';
  }
}
