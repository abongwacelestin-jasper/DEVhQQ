import { permissionAreas, permissionMatrix, roles } from '../../data/team';
import type { PermissionLevel, RoleName } from '../../types/team';

export const levelMeta: Record<PermissionLevel, { label: string; rank: number }> = {
  none: { label: 'No access', rank: 0 },
  view: { label: 'View', rank: 1 },
  contribute: { label: 'Contribute', rank: 2 },
  manage: { label: 'Manage', rank: 3 },
  admin: { label: 'Admin', rank: 4 },
};

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

export function PermissionMatrix({ highlight }: { highlight?: RoleName }) {
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-[760px] text-[12px]">
        <thead>
          <tr className="border-b border-line">
            <th className="px-3 py-2 text-left text-[11px] font-medium text-subtle">Area</th>
            {roles.map((r) => (
              <th
                key={r.name}
                className={`px-2 py-2 text-left text-[11.5px] font-semibold ${highlight === r.name ? 'bg-accent-soft/50 text-accent-ink' : 'text-ink'}`}
              >
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {permissionAreas.map(({ area, example }) => (
            <tr key={area} className="border-b border-line last:border-0">
              <td className="px-3 py-2">
                <p className="font-medium text-ink">{area}</p>
                <p className="text-[11px] text-subtle">{example}</p>
              </td>
              {roles.map((r) => (
                <td
                  key={r.name}
                  className={`px-2 py-2 ${highlight === r.name ? 'bg-accent-soft/30' : ''}`}
                >
                  <LevelMeter level={permissionMatrix[area][r.name]} showLabel />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
