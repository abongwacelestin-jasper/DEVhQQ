import { permissionAreas } from '../../data/team';
import type { ApiPermissionMatrix } from '../../api/types';
import type { PermissionArea, PermissionLevel, RoleName } from '../../types/team';

export const levelMeta: Record<PermissionLevel, { label: string; rank: number }> = {
  none: { label: 'No access', rank: 0 },
  view: { label: 'View', rank: 1 },
  contribute: { label: 'Contribute', rank: 2 },
  manage: { label: 'Manage', rank: 3 },
  admin: { label: 'Admin', rank: 4 },
};

/** Canonical order first, then anything the server adds that this build doesn't know. */
const ROLE_ORDER: RoleName[] = [
  'Owner',
  'Project manager',
  'Developer',
  'Designer',
  'Tester',
  'Operations',
];

export const EXAMPLE_AREA: Partial<Record<PermissionArea, string>> = Object.fromEntries(
  permissionAreas.map(({ area, example }) => [area, example]),
);

export function rolesFromMatrix(matrix: ApiPermissionMatrix): RoleName[] {
  const first = Object.keys(matrix)[0];
  const keys = first ? (Object.keys(matrix[first as PermissionArea]) as RoleName[]) : [];
  return [
    ...ROLE_ORDER.filter((r) => keys.includes(r)),
    ...keys.filter((k) => !ROLE_ORDER.includes(k)),
  ];
}

export function areasFromMatrix(matrix: ApiPermissionMatrix): PermissionArea[] {
  const keys = Object.keys(matrix) as PermissionArea[];
  return [
    ...permissionAreas.map((a) => a.area).filter((a) => keys.includes(a)),
    ...keys.filter((k) => !permissionAreas.some((a) => a.area === k)),
  ];
}

/** Four-step meter that reads at a glance and stays compact in dense tables. */
export function LevelMeter({
  level,
  showLabel = false,
}: {
  level: PermissionLevel;
  showLabel?: boolean;
}) {
  const { rank, label } = levelMeta[level];
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`w-[3px] rounded-sm ${i <= rank ? (rank === 4 ? 'bg-ink' : 'bg-accent') : 'bg-line'}`}
            style={{ height: 4 + i * 2 }}
          />
        ))}
      </span>
      {showLabel ? (
        <span className={`text-[11.5px] ${rank ? 'text-ink' : 'text-subtle'}`}>{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  );
}

export function PermissionMatrix({
  matrix,
  highlight,
}: {
  matrix: ApiPermissionMatrix;
  highlight?: RoleName;
}) {
  const roles = rolesFromMatrix(matrix);
  const areas = areasFromMatrix(matrix);
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-[760px] text-[12px]">
        <thead>
          <tr className="border-b border-line">
            <th className="px-3 py-2 text-left text-[11px] font-medium text-subtle">Area</th>
            {roles.map((name) => (
              <th
                key={name}
                className={`px-2 py-2 text-left text-[11.5px] font-semibold ${highlight === name ? 'bg-accent-soft/50 text-accent-ink' : 'text-ink'}`}
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {areas.map((area) => (
            <tr key={area} className="border-b border-line last:border-0">
              <td className="px-3 py-1.5">
                <p className="text-[12px] font-medium text-ink">{area}</p>
                {EXAMPLE_AREA[area] && (
                  <p className="truncate text-[11px] text-subtle">{EXAMPLE_AREA[area]}</p>
                )}
              </td>
              {roles.map((role) => (
                <td key={role} className="px-2 py-1.5">
                  <LevelMeter level={matrix[area][role]} showLabel />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
