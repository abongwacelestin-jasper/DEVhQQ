import { useEffect, useRef, useState } from 'react';
import type { IdeCommand } from '../../types/ide';

export type MenuEntry = IdeCommand | 'sep';
export interface MenuDef {
  label: string;
  items: MenuEntry[];
}

/** File / Edit / View… menus. Hovering across the bar switches menus once one is open, like a desktop app. */
export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={ref} role="menubar" className="hidden items-center lg:flex">
      {menus.map((m) => (
        <div key={m.label} className="relative">
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === m.label}
            onClick={() => setOpen(open === m.label ? null : m.label)}
            onMouseEnter={() => open && setOpen(m.label)}
            className={`h-[24px] rounded-[5px] px-2 text-[13px] text-[var(--vs-fg)] ${open === m.label ? 'bg-[var(--vs-hover)]' : 'hover:bg-[var(--vs-hover)]'}`}
          >
            {m.label}
          </button>
          {open === m.label && (
            <ul
              role="menu"
              className="absolute left-0 top-[28px] z-50 min-w-[280px] rounded-md border border-[var(--vs-input-border)] bg-[var(--vs-widget)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.36)]"
            >
              {m.items.map((it, i) =>
                it === 'sep' ? (
                  <li
                    key={`sep-${i}`}
                    role="separator"
                    className="mx-1 my-1 h-px bg-[var(--vs-border)]"
                  />
                ) : (
                  <li key={it.id}>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setOpen(null);
                        it.run();
                      }}
                      className="flex w-full items-center gap-8 rounded px-3 py-[4px] text-left text-[13px] text-[var(--vs-fg)] hover:bg-[var(--vs-accent)] hover:text-[var(--vs-on-accent)]"
                    >
                      <span className="flex-1 whitespace-nowrap">
                        {it.label.replace(/^[^:]+:\s/, '')}
                      </span>
                      {it.keys && (
                        <span className="whitespace-nowrap text-[12px] opacity-70">{it.keys}</span>
                      )}
                    </button>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
