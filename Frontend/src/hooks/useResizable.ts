import { useCallback, useState } from 'react';
import type React from 'react';

interface ResizableOptions {
  axis: 'x' | 'y';
  initial: number;
  min: number;
  max: number;
  /** Grow when dragging left/up — for panels anchored to the right or bottom. */
  invert?: boolean;
}

/** Drag-to-resize for IDE panes. Returns the size and a pointer handler for the splitter. */
export function useResizable({ axis, initial, min, max, invert = false }: ResizableOptions) {
  const [size, setSize] = useState(initial);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const start = axis === 'x' ? e.clientX : e.clientY;
      const startSize = size;
      const move = (ev: PointerEvent) => {
        const d = (axis === 'x' ? ev.clientX : ev.clientY) - start;
        setSize(Math.min(max, Math.max(min, startSize + (invert ? -d : d))));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [axis, size, min, max, invert],
  );

  return { size, setSize, onPointerDown };
}
