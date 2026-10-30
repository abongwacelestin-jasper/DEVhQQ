import React from 'react';
import { ChevronRightIcon } from 'lucide-react';

interface PaneHeaderProps {
  title: string;
  /** 'view' is the side bar title (EXPLORER); 'section' is a collapsible group inside it. */
  variant: 'view' | 'section';
  open?: boolean;
  onToggle?: () => void;
  actions?: React.ReactNode;
}

export function PaneHeader({ title, variant, open = true, onToggle, actions }: PaneHeaderProps) {
  if (variant === 'view') {
    return (
      <div className="flex h-[35px] shrink-0 items-center justify-between pl-5 pr-2">
        <h2 className="truncate text-[11px] font-normal uppercase tracking-[0.06em] text-[var(--vs-fg)]">
          {title}
        </h2>
        <div className="flex items-center gap-0.5">{actions}</div>
      </div>
    );
  }
  return (
    <div className="group flex h-[22px] shrink-0 items-center border-t border-[var(--vs-border)] pr-2 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-full min-w-0 flex-1 items-center gap-0.5 pl-0.5 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--vs-fg)]"
      >
        <ChevronRightIcon
          className={`h-4 w-4 shrink-0 transition-transform duration-100 ${open ? 'rotate-90' : ''}`}
        />
        <span className="truncate">{title}</span>
      </button>
      {actions && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}

/** Small square icon button used across IDE headers. */
export function PaneAction({
  label,
  onClick,
  children,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded-[5px] p-[3px] text-[var(--vs-fg)] hover:bg-[var(--vs-hover)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
