import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Markdown-lite → React elements. Never produces HTML strings and never uses
 * `dangerouslySetInnerHTML`, so message text cannot become markup.
 *
 * Supported: `inline code`, **bold**, *italic* / _italic_, ~~strike~~,
 * @mentions, task keys (RB-12), incidents (INC-3), PR refs (#148),
 * bare URLs and [label](url) links. Links are http/https/mailto only and open
 * with `rel="noopener noreferrer"`.
 */

const SAFE_SCHEME = /^(https?:|mailto:)/i;

export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!SAFE_SCHEME.test(href)) return null;
  try {
    const u = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

// Order matters: code spans first so nothing inside them is formatted.
const TOKEN =
  /(`[^`\n]+`)|(\[[^\]\n]{1,200}\]\([^)\s]{1,2000}\))|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|((?:^|(?<=\s))[*_][^*_\n]+[*_](?=\s|$|[.,!?]))|(https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"])|(mailto:[^\s<>()]+)|(@[A-Za-z][\w.-]*)|(\b(?:RB|BL|MA)-\d+\b)|(\bINC-\d+\b)|((?:^|(?<=\s))#\d{2,4}\b)/g;

export interface RichTextOptions {
  /** Channel policy: when false, external links render as inert, struck-through text. */
  allowLinks?: boolean;
  /** Case-insensitive substring to highlight in plain text segments. */
  highlight?: string;
  /**
   * The server stores mentions as `@memberId`. Map of lower-cased member id →
   * display name; known ids render as `@Name`, unknown tokens render as plain text.
   */
  mentionable?: ReadonlyMap<string, string>;
}

function highlightText(text: string, needle: string | undefined, key: string): React.ReactNode {
  if (!needle || needle.length < 2) return text;
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const at = lower.indexOf(n, i);
    if (at < 0) break;
    if (at > i) out.push(text.slice(i, at));
    out.push(
      <mark key={`${key}-h${k++}`} className="rounded bg-warn-soft px-0.5 text-ink">
        {text.slice(at, at + n.length)}
      </mark>,
    );
    i = at + n.length;
  }
  if (!out.length) return text;
  out.push(text.slice(i));
  return out;
}

function link(href: string, label: string, key: string, allow: boolean) {
  const safe = safeHref(href);
  if (!safe) return <React.Fragment key={key}>{label}</React.Fragment>;
  if (!allow)
    return (
      <span
        key={key}
        className="text-muted line-through"
        title="External links are disabled in this channel"
      >
        {label}
      </span>
    );
  return (
    <a
      key={key}
      href={safe}
      target={safe.startsWith('mailto:') ? undefined : '_blank'}
      rel="noopener noreferrer"
      className="text-accent underline"
    >
      {label}
    </a>
  );
}

function renderLine(line: string, opts: RichTextOptions, lineKey: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const allow = opts.allowLinks ?? true;
  let last = 0;
  let n = 0;
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    const tok = m[0];
    const key = `${lineKey}-${n++}`;
    if (at > last) out.push(highlightText(line.slice(last, at), opts.highlight, `${key}p`));
    last = at + tok.length;
    if (m[1]) {
      out.push(
        <code key={key} className="rounded bg-sunken px-1 font-mono text-[12px] text-ink">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok) ?? [];
      out.push(link(href ?? '', label ?? tok, key, allow));
    } else if (m[3]) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (m[4]) {
      out.push(<s key={key}>{tok.slice(2, -2)}</s>);
    } else if (m[5]) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else if (m[6] || m[7]) {
      out.push(link(tok, tok, key, allow));
    } else if (m[8]) {
      const trail = /[.-]+$/.exec(tok)?.[0] ?? '';
      const handle = tok.slice(1, tok.length - trail.length).toLowerCase();
      const broadcast = handle === 'channel' || handle === 'everyone';
      const name = opts.mentionable?.get(handle);
      const known = broadcast || !opts.mentionable || !!name;
      out.push(
        known ? (
          <span
            key={key}
            className="rounded bg-accent-soft px-0.5 font-medium text-accent-ink"
            title={name ? tok : undefined}
          >
            {name ? `@${name}` : tok.slice(0, tok.length - trail.length)}
          </span>
        ) : (
          <React.Fragment key={key}>{tok}</React.Fragment>
        ),
      );
      if (known && trail) out.push(trail);
    } else if (m[9]) {
      out.push(
        <Link
          key={key}
          to={`/tasks/${tok}`}
          className="font-mono text-[12px] font-medium text-accent hover:underline"
        >
          {tok}
        </Link>,
      );
    } else if (m[10]) {
      out.push(
        <Link
          key={key}
          to={`/incidents/${tok}`}
          className="font-mono text-[12px] font-medium text-bad hover:underline"
        >
          {tok}
        </Link>,
      );
    } else if (m[11]) {
      out.push(
        <Link
          key={key}
          to={`/pull-requests/${tok.slice(1)}`}
          className="font-medium text-accent hover:underline"
        >
          {tok}
        </Link>,
      );
    }
  }
  if (last < line.length)
    out.push(highlightText(line.slice(last), opts.highlight, `${lineKey}-end`));
  return out;
}

/** Renders message text; preserves line breaks (the container uses `whitespace-pre-wrap`). */
export function RichText({ text, ...opts }: { text: string } & RichTextOptions) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          {i > 0 && '\n'}
          {renderLine(line, opts, `l${i}`)}
        </React.Fragment>
      ))}
    </>
  );
}
