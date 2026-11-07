import { afterEach, describe, expect, it } from 'vitest';
import { clearReturnTo, peekReturnTo, rememberReturnTo } from './authRoutes';

afterEach(() => clearReturnTo());

describe('return-to after sign-in', () => {
  it('replays an in-app deep link with its query and hash', () => {
    rememberReturnTo('/tasks/RB-212?tab=activity#c3');
    expect(peekReturnTo()).toBe('/tasks/RB-212?tab=activity#c3');
  });

  it.each([
    '//evil.example/x',
    '/\\evil.example',
    '/\\/evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/tasks\u0000/x',
    '/sign-in',
    '/verify',
    '/onboarding/nda',
    '/',
  ])('refuses %j', (path) => {
    rememberReturnTo(path);
    expect(peekReturnTo()).toBeNull();
  });

  it('expires after ten minutes', () => {
    sessionStorage.setItem(
      'devhq.returnTo',
      JSON.stringify({ path: '/tasks/RB-1', at: Date.now() - 11 * 60_000 }),
    );
    expect(peekReturnTo()).toBeNull();
  });

  it('ignores a tampered stored value', () => {
    sessionStorage.setItem('devhq.returnTo', JSON.stringify({ path: '/\\evil', at: Date.now() }));
    expect(peekReturnTo()).toBeNull();
  });
});
