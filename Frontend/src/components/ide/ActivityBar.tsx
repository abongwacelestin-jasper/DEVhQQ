import React, { useEffect, useRef, useState } from 'react';
import {
  BugPlayIcon,
  CheckIcon,
  FilesIcon,
  GitBranchIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from 'lucide-react';
import type { IdeSettings, IdeView } from '../../types/ide';

interface ActivityBarProps {
  view: IdeView;
  sideOpen: boolean;
  scmCount: number;
  running: boolean;
  settings: IdeSettings;
  user: { name: string; email: string; initials: string; color: string };
  onView: (v: IdeView) => void;
  onSetting: <K extends keyof IdeSettings>(key: K, value: IdeSettings[K]) => void;
  onCommands: () => void;
  onHome: () => void;
}

const items: { id: IdeView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'explorer', label: 'Explorer (Ctrl+Shift+E)', icon: FilesIcon },
  { id: 'search', label: 'Search (Ctrl+Shift+F)', icon: SearchIcon },
  { id: 'scm', label: 'Source Control (Ctrl+Shift+G)', icon: GitBranchIcon },
  { id: 'run', label: 'Run and Debug (Ctrl+Shift+D)', icon: BugPlayIcon },
];

export function ActivityBar({
  view,
  sideOpen,
  scmCount,
  running,
  settings,
  user,
  onView,
  onSetting,
  onCommands,
  onHome,
}: ActivityBarProps) {
  const [menu, setMenu] = useState<'settings' | 'account' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const row =
    'flex w-full items-center gap-3 rounded px-3 py-[4px] text-left text-[13px] text-[var(--vs-fg)] hover:bg-[var(--vs-accent)] hover:text-[var(--vs-on-accent)]';
  const check = (on: boolean) => (
    <CheckIcon className={`h-3.5 w-3.5 shrink-0 ${on ? '' : 'invisible'}`} />
  );

  return (
    <nav
      aria-label="Activity bar"
      className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-[var(--vs-border)] bg-[var(--vs-activity)]"
    >
      <ul className="w-full">
        {items.map((it) => {
          const active = sideOpen && view === it.id;
          return (
            <li key={it.id}>
              <button
                onClick={() => onView(it.id)}
                title={it.label}
                aria-label={it.label}
                aria-pressed={active}
                className={`relative flex h-12 w-12 items-center justify-center transition-colors duration-100 ${active ? 'text-[var(--vs-fg)]' : 'text-[var(--vs-fg-dim)] hover:text-[var(--vs-fg)]'}`}
              >
                {active && (
                  <span className="absolute inset-y-0 left-0 w-[2px] bg-[var(--vs-accent)]" />
                )}
                <it.icon className="h-6 w-6" />
                {it.id === 'scm' && scmCount > 0 && (
                  <span className="absolute bottom-2 right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--vs-accent)] px-1 text-[10px] font-semibold text-[var(--vs-on-accent)]">
                    {scmCount}
                  </span>
                )}
                {it.id === 'run' && running && (
                  <span className="absolute bottom-2.5 right-2.5 h-2 w-2 animate-pulse rounded-full bg-[var(--vs-t-green)]" />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div ref={ref} className="relative w-full pb-1">
        <button
          onClick={() => setMenu(menu === 'account' ? null : 'account')}
          title={`Accounts — ${user.name}`}
          aria-label="Accounts"
          className="flex h-12 w-12 items-center justify-center"
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-[#fff]"
            style={{ background: user.color }}
          >
            {user.initials}
          </span>
        </button>
        <button
          onClick={() => setMenu(menu === 'settings' ? null : 'settings')}
          title="Manage"
          aria-label="Manage settings"
          className="flex h-12 w-12 items-center justify-center text-[var(--vs-fg-dim)] hover:text-[var(--vs-fg)]"
        >
          <SettingsIcon className="h-6 w-6" />
        </button>

        {menu && (
          <div
            role="menu"
            className="absolute bottom-2 left-[52px] z-50 w-[270px] rounded-md border border-[var(--vs-input-border)] bg-[var(--vs-widget)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.36)]"
          >
            {menu === 'account' ? (
              <>
                <p className="px-3 pb-1 pt-1.5 text-[13px] text-[var(--vs-fg)]">{user.name}</p>
                <p className="px-3 pb-2 text-[12px] text-[var(--vs-fg-muted)]">
                  {user.email} · signed in to TavetaHQ
                </p>
                <div className="mx-1 my-1 h-px bg-[var(--vs-border)]" />
                <button className={row} onClick={onHome}>
                  Open TavetaHQ dashboard
                </button>
              </>
            ) : (
              <>
                <button
                  className={row}
                  onClick={() => {
                    setMenu(null);
                    onCommands();
                  }}
                >
                  Command Palette…{' '}
                  <span className="ml-auto text-[12px] opacity-70">Ctrl+Shift+P</span>
                </button>
                <div className="mx-1 my-1 h-px bg-[var(--vs-border)]" />
                <p className="px-3 py-1 text-[11px] uppercase tracking-wide text-[var(--vs-fg-dim)]">
                  Color theme
                </p>
                <button className={row} onClick={() => onSetting('theme', 'dark')}>
                  {check(settings.theme === 'dark')} Dark Modern
                </button>
                <button className={row} onClick={() => onSetting('theme', 'light')}>
                  {check(settings.theme === 'light')} Light Modern
                </button>
                <div className="mx-1 my-1 h-px bg-[var(--vs-border)]" />
                <button className={row} onClick={() => onSetting('wordWrap', !settings.wordWrap)}>
                  {check(settings.wordWrap)} Word wrap{' '}
                  <span className="ml-auto text-[12px] opacity-70">Alt+Z</span>
                </button>
                <button className={row} onClick={() => onSetting('minimap', !settings.minimap)}>
                  {check(settings.minimap)} Minimap
                </button>
                <button
                  className={row}
                  onClick={() => onSetting('formatOnSave', !settings.formatOnSave)}
                >
                  {check(settings.formatOnSave)} Format on save
                </button>
                <div className="flex items-center gap-2 px-3 py-[4px] text-[13px] text-[var(--vs-fg)]">
                  <span className="w-3.5" />
                  <span className="flex-1">Font size</span>
                  <button
                    onClick={() => onSetting('fontSize', Math.max(10, settings.fontSize - 1))}
                    className="rounded p-0.5 hover:bg-[var(--vs-hover)]"
                    aria-label="Decrease font size"
                  >
                    <MinusIcon className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-6 text-center tabular-nums">{settings.fontSize}</span>
                  <button
                    onClick={() => onSetting('fontSize', Math.min(22, settings.fontSize + 1))}
                    className="rounded p-0.5 hover:bg-[var(--vs-hover)]"
                    aria-label="Increase font size"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
