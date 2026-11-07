import { describe, expect, it } from 'vitest';
import { demoRoles } from '../data/roles';
import { pathForStage } from './authRoutes';

describe('pathForStage', () => {
  it.each([
    ['signed-out', '/sign-in'],
    ['mfa', '/verify'],
    ['nda', '/onboarding/nda'],
    ['profile', '/onboarding/profile'],
  ] as const)('%s → %s regardless of role', (stage, path) => {
    expect(pathForStage(stage, null)).toBe(path);
    for (const role of demoRoles) expect(pathForStage(stage, role)).toBe(path);
  });

  it("sends a ready session to the role's home", () => {
    for (const role of demoRoles) expect(pathForStage('ready', role)).toBe(role.home);
  });

  it('sends a ready session with no role to /', () => {
    expect(pathForStage('ready', null)).toBe('/');
  });
});
