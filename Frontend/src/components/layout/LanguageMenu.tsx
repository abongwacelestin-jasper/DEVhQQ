import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckIcon, LanguagesIcon } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';
import { languages } from '../../data/translations';

/** Compact language picker: English, Français, Español. */
export function LanguageMenu({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = languages.find((l) => l.id === lang) ?? languages[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('lang.label')}: ${current.label}`}
        className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-[12px] font-semibold text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
      >
        <LanguagesIcon className="h-4 w-4" />
        <span>{current.short}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            className="absolute right-0 top-9 z-50 w-40 origin-top-right rounded-lg border border-line bg-white p-1 shadow-pop"
          >
            <li className="px-2 pb-1 pt-0.5 text-[11px] font-medium text-muted">
              {t('lang.label')}
            </li>
            {languages.map((l) => (
              <li key={l.id}>
                <button
                  role="menuitemradio"
                  aria-checked={l.id === lang}
                  onClick={() => {
                    setLang(l.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-sunken"
                >
                  <span className="w-6 font-mono text-[11px] text-muted">{l.short}</span>
                  <span className="flex-1">{l.label}</span>
                  {l.id === lang && <CheckIcon className="h-3.5 w-3.5 text-accent" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
