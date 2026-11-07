import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { pathForStage, peekReturnTo } from '../utils/authRoutes';
import { prefetchPath } from './lazyPages';

/**
 * Prefetches a route's chunk when a same-origin link is hovered, focused or
 * touched: by the time the click lands the code is usually already there. One
 * delegated listener covers every <a> in the app (sidebar, menus, tables).
 */
export function useLinkPrefetch() {
  useEffect(() => {
    const onIntent = (e: Event) => {
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.origin !== window.location.origin || link.target === '_blank' || link.download)
        return;
      prefetchPath(link.pathname);
    };
    const passive = { passive: true, capture: true } as const;
    document.addEventListener('pointerover', onIntent, passive);
    document.addEventListener('touchstart', onIntent, passive);
    document.addEventListener('focusin', onIntent, true);
    return () => {
      document.removeEventListener('pointerover', onIntent, passive);
      document.removeEventListener('touchstart', onIntent, passive);
      document.removeEventListener('focusin', onIntent, true);
    };
  }, []);
}

/**
 * Prefetches where the session is headed next: the remembered deep link or the
 * role's home as soon as the role is known (during the second-factor step,
 * before the app shell renders), and the screen for the current onboarding stage.
 */
export function useLikelyRoutePrefetch() {
  const { role, stage, booting } = useAuth();
  const home = role?.home;
  useEffect(() => {
    if (booting) return;
    if (home) prefetchPath(peekReturnTo() ?? home);
    if (stage !== 'signed-out') prefetchPath(pathForStage(stage, role));
  }, [booting, home, stage, role]);
}
