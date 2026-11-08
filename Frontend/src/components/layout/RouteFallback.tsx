import { useEffect, useState, type ReactNode } from 'react';

/**
 * Renders `children` only once `delay` ms have passed, then fades them in. A route
 * chunk that arrives quickly (the common case, and always after a prefetch) shows
 * nothing in between instead of flashing a skeleton for a frame.
 */
export function Deferred({ children, delay = 180 }: { children: ReactNode; delay?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), delay);
    return () => window.clearTimeout(t);
  }, [delay]);
  if (!show) return null;
  return (
    <div className="animate-[devhq-fade-in_160ms_ease-out] motion-reduce:animate-none">
      {children}
    </div>
  );
}

/** Full-screen routes (IDE, console, onboarding) while their chunk loads. */
export function RouteFallback() {
  return (
    <Deferred>
      <div
        role="status"
        aria-label="Loading"
        className="flex min-h-screen items-center justify-center bg-canvas"
      >
        <span className="sr-only">Loading…</span>
        <span
          aria-hidden
          className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent"
        />
      </div>
    </Deferred>
  );
}
