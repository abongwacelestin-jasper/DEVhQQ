import { useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { LayoutGridIcon, PlusIcon } from 'lucide-react';
import { MoreSheet } from './MoreSheet';
import { QuickActions } from './QuickActions';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNavEntries, type CountedEntry } from '../../hooks/useNavEntries';

const ease = [0.23, 1, 0.32, 1] as const;

/**
 * Tablet + mobile navigation. A slim bar where the active tab gets a filled pill and a hover
 * highlight glides between items. Tabs follow the signed-in role.
 */
export function BottomNav() {
  const { mobileNavOpen, setMobileNavOpen } = useWorkspaceUI();
  const { role } = useAuth();
  const { byPath } = useNavEntries();
  const [quickOpen, setQuickOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  if (!role) return null;

  const tabs = role.bottomTabs.map((p) => byPath(p)).filter((x): x is CountedEntry => !!x);
  const hasActions = role.actions.some(
    (a) => a !== 'deploy:approve' && a !== 'workspace:create' && a !== 'task:assign',
  );

  const phoneLeft = tabs.slice(0, 2);
  const phoneRight = tabs.slice(2, 3);
  const tablet = tabs.slice(0, 6);
  const mid = Math.ceil(tablet.length / 2);

  const newButton = (key: string) => (
    <li key={key} className="flex items-center justify-center">
      {hasActions && (
        <button
          onClick={() => setQuickOpen(true)}
          aria-label="Create"
          aria-haspopup="dialog"
          className="group flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
        >
          <PlusIcon className="h-[18px] w-[18px] transition-transform duration-200 ease-out group-hover:rotate-90" />
        </button>
      )}
    </li>
  );

  const more = (withRef: boolean, scope: string) => (
    <li
      className="relative min-w-0"
      onMouseEnter={() => setHover(`${scope}-more`)}
      onMouseLeave={() => setHover(null)}
    >
      <HoverPill show={hover === `${scope}-more`} scope={scope} />
      <button
        ref={withRef ? moreRef : undefined}
        onClick={() => setMobileNavOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={mobileNavOpen}
        className="relative flex h-full w-full flex-col items-center justify-center gap-[3px] text-muted transition-colors duration-150 hover:text-ink"
      >
        <LayoutGridIcon className="h-[17px] w-[17px]" />
        <span className="text-[10px] font-medium leading-none">More</span>
      </button>
    </li>
  );

  const tab = (it: CountedEntry, scope: string) => (
    <Tab
      key={it.to}
      it={it}
      scope={scope}
      hovered={hover === `${scope}-${it.to}`}
      onHover={(on) => setHover(on ? `${scope}-${it.to}` : null)}
    />
  );

  return (
    <>
      <nav
        aria-label="Quick navigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/90 backdrop-blur-md lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="grid h-[52px] w-full grid-cols-5 items-stretch px-1.5 py-1 md:hidden">
          {phoneLeft.map((it) => tab(it, 'p'))}
          {newButton('pn')}
          {phoneRight.map((it) => tab(it, 'p'))}
          {more(true, 'p')}
        </ul>
        <ul
          className="mx-auto hidden h-[52px] w-full max-w-3xl items-stretch px-3 py-1 md:grid"
          style={{ gridTemplateColumns: `repeat(${tablet.length + 2}, minmax(0, 1fr))` }}
        >
          {tablet.slice(0, mid).map((it) => tab(it, 't'))}
          {newButton('tn')}
          {tablet.slice(mid).map((it) => tab(it, 't'))}
          {more(false, 't')}
        </ul>
      </nav>
      <MoreSheet
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        returnFocus={moreRef}
      />
      <QuickActions open={quickOpen} onClose={() => setQuickOpen(false)} />
    </>
  );
}

function HoverPill({ show, scope }: { show: boolean; scope: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          layoutId={`bottomnav-hover-${scope}`}
          className="absolute inset-x-1 inset-y-0 rounded-lg bg-sunken/70"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease }}
          aria-hidden
        />
      )}
    </AnimatePresence>
  );
}

function Tab({
  it,
  scope,
  hovered,
  onHover,
}: {
  it: CountedEntry;
  scope: string;
  hovered: boolean;
  onHover: (on: boolean) => void;
}) {
  return (
    <li
      className="relative min-w-0"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <HoverPill show={hovered} scope={scope} />
      <NavLink
        to={it.to}
        end={it.end}
        title={it.label}
        className="relative flex h-full flex-col items-center justify-center gap-[3px]"
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <motion.span
                layoutId={`bottomnav-active-${scope}`}
                className="absolute inset-x-1 inset-y-0 rounded-lg bg-ink/[0.06] ring-1 ring-inset ring-ink/10"
                transition={{ duration: 0.22, ease }}
                aria-hidden
              />
            )}
            <span
              className={`relative transition-[color,transform] duration-150 ease-out ${isActive ? '-translate-y-px text-ink' : 'text-muted'}`}
            >
              <it.icon className="h-[17px] w-[17px]" strokeWidth={isActive ? 2.25 : 2} />
              {it.count ? (
                <span
                  className={`absolute -right-2 -top-1.5 min-w-[14px] rounded-full px-[3px] text-center text-[9px] font-bold leading-[14px] text-white ring-2 ring-white ${it.alert ? 'bg-bad' : 'bg-ink'}`}
                >
                  {it.count > 99 ? '99+' : it.count}
                </span>
              ) : null}
            </span>
            <span
              className={`relative max-w-full truncate px-0.5 text-[10px] leading-none ${isActive ? 'font-semibold text-ink' : 'font-medium text-muted'}`}
            >
              {it.short}
            </span>
          </>
        )}
      </NavLink>
    </li>
  );
}
