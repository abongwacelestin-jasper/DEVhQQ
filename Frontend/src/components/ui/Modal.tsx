import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { XIcon } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  illustration?: React.ReactNode;
}

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  illustration,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(
      () =>
        panelRef.current
          ?.querySelector<HTMLElement>('input, select, textarea, button[data-autofocus]')
          ?.focus(),
      60,
    );
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-ink/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className={`relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop sm:rounded-xl ${widths[size]}`}
          >
            <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
              {illustration && <div className="hidden shrink-0 sm:block">{illustration}</div>}
              <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
                {description && <p className="mt-0.5 text-[12px] text-muted">{description}</p>}
              </div>
              <button
                onClick={onClose}
                className="-mr-1 shrink-0 rounded-md p-1 text-muted hover:bg-sunken hover:text-ink"
                aria-label="Close"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5 scroll-thin">{children}</div>
            {footer && (
              <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-sunken/40 px-4 py-2.5">
                {footer}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="text-[12px] font-medium text-ink">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-8 w-full rounded-md border border-line bg-white px-2.5 text-[12.5px] text-ink outline-none transition-colors duration-150 placeholder:text-subtle focus:border-accent';
