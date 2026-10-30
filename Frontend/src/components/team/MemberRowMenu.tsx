import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MoreHorizontalIcon } from 'lucide-react';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

export function MemberRowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!visible.length) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="rounded-md p-1 text-subtle transition-colors duration-150 hover:bg-sunken hover:text-ink"
      >
        <MoreHorizontalIcon className="h-4 w-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -2, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -2, scale: 0.97 }}
            transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
            className="absolute right-0 top-7 z-30 w-44 origin-top-right rounded-lg border border-line bg-white p-1 shadow-pop"
          >
            {visible.map((i) => (
              <button
                key={i.label}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  i.onSelect();
                }}
                className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-sunken ${i.danger ? 'text-bad' : 'text-ink'}`}
              >
                {i.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
