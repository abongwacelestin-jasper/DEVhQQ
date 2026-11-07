import { describe, expect, it } from 'vitest';
import type { ApiMember } from './types';
import { toMember } from './adapters';

const api = (patch: Partial<ApiMember> = {}): ApiMember => ({
  id: 'm4',
  name: 'Kofi Mensah',
  email: 'kofi@techorg.io',
  role: 'Developer',
  products: ['renewberry'],
  status: 'active',
  ...patch,
});

describe('toMember', () => {
  it('copies identity fields and derives presentation fields', () => {
    const m = toMember(api({ mfa: true }));
    expect(m).toMatchObject({
      id: 'm4',
      name: 'Kofi Mensah',
      initials: 'KM',
      email: 'kofi@techorg.io',
      role: 'Developer',
      products: ['renewberry'],
      status: 'active',
      mfa: true,
      lastActive: '—',
      openTasks: 0,
      capacity: 10,
    });
    expect(m.color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('never grants standing production access', () => {
    expect(toMember(api({ role: 'Owner' })).productionAccess).toBe(false);
  });

  it('treats a missing mfa flag as false', () => {
    expect(toMember(api()).mfa).toBe(false);
  });

  it.each([
    ['Amara Okafor', 'AO'],
    ['  Inès   Moreau  ', 'IM'],
    ['cher', 'C'],
    ['ada byron king lovelace', 'AB'],
    ['', ''],
  ])('initials(%j) = %j', (name, initials) => {
    expect(toMember(api({ name })).initials).toBe(initials);
  });

  it('picks a stable colour from the numeric id and wraps around the palette', () => {
    const c = (id: string) => toMember(api({ id })).color;
    expect(c('m1')).toBe(c('m13'));
    expect(c('m12')).not.toBe(c('m1'));
    expect(c('no-digits')).toBe(c('m1'));
    expect(c('m4')).toBe(c('m4'));
    const palette = new Set(Array.from({ length: 24 }, (_, i) => c(`m${i + 1}`)));
    expect(palette.size).toBe(12);
  });
});
