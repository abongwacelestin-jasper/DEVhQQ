import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
  it('treats an empty or blank query as a neutral match', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('   ', 'anything')).toBe(0);
  });

  it('returns null when a character is missing or out of order', () => {
    expect(fuzzyScore('xyz', 'deployments')).toBeNull();
    expect(fuzzyScore('tp', 'pt')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('DEPLOY', 'deployments')).toBe(fuzzyScore('deploy', 'Deployments'));
  });

  it('scores a prefix substring above the same substring later in the text', () => {
    const prefix = fuzzyScore('dep', 'deployments')!;
    const later = fuzzyScore('dep', 'new deployments')!;
    const mid = fuzzyScore('loy', 'deployments')!;
    expect(prefix).toBe(1200);
    // "dep" after a space is a word start: bonus but positional penalty.
    expect(later).toBe(1000 - 4 + 200);
    expect(mid).toBe(1000 - 3);
    expect(prefix).toBeGreaterThan(later);
    expect(later).toBeGreaterThan(mid);
  });

  it('counts separators / . _ - as word starts', () => {
    for (const sep of ['/', '.', '_', '-', ' ']) {
      expect(fuzzyScore('api', `x${sep}api`)).toBe(1000 - 2 + 200);
    }
  });

  it('always ranks contiguous substrings above scattered subsequences', () => {
    const texts = ['pull requests', 'repositories', 'pipelines', 'pager rotation'];
    for (const t of texts) {
      const sub = fuzzyScore(t.slice(0, 3), t)!;
      const scattered = fuzzyScore(`${t[0]}${t[2]}${t[4]}`, t);
      if (scattered !== null) expect(sub).toBeGreaterThan(scattered);
    }
  });

  it('scores scattered matches, rewarding runs and word starts and ignoring spaces in the query', () => {
    const scattered = fuzzyScore('pr q', 'pull requests');
    expect(scattered).not.toBeNull();
    // p at 0 (run + word start) · r at 5 (word start, gap 4) · q at 7 (gap 1)
    expect(scattered).toBe(10 + 6 + 8 + (10 + 8 - 4) + (10 - 1));
    // p,l contiguous then q after '-' (word start): 24 + 22 + 17
    expect(fuzzyScore('plq', 'pl-q')).toBe(63);
    // p, then l and q each two characters later with no bonus: 24 + 8 + 8
    expect(fuzzyScore('plq', 'pxxlxxq')).toBe(40);
  });
});
