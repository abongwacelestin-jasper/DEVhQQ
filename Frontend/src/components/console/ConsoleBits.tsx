import React, { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { statusText, statusTone } from '../../utils/consoleClient';
import type { HttpMethod } from '../../types/console';

const METHOD_TONE: Record<string, string> = {
  GET: 'text-ok',
  POST: 'text-info',
  PATCH: 'text-warn',
  PUT: 'text-warn',
  DELETE: 'text-bad',
};

export function MethodTag({
  method,
  className = '',
}: {
  method: HttpMethod | string;
  className?: string;
}) {
  return (
    <span
      className={`inline-block w-[46px] shrink-0 font-mono text-[10.5px] font-semibold ${METHOD_TONE[method] ?? 'text-muted'} ${className}`}
    >
      {method}
    </span>
  );
}

const TONE: Record<string, string> = {
  ok: 'bg-ok-soft text-ok',
  info: 'bg-info-soft text-info',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  muted: 'bg-sunken text-muted',
};

export function StatusCode({ status, withText = false }: { status: number; withText?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-px font-mono text-[10.5px] font-semibold tabular-nums ${TONE[statusTone(status)]}`}
    >
      {status || 'ERR'}
      {withText && <span className="font-sans font-medium">{statusText[status] ?? ''}</span>}
    </span>
  );
}

export function Pill({
  tone = 'muted',
  children,
}: {
  tone?: keyof typeof TONE;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-px text-[10.5px] font-medium ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function CopyButton({
  text,
  label = 'Copy',
  className = '',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch {
      toast.error('Clipboard unavailable', {
        description: 'Select the text and copy it manually.',
      });
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[11.5px] font-medium text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink ${className}`}
    >
      {done ? <CheckIcon className="h-3.5 w-3.5 text-ok" /> : <CopyIcon className="h-3.5 w-3.5" />}
      {done ? 'Copied' : label}
    </button>
  );
}

export function Card({
  title,
  actions,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-[40px] flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
          {title && <h2 className="text-[12.5px] font-semibold text-ink">{title}</h2>}
          {actions && <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-[12px] text-muted">{children}</div>;
}

export function ago(isoOrMs: string | number): string {
  const ms = Date.now() - (typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime());
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const fmtMs = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;
export const fmtBytes = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
