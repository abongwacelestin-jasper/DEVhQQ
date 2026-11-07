import { describe, expect, it } from 'vitest';
import { repoFromSlug, repoSlug } from './slug';

describe('repo slugs', () => {
  it('turns owner/name into a single URL segment', () => {
    expect(repoSlug('devhq/renewberry-api')).toBe('devhq--renewberry-api');
    expect(repoSlug('devhq/renewberry-api')).not.toContain('/');
  });

  it('round-trips realistic GitHub owner/repo names', () => {
    // GitHub owners cannot contain "--"; repository names may contain "-", "_" and ".".
    const names = [
      'devhq/renewberry-api',
      'acme/blog',
      'mirror-acture/platform.infra',
      'o/a--b',
      'a-b/c_d',
      'x/y-',
    ];
    for (const n of names) expect(repoFromSlug(repoSlug(n))).toBe(n);
  });

  it('leaves a slug without a separator untouched', () => {
    expect(repoFromSlug('plain')).toBe('plain');
  });
});
