import { useEffect, useRef } from 'react';

const codeKeys: Record<string, string> = { Backquote: '`', Equal: '=', Minus: '-', Slash: '/' };

/**
 * Global IDE keyboard shortcuts, e.g. { 'mod+p': openQuick, 'mod+shift+f': showSearch, f5: run }.
 * Listens in the capture phase so shortcuts work while the editor has focus.
 */
export function useIdeShortcuts(map: Record<string, () => void>) {
  const ref = useRef(map);
  ref.current = map;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('mod');
      if (e.altKey) parts.push('alt');
      if (e.shiftKey) parts.push('shift');
      let key = codeKeys[e.code] ?? e.key.toLowerCase();
      if ((e.altKey || e.shiftKey) && e.code.startsWith('Key')) key = e.code.slice(3).toLowerCase();
      const fn = ref.current[[...parts, key].join('+')];
      if (!fn) return;
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
