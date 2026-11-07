import { Link, useLocation } from 'react-router-dom';
import { CompassIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/** 404 for URLs no route matches. Keeps the URL so it can be reported or corrected. */
export function PageNotFound() {
  const { pathname } = useLocation();
  const { role } = useAuth();
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-lg border border-line bg-white px-5 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-muted">
        <CompassIcon className="h-5 w-5" />
      </span>
      <p className="font-mono text-[11.5px] font-semibold text-muted">404 · Not found</p>
      <h1 className="text-[18px] font-semibold tracking-tight text-ink">This page doesn’t exist</h1>
      <p className="text-[12.5px] text-muted">
        Nothing lives at{' '}
        <code className="rounded bg-sunken px-1 font-mono text-ink">{pathname}</code>. The link may
        be old or mistyped.
      </p>
      <Link
        to={role?.home ?? '/'}
        className="text-[12.5px] font-medium text-accent hover:underline"
      >
        Back to {role?.homeLabel ?? 'home'}
      </Link>
    </section>
  );
}
