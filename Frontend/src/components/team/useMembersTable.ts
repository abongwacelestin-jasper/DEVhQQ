import { useMemo, useState } from 'react';
import type { Member, RoleName } from '../../types/team';

export type SortKey = 'name' | 'role' | 'load' | 'lastActive';
export type SecurityFlag = 'no-mfa' | 'mfa' | 'prod' | 'overloaded';

const roleOrder: RoleName[] = [
  'Owner',
  'Project manager',
  'Developer',
  'Designer',
  'Tester',
  'Operations',
];

function activeRank(s: string) {
  if (s === 'Now') return 0;
  const m = s.match(/^(\d+)([mhd])/);
  if (!m) return 1e9;
  const n = Number(m[1]);
  return m[2] === 'm' ? n : m[2] === 'h' ? n * 60 : n * 1440;
}

export const flagTest: Record<SecurityFlag, (m: Member) => boolean> = {
  'no-mfa': (m) => m.status === 'active' && !m.mfa,
  mfa: (m) => m.mfa,
  prod: (m) => m.productionAccess,
  overloaded: (m) => m.openTasks > m.capacity,
};

/** Needs attention: active without MFA, standing production access (non-owner), or over capacity. */
export const needsAttention = (m: Member) =>
  flagTest['no-mfa'](m) || (m.productionAccess && m.role !== 'Owner') || flagTest.overloaded(m);

/** Filtering (multi-select), sorting and selection state for the members table. */
export function useMembersTable(source: Member[], initialRole: RoleName | '' = '') {
  const [q, setQ] = useState('');
  const [roles, setRoles] = useState<RoleName[]>(initialRole ? [initialRole] : []);
  const [statuses, setStatuses] = useState<Member['status'][]>([]);
  const [flags, setFlags] = useState<SecurityFlag[]>([]);
  const [attention, setAttention] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = source.filter(
      (m) =>
        (!roles.length || roles.includes(m.role)) &&
        (!statuses.length || statuses.includes(m.status)) &&
        (!flags.length || flags.some((f) => flagTest[f](m))) &&
        (!attention || needsAttention(m)) &&
        (!needle || `${m.name} ${m.email} ${m.role}`.toLowerCase().includes(needle)),
    );
    const cmp = (a: Member, b: Member) => {
      switch (sort.key) {
        case 'role':
          return (
            roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.name.localeCompare(b.name)
          );
        case 'load':
          return a.openTasks / (a.capacity || 1) - b.openTasks / (b.capacity || 1);
        case 'lastActive':
          return activeRank(a.lastActive) - activeRank(b.lastActive);
        default:
          return a.name.localeCompare(b.name);
      }
    };
    return [...filtered].sort((a, b) => cmp(a, b) * sort.dir);
  }, [source, q, roles, statuses, flags, attention, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());
  const activeFilters =
    Number(!!q) + roles.length + statuses.length + flags.length + Number(attention);
  const resetFilters = () => {
    setQ('');
    setRoles([]);
    setStatuses([]);
    setFlags([]);
    setAttention(false);
  };

  return {
    q,
    setQ,
    roles,
    setRoles,
    statuses,
    setStatuses,
    flags,
    setFlags,
    attention,
    setAttention,
    sort,
    toggleSort,
    rows,
    selected,
    toggle,
    toggleAll,
    allSelected,
    clearSelection,
    activeFilters,
    resetFilters,
  };
}

export function exportMembersCsv(list: Member[]) {
  const head = [
    'Name',
    'Email',
    'Role',
    'Status',
    'Products',
    'MFA',
    'Production access',
    'Open tasks',
    'Capacity',
    'Last active',
  ];
  const esc = (v: string | number | boolean) => `"${String(v).replace(/"/g, '""')}"`;
  const body = list.map((m) =>
    [
      m.name,
      m.email,
      m.role,
      m.status,
      m.products.join(' '),
      m.mfa,
      m.productionAccess,
      m.openTasks,
      m.capacity,
      m.lastActive,
    ]
      .map(esc)
      .join(','),
  );
  const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `devhq-members-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
