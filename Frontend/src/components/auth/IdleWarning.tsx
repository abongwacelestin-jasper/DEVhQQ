import { AnimatePresence, motion } from 'framer-motion';
import { MoonIcon } from 'lucide-react';

/** Pre-lock warning shown in the last 30 seconds of inactivity. Any movement dismisses it. */
export function IdleWarning({
  seconds,
  onLockNow,
}: {
  seconds: number | null;
  onLockNow: () => void;
}) {
  return (
    <AnimatePresence>
      {seconds !== null && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          className="fixed bottom-20 left-1/2 z-[70] flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5 shadow-pop lg:bottom-6"
        >
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warn-soft text-warn">
            <MoonIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-ink">
              Locking in <span className="tabular-nums">{seconds}s</span>
            </p>
            <p className="text-[11.5px] text-muted">
              Move your mouse or press a key to stay signed in.
            </p>
          </div>
          <button
            onClick={onLockNow}
            className="h-7 shrink-0 rounded-md border border-line px-2.5 text-[12px] font-medium text-ink hover:bg-sunken"
          >
            Lock now
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
