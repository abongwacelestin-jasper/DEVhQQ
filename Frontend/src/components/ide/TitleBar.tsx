import React from 'react';
import { PanelBottomIcon, PanelLeftIcon, PanelRightIcon, SearchIcon } from 'lucide-react';
import { BrandLogo } from '../ui/BrandLogo';
import { MenuBar, type MenuDef } from './MenuBar';

interface TitleBarProps {
  repo: string;
  menus: MenuDef[];
  sideOpen: boolean;
  panelOpen: boolean;
  chatOpen: boolean;
  onHome: () => void;
  onQuickOpen: () => void;
  onToggleSide: () => void;
  onTogglePanel: () => void;
  onToggleChat: () => void;
}

export function TitleBar({
  repo,
  menus,
  sideOpen,
  panelOpen,
  chatOpen,
  onHome,
  onQuickOpen,
  onToggleSide,
  onTogglePanel,
  onToggleChat,
}: TitleBarProps) {
  const [owner, name] = repo.split('/');
  const toggle = (
    on: boolean,
    label: string,
    onClick: () => void,
    Icon: React.ComponentType<{ className?: string }>,
    cls = '',
  ) => (
    <button
      onClick={onClick}
      aria-pressed={on}
      title={label}
      aria-label={label}
      className={`rounded-[5px] p-1 hover:bg-[var(--vs-hover)] ${on ? 'text-[var(--vs-fg)]' : 'text-[var(--vs-fg-dim)]'} ${cls}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <header className="flex h-[35px] shrink-0 select-none items-center gap-1 border-b border-[var(--vs-border)] bg-[var(--vs-title)] px-1.5">
      <button
        onClick={onHome}
        title="Back to TavetaHQ"
        className="flex h-[26px] shrink-0 items-center gap-1.5 rounded-[5px] px-1.5 hover:bg-[var(--vs-hover)]"
      >
        <BrandLogo size={18} />
        <span className="hidden text-[12px] font-semibold text-[var(--vs-fg)] sm:inline">
          TavetaHQ
        </span>
      </button>
      <MenuBar menus={menus} />
      <div className="flex min-w-0 flex-1 justify-center px-2">
        <button
          onClick={onQuickOpen}
          className="flex h-[24px] w-full max-w-[560px] items-center justify-center gap-2 rounded-md border border-[var(--vs-input-border)] bg-[var(--vs-input)] px-3 text-[12.5px] text-[var(--vs-fg-muted)] transition-colors duration-150 hover:border-[var(--vs-fg-dim)]"
          aria-label="Search files and commands"
        >
          <SearchIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {name} <span className="text-[var(--vs-fg-dim)]">— {owner}</span>
          </span>
          <kbd className="ml-auto hidden font-sans text-[11px] text-[var(--vs-fg-dim)] md:inline">
            Ctrl P
          </kbd>
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {toggle(sideOpen, 'Toggle Primary Side Bar (Ctrl+B)', onToggleSide, PanelLeftIcon)}
        {toggle(panelOpen, 'Toggle Panel (Ctrl+J)', onTogglePanel, PanelBottomIcon)}
        {toggle(chatOpen, 'Toggle Chat (Ctrl+Alt+I)', onToggleChat, PanelRightIcon)}
      </div>
    </header>
  );
}
