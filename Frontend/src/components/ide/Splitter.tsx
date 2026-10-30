import React from 'react';

/** Thin drag handle between IDE panes; highlights on hover like VS Code's sashes. */
export function Splitter({
  axis,
  onPointerDown,
  className = '',
}: {
  axis: 'x' | 'y';
  onPointerDown: (e: React.PointerEvent) => void;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      onPointerDown={onPointerDown}
      className={`relative z-10 shrink-0 bg-transparent transition-colors delay-100 duration-150 hover:bg-[var(--vs-accent)] ${axis === 'x' ? '-mx-[2px] w-[4px] cursor-col-resize' : '-my-[2px] h-[4px] cursor-row-resize'} ${className}`}
    />
  );
}
