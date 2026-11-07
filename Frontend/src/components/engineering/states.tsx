import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangleIcon,
  FlaskConicalIcon,
  GithubIcon,
  LockIcon,
  PlugZapIcon,
  RotateCwIcon,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { useAuth } from '../../contexts/AuthContext';
import { ConnectRepoIllustration } from './ConnectRepoIllustration';
import { fetchInstallUrl } from './data/hooks';
import { describeError, type LoadStatus } from './data/useApi';
import type { DataSource } from './data/types';

/**
 * Shared states for API-backed engineering pages. Every page renders one of
 * these instead of falling back to seed data, so "nothing here" and "not
 * connected" always look designed and say what to do next.
 */

/** Visible label for rows the server marks `source: 'demo'`. */
export function SampleDataBadge({
  source,
  className = '',
}: {
  source?: DataSource;
  className?: string;
}) {
  if (source !== 'demo') return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-warn/30 bg-warn-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-warn ${className}`}
      title="The server is returning labelled sample data because this integration isn't configured."
    >
      <FlaskConicalIcon className="h-3 w-3" aria-hidden />
      Sample data
    </span>
  );
}

export function LoadingRows({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2 p-3">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function Shell({
  icon,
  title,
  children,
  action,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'neutral' | 'bad';
}) {
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={`flex flex-col items-center rounded-lg border border-dashed px-4 py-10 text-center ${tone === 'bad' ? 'border-bad/30 bg-bad-soft/30' : 'border-line-strong bg-white'}`}
    >
      {icon}
      <h2 className="mt-3 text-[13.5px] font-semibold text-ink">{title}</h2>
      {children && (
        <div className="mt-1 max-w-md text-[12px] leading-relaxed text-muted">{children}</div>
      )}
      {action && <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** "Connect GitHub" call to action for GitHub-backed pages. */
export function ConnectGitHub({ what }: { what: string }) {
  const { canDo } = useAuth();
  const allowed = canDo('github:configure');
  const [busy, setBusy] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const hint = useId();

  const start = async () => {
    setBusy(true);
    const url = await fetchInstallUrl();
    setBusy(false);
    if (url && /^https:\/\//.test(url)) window.location.assign(url);
    else setUnreachable(true);
  };

  return (
    <Shell
      icon={<ConnectRepoIllustration />}
      title="Connect GitHub"
      action={
        <>
          <Button
            variant="primary"
            size="sm"
            icon={<GithubIcon className="h-3.5 w-3.5" />}
            onClick={start}
            disabled={!allowed || busy}
            aria-describedby={hint}
            title={allowed ? undefined : 'Needs Repository: manage — ask an Owner'}
          >
            {busy ? 'Opening GitHub…' : 'Connect GitHub'}
          </Button>
          <Link
            to="/integrations"
            className="inline-flex h-7 items-center rounded-md border border-line bg-white px-2.5 text-[12px] font-medium text-ink hover:border-line-strong"
          >
            View integrations
          </Link>
        </>
      }
    >
      <p id={hint}>
        {what} come from the DevHQ GitHub App. It isn’t configured on this server yet, so there is
        nothing to show — DevHQ doesn’t invent repository data.
        {!allowed && ' Ask an Owner (Repository: manage) to install it.'}
      </p>
      {unreachable && (
        <p className="mt-2 font-medium text-bad">
          The server couldn’t provide an install link. Set the GitHub App env vars (GITHUB_APP_ID,
          GITHUB_APP_PRIVATE_KEY) and restart the API.
        </p>
      )}
    </Shell>
  );
}

/**
 * Renders the non-ready states of a load. Returns `null` when `status` is
 * `ready`, so pages write `<DataState …/> ?? content` style branches.
 */
export function DataState({
  status,
  error,
  what,
  github = false,
  onRetry,
  rows,
}: {
  status: LoadStatus;
  error?: unknown;
  /** Plural noun for copy, e.g. "Pull requests". */
  what: string;
  /** GitHub-backed: unconfigured/unavailable shows the Connect GitHub CTA. */
  github?: boolean;
  onRetry?: () => void;
  rows?: number;
}) {
  switch (status) {
    case 'ready':
      return null;
    case 'loading':
      return <LoadingRows rows={rows} label={`Loading ${what.toLowerCase()}`} />;
    case 'unconfigured':
      if (github) return <ConnectGitHub what={what} />;
      return (
        <Shell
          icon={<PlugZapIcon className="h-8 w-8 text-subtle" aria-hidden />}
          title="Not configured"
        >
          {what} need an integration that isn’t configured on this server.
        </Shell>
      );
    case 'unavailable':
      if (github) return <ConnectGitHub what={what} />;
      return (
        <Shell
          icon={<PlugZapIcon className="h-8 w-8 text-subtle" aria-hidden />}
          title={`${what} aren’t available yet`}
          action={
            onRetry && (
              <Button size="sm" icon={<RotateCwIcon className="h-3.5 w-3.5" />} onClick={onRetry}>
                Try again
              </Button>
            )
          }
        >
          This server doesn’t provide {what.toLowerCase()} yet. Nothing is shown rather than sample
          numbers.
        </Shell>
      );
    case 'forbidden':
      return (
        <Shell icon={<LockIcon className="h-8 w-8 text-subtle" aria-hidden />} title="No access">
          Your role can’t view {what.toLowerCase()}. {error ? describeError(error) : ''}
        </Shell>
      );
    case 'not-found':
      return (
        <Shell
          icon={<AlertTriangleIcon className="h-8 w-8 text-subtle" aria-hidden />}
          title="Not found"
        >
          It may have been removed, or you don’t have access to its product.
        </Shell>
      );
    case 'error':
    default:
      return (
        <Shell
          tone="bad"
          icon={<AlertTriangleIcon className="h-8 w-8 text-bad" aria-hidden />}
          title={`Couldn’t load ${what.toLowerCase()}`}
          action={
            onRetry && (
              <Button size="sm" icon={<RotateCwIcon className="h-3.5 w-3.5" />} onClick={onRetry}>
                Try again
              </Button>
            )
          }
        >
          {error ? describeError(error) : 'The API did not respond.'}
        </Shell>
      );
  }
}

/** Inline error under a form or action (403s, 422s). */
export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="mt-2 flex items-start gap-1.5 rounded-md bg-bad-soft px-2.5 py-1.5 text-[12px] text-bad"
    >
      <AlertTriangleIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{describeError(error)}</span>
    </p>
  );
}

/**
 * A button the member may not be allowed to press. Disabled (not hidden) with
 * the reason as tooltip and screen-reader description, so the action is
 * discoverable and the reason is honest.
 */
export function GuardedButton({
  allowed,
  reason,
  ...rest
}: React.ComponentProps<typeof Button> & { allowed: boolean; reason: string }) {
  const id = useId();
  return (
    <>
      <Button
        {...rest}
        disabled={!allowed || rest.disabled}
        title={allowed ? rest.title : reason}
        aria-describedby={allowed ? rest['aria-describedby'] : id}
      />
      {!allowed && (
        <span id={id} className="sr-only">
          {reason}
        </span>
      )}
    </>
  );
}

/** "Load more" footer for cursor-paginated lists. */
export function LoadMore({
  hasMore,
  loading,
  onClick,
}: {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center border-t border-line p-2">
      <Button size="sm" onClick={onClick} disabled={loading}>
        {loading ? 'Loading…' : 'Load more'}
      </Button>
    </div>
  );
}
