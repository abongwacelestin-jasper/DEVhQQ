import { useState } from 'react';
import type { Peer } from '../../hooks/usePresence';

/** Stacked avatars of everyone with the console open; hover/tap for where they are. */
export function PresenceBar({ peers }: { peers: Peer[] }) {
  const [open, setOpen] = useState(false);
  if (!peers.length) return null;
  const shown = peers.slice(0, 3);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${peers.length} other ${peers.length === 1 ? 'person' : 'people'} online`}
        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-sunken"
      >
        <span className="flex -space-x-1.5">
          {shown.map((p) => (
            <span
              key={p.id}
              className={`relative grid h-6 w-6 place-items-center rounded-full text-[9.5px] font-semibold text-white ring-2 ring-white ${p.color}`}
            >
              {p.initials}
              <span className="absolute -bottom-px -right-px h-2 w-2 rounded-full bg-ok ring-2 ring-white" />
            </span>
          ))}
        </span>
        {peers.length > 3 && <span className="text-[11px] text-muted">+{peers.length - 3}</span>}
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-line bg-white p-1 shadow-pop"
        >
          <p className="px-2 py-1 text-[10.5px] font-semibold text-subtle">Online now</p>
          {peers.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9.5px] font-semibold text-white ${p.color}`}
              >
                {p.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-ink">
                  {p.name}
                  {p.simulated ? '' : ' · other tab'}
                </span>
                <span className="block truncate text-[11px] text-subtle">
                  {p.view}
                  {p.focus ? ` · ${p.focus}` : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
