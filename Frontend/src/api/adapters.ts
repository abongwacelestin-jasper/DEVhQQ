/**
 * Adapters between API payloads and the shapes the UI components already use.
 *
 * The UI's `Member` carries presentation fields (initials, colour, capacity)
 * that the API has no business storing. They are derived here once, so pages
 * never invent them.
 */

import type { Member, RoleName } from '../types/team';
import type { ProductId } from '../types/portfolio';
import type { ApiMember } from './types';

const COLORS = [
  '#4F46E5',
  '#0E7490',
  '#B45309',
  '#15803D',
  '#BE185D',
  '#7C3AED',
  '#0369A1',
  '#A16207',
  '#C2410C',
  '#047857',
  '#B91C1C',
  '#475569',
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
}

export function toMember(api: ApiMember): Member {
  const index = Number(api.id.replace(/\D/g, '')) || 1;
  return {
    id: api.id,
    name: api.name,
    initials: initials(api.name),
    email: api.email,
    role: api.role as RoleName,
    products: api.products as ProductId[],
    // Production access is granted just-in-time, never held standing (see Backend/auth/jit.ts).
    productionAccess: false,
    mfa: !!api.mfa,
    status: api.status,
    lastActive: '—',
    openTasks: 0,
    capacity: 10,
    color: COLORS[(index - 1) % COLORS.length],
  };
}
