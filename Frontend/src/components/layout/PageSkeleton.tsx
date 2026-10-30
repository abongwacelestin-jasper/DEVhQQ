import { Skeleton } from '../ui/Skeleton';

export type SkeletonVariant = 'dashboard' | 'table' | 'board' | 'detail';

function PanelSkeleton({ rows = 5, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`rounded-lg border border-line ${className}`}>
      <div className="flex h-10 items-center justify-between border-b border-line px-3.5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
            <Skeleton className="h-5 w-5 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className={`h-2.5 ${i % 3 === 0 ? 'w-3/4' : 'w-2/3'}`} />
              <Skeleton className={`h-2 ${i % 2 ? 'w-1/3' : 'w-1/2'}`} />
            </div>
            <Skeleton className="h-4 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-2.5 w-72 max-w-full" />
      </div>
      <Skeleton className="hidden h-8 w-32 rounded-md sm:block" />
    </div>
  );
}

export function PageSkeleton({ variant }: { variant: SkeletonVariant }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <span className="sr-only">Loading…</span>
      <Header />

      {variant === 'dashboard' && (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={`space-y-2 bg-surface px-3.5 py-3 ${i === 4 ? 'col-span-2 lg:col-span-1' : ''}`}
              >
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <PanelSkeleton rows={4} className="xl:col-span-2" />
            <PanelSkeleton rows={4} />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <PanelSkeleton rows={4} />
            <PanelSkeleton rows={4} />
            <PanelSkeleton rows={4} />
          </div>
        </>
      )}

      {variant === 'table' && (
        <>
          <div className="flex gap-2">
            {['w-16', 'w-20', 'w-24', 'w-[72px]'].map((w) => (
              <Skeleton key={w} className={`h-7 rounded-md ${w}`} />
            ))}
          </div>
          <PanelSkeleton rows={8} />
        </>
      )}

      {variant === 'board' && (
        <>
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[60px] w-48 shrink-0 rounded-lg" />
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, c) => (
              <div key={c} className="space-y-2 rounded-lg bg-sunken/60 p-2">
                <Skeleton className="h-3 w-20 bg-line" />
                {Array.from({ length: 3 - (c % 2) }).map((__, i) => (
                  <div key={i} className="space-y-2 rounded-md border border-line bg-surface p-2.5">
                    <Skeleton className="h-2 w-12" />
                    <Skeleton className="h-2.5 w-4/5" />
                    <div className="flex justify-between pt-1">
                      <Skeleton className="h-3 w-10" />
                      <Skeleton className="h-4 w-4 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {variant === 'detail' && (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-line p-3">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            ))}
          </div>
          <div className="space-y-4">
            <div className="space-y-2.5 rounded-lg border border-line p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
            <Skeleton className="h-56 w-full rounded-lg" />
          </div>
        </div>
      )}
    </div>
  );
}
