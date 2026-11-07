import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, PaperclipIcon } from 'lucide-react';
import { toast } from 'sonner';
import { safeHref } from '../messaging/RichText';
import { fileUrl } from '../work/useFileUpload';
import { errorMessage, isUnavailable } from '../work/apiState';

/** Renders the lightweight doc markdown. Checkbox lines are interactive when onToggle is provided. */
export function DocRenderer({
  body,
  onToggle,
}: {
  body: string;
  onToggle?: (lineIndex: number) => void;
}) {
  const lines = body.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const idx = i;
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      out.push(
        <div key={idx} className="my-2 overflow-hidden rounded-md bg-[#0F1115]">
          {lang && (
            <p className="border-b border-[#ffffff1a] px-3 py-1 font-mono text-[10.5px] text-[#E5E7EB]/60">
              {lang}
            </p>
          )}
          <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed text-[#E5E7EB] scroll-thin">
            {code.join('\n')}
          </pre>
        </div>,
      );
      i++;
      continue;
    }
    if (line.startsWith('# '))
      out.push(
        <h1 key={idx} className="mb-2 mt-1 text-[20px] font-semibold tracking-tight text-ink">
          {inline(line.slice(2))}
        </h1>,
      );
    else if (line.startsWith('## '))
      out.push(
        <h2
          key={idx}
          id={slug(line.slice(3))}
          className="mb-1 mt-4 scroll-mt-20 text-[14.5px] font-semibold text-ink"
        >
          {inline(line.slice(3))}
        </h2>,
      );
    else if (line.startsWith('> '))
      out.push(
        <blockquote
          key={idx}
          className="my-2 border-l-[3px] border-accent bg-accent-soft/40 px-3 py-1.5 text-[13px] text-ink"
        >
          {inline(line.slice(2))}
        </blockquote>,
      );
    else if (/^- \[( |x)\] /.test(line)) {
      const done = line[3] === 'x';
      out.push(
        <label
          key={idx}
          className={`flex items-start gap-2 py-0.5 text-[13px] ${onToggle ? 'cursor-pointer' : ''}`}
        >
          <button
            type="button"
            disabled={!onToggle}
            onClick={() => onToggle?.(idx)}
            aria-pressed={done}
            aria-label={done ? 'Mark not done' : 'Mark done'}
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${done ? 'border-ok bg-ok text-white' : 'border-line-strong bg-white'}`}
          >
            {done && <CheckIcon className="h-3 w-3" />}
          </button>
          <span className={done ? 'text-muted line-through' : 'text-ink'}>
            {inline(line.slice(6))}
          </span>
        </label>,
      );
    } else if (line.startsWith('- '))
      out.push(
        <li key={idx} className="ml-5 list-disc py-0.5 text-[13px] text-ink">
          {inline(line.slice(2))}
        </li>,
      );
    else if (line.trim() === '') out.push(<div key={idx} className="h-1.5" />);
    else
      out.push(
        <p key={idx} className="py-0.5 text-[13px] leading-relaxed text-ink">
          {inline(line)}
        </p>,
      );
    i++;
  }
  return <div className="min-w-0">{out}</div>;
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** `[name](/api/files/<fileId>)` — an attachment stored through the STORAGE upload flow. */
export const ATTACHMENT_HREF = /^\/api\/files\/([A-Za-z0-9_-]{1,128})$/;

const INLINE =
  /(`[^`]+`|\[[^\]\n]{1,200}\]\([^)\s]{1,2000}\)|\*\*[^*\n]+\*\*|https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"]|\b(?:RB|BL|MA)-\d+\b)/g;

/** Inline markdown → React elements only (never HTML strings). Links are http/https/mailto. */
function inline(s: string) {
  return s.split(INLINE).map((p, i) => {
    if (!p) return null;
    if (/^`.+`$/.test(p))
      return (
        <code key={i} className="rounded bg-sunken px-1 font-mono text-[12px] text-ink">
          {p.slice(1, -1)}
        </code>
      );
    if (/^\*\*.+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    const md = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
    if (md) {
      const [, label, href] = md;
      const file = ATTACHMENT_HREF.exec(href);
      if (file) return <AttachmentLink key={i} fileId={file[1]} name={label} />;
      return <SafeLink key={i} href={href} label={label} />;
    }
    if (/^https?:\/\//.test(p)) return <SafeLink key={i} href={p} label={p} />;
    if (/^(RB|BL|MA)-\d+$/.test(p))
      return (
        <Link
          key={i}
          to={`/tasks/${p}`}
          className="font-mono text-[12px] font-medium text-accent hover:underline"
        >
          {p}
        </Link>
      );
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

function SafeLink({ href, label }: { href: string; label: string }) {
  const safe = safeHref(href);
  if (!safe) return <>{label}</>;
  return (
    <a
      href={safe}
      target={safe.startsWith('mailto:') ? undefined : '_blank'}
      rel="noopener noreferrer"
      className="text-accent underline"
    >
      {label}
    </a>
  );
}

/** Resolves a short-lived presigned URL on click, so stored links never go stale. */
function AttachmentLink({ fileId, name }: { fileId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const url = safeHref(new URL(await fileUrl(fileId), window.location.origin).href);
      if (!url) throw new Error('The storage service returned an unsafe link.');
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    } catch (e) {
      const missing = isUnavailable(e);
      toast.error(
        missing ? 'File storage is not configured on this server' : "Couldn't open the attachment",
        { description: missing ? undefined : errorMessage(e) },
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded border border-line bg-white px-1.5 py-px align-baseline text-[12px] font-medium text-accent hover:bg-sunken disabled:opacity-60"
    >
      <PaperclipIcon className="h-3 w-3" aria-hidden />
      {name}
    </button>
  );
}
