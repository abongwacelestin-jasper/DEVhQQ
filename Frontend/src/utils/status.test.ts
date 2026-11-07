import { describe, expect, it } from 'vitest';
import type { Tone } from '../types/portfolio';
import { members } from '../data/team';
import { products } from '../data/portfolio';
import {
  ciMeta,
  deployMeta,
  firstName,
  healthMeta,
  laneMeta,
  memberById,
  priorityMeta,
  productById,
  projectStatusMeta,
  reviewMeta,
  taskStatusMeta,
  toneDot,
  toneText,
} from './status';

const TONES: Tone[] = ['ok', 'warn', 'bad', 'neutral', 'info', 'accent'];

describe('status meta tables', () => {
  const tables = {
    healthMeta,
    deployMeta,
    laneMeta,
    ciMeta,
    reviewMeta,
    taskStatusMeta,
    projectStatusMeta,
    priorityMeta,
  };

  it.each(Object.entries(tables))('%s has a non-empty label and a known tone per key', (_n, t) => {
    for (const meta of Object.values(t)) {
      expect(meta.label.trim()).not.toBe('');
      expect(TONES).toContain(meta.tone);
    }
  });

  it('maps failures to "bad" and successes to "ok"', () => {
    expect(deployMeta.failed.tone).toBe('bad');
    expect(deployMeta.succeeded.tone).toBe('ok');
    expect(ciMeta.failing.tone).toBe('bad');
    expect(taskStatusMeta.done.tone).toBe('ok');
    expect(priorityMeta.urgent.tone).toBe('bad');
    expect(projectStatusMeta.blocked.tone).toBe('bad');
  });

  it('has a text and dot class for every tone', () => {
    for (const tone of TONES) {
      expect(toneText[tone]).toMatch(/^text-/);
      expect(toneDot[tone]).toMatch(/^bg-/);
    }
  });
});

describe('lookups', () => {
  it('memberById finds members and falls back to the first member', () => {
    const someone = members[members.length - 1];
    expect(memberById(someone.id)).toBe(someone);
    expect(memberById('does-not-exist')).toBe(members[0]);
  });

  it('productById finds products and falls back to the first product', () => {
    const last = products[products.length - 1];
    expect(productById(last.id)).toBe(last);
  });

  it('firstName returns the first word of the member name', () => {
    const m = members[0];
    expect(firstName(m.id)).toBe(m.name.split(' ')[0]);
    expect(firstName(m.id)).not.toContain(' ');
  });
});
