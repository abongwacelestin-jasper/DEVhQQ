/**
 * The one shared email layout. Every template describes its content as a list
 * of blocks; this module renders the same blocks twice, as HTML and as plain
 * text, so the two parts can never drift apart.
 *
 * HTML rules (what keeps it working in Gmail, Outlook for Windows/Mac/web,
 * Apple Mail and iOS Mail):
 *  - table layout, 600 px container, every style inline; the only <style>
 *    block holds progressive enhancements (dark mode, small screens) that
 *    clients without <style> support simply ignore;
 *  - Windows Outlook (Word engine) gets an MSO-conditional fixed-width table
 *    and VML buttons, and a font fallback;
 *  - `color-scheme: light dark` plus dark overrides for every tinted surface
 *    (pills, panels, notices); the logo sits on a white chip so a dark logo
 *    stays visible when the client renders dark mode;
 *  - a hidden preheader followed by filler so the inbox preview shows the
 *    preheader, not footer text;
 *  - no external CSS, no script. Images: the logo, one hero illustration per
 *    non-security email and small product marks, each with explicit width
 *    and height, alt text and a fallback background colour, so the email
 *    reads fully with images blocked. Security notices carry no image but
 *    the logo: their shield is drawn in HTML (docs/operations/brand.md).
 *
 * Safety: every interpolated value passes through `escapeHtml` (names, task
 * and incident titles are user-controlled). Links and image URLs must be
 * absolute http(s) (links may also be mailto); anything else is a programming
 * error and throws, so a relative or `javascript:` URL can never reach a
 * recipient.
 */

import type { Brand } from '../config/mail.ts';
import { HEROES, HERO_SIZE, MARKED_PRODUCTS, MARK_SIZE, assetUrl, type HeroId } from './assets.ts';
import { firstName, type ProductRef } from './labels.ts';
import type { MailCategory } from './transport.ts';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Colour family of a pill, badge or icon tile (matches the app's tones). */
export type Tone = 'neutral' | 'info' | 'accent' | 'ok' | 'warn' | 'bad';

/** Inline text: plain string, bold run, link, status pill, product (mark + name) or code. */
export type Inline =
  | string
  | { strong: string }
  | { href: string; text: string }
  | { pill: string; tone: Tone }
  | { product: ProductRef }
  | { code: string };

export type Rich = Inline[] | string;

export interface ListItem {
  title: string;
  href?: string;
  body?: string;
  meta?: string;
}

export type Block =
  | { t: 'p'; text: Rich }
  /**
   * `showUrl` prints the link under the button for clients that block buttons
   * (token links); `secondary` adds a quieter text link under the button.
   */
  | {
      t: 'button';
      href: string;
      label: string;
      showUrl?: boolean;
      secondary?: { href: string; text: string };
    }
  | { t: 'facts'; rows: [label: string, value: Rich][] }
  /** The item an email is about (a task, an incident, a deployment): meta line, title, pills, facts. */
  | {
      t: 'card';
      meta?: Inline[];
      title: string;
      href?: string;
      pills?: { label: string; tone: Tone }[];
      rows?: [label: string, value: Rich][];
    }
  | { t: 'notice'; tone?: 'info' | 'warning'; title?: string; text: Rich }
  /** A list; with `heading` it is one titled group (icon tile, title, count). */
  | {
      t: 'list';
      heading?: { title: string; glyph: string; tone: Tone; count?: number };
      items: ListItem[];
    }
  | { t: 'muted'; text: Rich };

export interface EmailContent {
  category: MailCategory;
  subject: string;
  /** Inbox preview line (about 40 to 110 characters). */
  preheader: string;
  /** Small label above the heading that tells the email types apart ("Task", "Incident"). */
  eyebrow?: { label: string; tone?: Tone | 'brand'; glyph?: string };
  heading: string;
  /** Recipient's name; the greeting uses the first name ("Hi Kofi,"). Omitted → no greeting. */
  greeting?: string;
  /** Header illustration; never on security notices. */
  hero?: HeroId;
  /** Workspace name shown in the header next to the logo. */
  workspace?: string;
  blocks: Block[];
  /** Footer line: why the recipient got this email. */
  reason: string;
  /** Security notices cannot be turned off; others link to the notification settings. */
  kind: 'security' | 'account' | 'notification';
  /**
   * The recipient cannot sign in (an invitee, a member whose access ended):
   * the footer leaves out the in-app links and keeps Help.
   */
  noAccess?: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  category: MailCategory;
}

/** In-app path where members choose which notifications they receive. */
export const NOTIFICATION_SETTINGS_PATH = '/onboarding/profile';

export function safeHref(href: string): string {
  if (/^mailto:[^\s<>"]+$/i.test(href)) return href;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    throw new Error(`email link must be absolute: ${href.slice(0, 80)}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    throw new Error(`email link must be http(s): ${u.protocol}`);
  return u.toString();
}

/** Image sources: absolute http(s) only (no mailto, data: or relative). */
function safeSrc(src: string): string {
  if (/^mailto:/i.test(src)) throw new Error('email image must be http(s)');
  return safeHref(src);
}

/** Joins the app base URL and an in-app path (always absolute). */
export function appLink(brand: Brand, path: string): string {
  return safeHref(`${brand.appUrl}${path.startsWith('/') ? path : `/${path}`}`);
}

// ─── colours ─────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Blends `a` toward `b` by `t` (0..1); used to lift link colours for dark mode. */
export function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => Number.parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) =>
      Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** White or near-black text, whichever contrasts better with `bg`. */
export function onColor(bg: string): string {
  const l = luminance(bg);
  return 1.05 / (l + 0.05) >= (l + 0.05) / (luminance('#111827') + 0.05) ? '#ffffff' : '#111827';
}

/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const C = {
  page: '#f4f4f6',
  card: '#ffffff',
  border: '#e7e7ea',
  divider: '#efeff2',
  ink: '#111827',
  body: '#374151',
  muted: '#6b7280',
  soft: '#f9fafb',
};

/** Light and dark pairs for every tone; each pair keeps at least 4.5:1 text contrast. */
export const TONES: Record<Tone, { bg: string; fg: string; darkBg: string; darkFg: string }> = {
  neutral: { bg: '#f1f2f4', fg: '#374151', darkBg: '#252b36', darkFg: '#d1d5db' },
  info: { bg: '#e0f2fe', fg: '#075985', darkBg: '#0c2a3f', darkFg: '#7dd3fc' },
  accent: { bg: '#ede9fe', fg: '#5b21b6', darkBg: '#2a1a4f', darkFg: '#c4b5fd' },
  ok: { bg: '#dcfce7', fg: '#166534', darkBg: '#0f2e1c', darkFg: '#86efac' },
  warn: { bg: '#fef3c7', fg: '#92400e', darkBg: '#3a2a07', darkFg: '#fcd34d' },
  bad: { bg: '#fee2e2', fg: '#991b1b', darkBg: '#3b1414', darkFg: '#fca5a5' },
};

const DARK = {
  page: '#0b0f17',
  card: '#121826',
  panel: '#171e2c',
  border: '#232b3a',
  ink: '#f3f4f6',
  body: '#d1d5db',
  muted: '#9ca3af',
};

const FONT =
  "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO = "SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

// ─── HTML ────────────────────────────────────────────────────────────────

function pillHtml(label: string, tone: Tone): string {
  const t = TONES[tone];
  return `<span class="pill pill-${tone}" style="display:inline-block;padding:2px 9px;border-radius:999px;background-color:${t.bg};color:${t.fg};font-family:${FONT};font-size:12px;line-height:18px;font-weight:600;white-space:nowrap;mso-line-height-rule:exactly">${escapeHtml(label)}</span>`;
}

function markHtml(p: ProductRef, brand: Brand): string {
  if (!p.id || !(MARKED_PRODUCTS as readonly string[]).includes(p.id)) return '';
  const src = escapeHtml(assetUrl(brand, `email/mark-${p.id}.png`));
  // Decorative (the name follows), so alt="" keeps blocked-image clients from repeating it.
  return `<img src="${src}" width="${MARK_SIZE}" height="${MARK_SIZE}" alt="" class="mark" style="display:inline-block;width:${MARK_SIZE}px;height:${MARK_SIZE}px;border:0;border-radius:6px;vertical-align:middle;background-color:${C.soft};margin:0 6px 0 0">`;
}

function inlineHtml(content: Rich, brand: Brand): string {
  const parts = typeof content === 'string' ? [content] : content;
  return parts
    .map((p) => {
      if (typeof p === 'string') return escapeHtml(p);
      if ('strong' in p)
        return `<strong class="ink" style="color:${C.ink};font-weight:600">${escapeHtml(p.strong)}</strong>`;
      if ('pill' in p) return pillHtml(p.pill, p.tone);
      if ('product' in p)
        return `<span style="white-space:nowrap">${markHtml(p.product, brand)}<span style="vertical-align:middle">${escapeHtml(p.product.name)}</span></span>`;
      if ('code' in p)
        return `<span class="code" style="font-family:${MONO};font-size:13px;line-height:18px;padding:1px 6px;border-radius:5px;background-color:#f1f2f4;color:${C.ink};white-space:nowrap">${escapeHtml(p.code)}</span>`;
      return `<a href="${escapeHtml(safeHref(p.href))}" target="_blank" class="lnk" style="color:${brand.accentColor};text-decoration:underline">${escapeHtml(p.text)}</a>`;
    })
    .join('');
}

const P = `margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.body}`;

function buttonHtml(href: string, label: string, brand: Brand): string {
  const url = escapeHtml(safeHref(href));
  const text = escapeHtml(label);
  const fg = onColor(brand.primaryColor);
  const bg = brand.primaryColor;
  const width = Math.min(520, Math.max(180, label.length * 9 + 48));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0">
<tr><td align="center" bgcolor="${bg}" style="border-radius:8px;background-color:${bg}">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:44px;v-text-anchor:middle;width:${width}px" arcsize="18%" stroke="f" fillcolor="${bg}"><w:anchorlock/><center style="color:${fg};font-family:Arial,sans-serif;font-size:15px;font-weight:bold">${text}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${url}" target="_blank" class="btn" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;color:${fg};text-decoration:none;border-radius:8px;background-color:${bg};border:1px solid ${bg}">${text}</a><!--<![endif]-->
</td></tr></table>`;
}

/** Label/value rows inside a panel. */
function rowsHtml(rows: [string, Rich][], brand: Brand, firstBorder: boolean): string {
  return rows
    .map(([k, v], i) => {
      const top = i || firstBorder ? `border-top:1px solid ${C.divider};` : '';
      return `<tr><td class="muted rule" valign="top" style="padding:10px 0 10px 18px;${top}font-family:${FONT};font-size:13px;line-height:24px;color:${C.muted};width:32%">${escapeHtml(k)}</td><td class="text rule" valign="top" style="padding:10px 18px 10px 8px;${top}font-family:${FONT};font-size:14px;line-height:24px;color:${C.ink};word-break:break-word">${inlineHtml(v, brand)}</td></tr>`;
    })
    .join('\n');
}

const PANEL = `margin:0 0 24px;border:1px solid ${C.border};border-radius:12px;border-collapse:separate;background-color:${C.card}`;

function tileHtml(glyph: string, tone: Tone, size: number, shield = false): string {
  const t = TONES[tone];
  const radius = shield
    ? `${Math.round(size / 4)}px ${Math.round(size / 4)}px ${Math.round(size / 2)}px ${Math.round(size / 2)}px`
    : `${Math.round(size / 4)}px`;
  return `<td class="tile-${tone}" width="${size}" height="${size}" align="center" valign="middle" bgcolor="${t.bg}" style="width:${size}px;height:${size}px;border-radius:${radius};background-color:${t.bg};color:${t.fg};font-family:${FONT};font-size:${Math.round(size * 0.45)}px;line-height:${size}px;font-weight:700;text-align:center;mso-line-height-rule:exactly">${escapeHtml(glyph)}</td>`;
}

function blockHtml(b: Block, brand: Brand): string {
  switch (b.t) {
    case 'p':
      return `<p class="text" style="${P}">${inlineHtml(b.text, brand)}</p>`;
    case 'muted':
      return `<p class="muted" style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted}">${inlineHtml(b.text, brand)}</p>`;
    case 'button': {
      const after: string[] = [];
      if (b.secondary)
        after.push(
          `<p class="muted" style="margin:14px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted}">or <a href="${escapeHtml(safeHref(b.secondary.href))}" target="_blank" class="lnk" style="color:${brand.accentColor};text-decoration:underline;font-weight:500">${escapeHtml(b.secondary.text)}</a></p>`,
        );
      if (b.showUrl)
        after.push(
          `<p class="muted" style="margin:14px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};word-break:break-all">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(safeHref(b.href))}" target="_blank" class="lnk" style="color:${brand.accentColor};text-decoration:underline">${escapeHtml(safeHref(b.href))}</a></p>`,
        );
      return `<div style="margin:0 0 28px">${buttonHtml(b.href, b.label, brand)}${after.join('')}</div>`;
    }
    case 'facts':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" style="${PANEL}">
${rowsHtml(b.rows, brand, false)}
</table>`;
    case 'card': {
      const title = b.href
        ? `<a href="${escapeHtml(safeHref(b.href))}" target="_blank" class="ink" style="color:${C.ink};text-decoration:none">${escapeHtml(b.title)}</a>`
        : escapeHtml(b.title);
      const meta = b.meta?.length
        ? `<div class="muted" style="margin:0 0 6px;font-family:${FONT};font-size:13px;line-height:24px;color:${C.muted}">${inlineHtml(b.meta, brand)}</div>`
        : '';
      const pills = b.pills?.length
        ? `<div style="margin:10px 0 0;line-height:26px">${b.pills.map((p) => pillHtml(p.label, p.tone)).join('&nbsp; ')}</div>`
        : '';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" style="${PANEL}">
<tr><td class="text" style="padding:16px 18px 16px;font-family:${FONT}">${meta}<div class="ink" style="font-family:${FONT};font-size:17px;line-height:24px;font-weight:600;letter-spacing:-0.1px;color:${C.ink}">${title}</div>${pills}</td></tr>
${b.rows?.length ? `<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml(b.rows, brand, true)}</table></td></tr>` : ''}
</table>`;
    }
    case 'notice': {
      const warn = b.tone === 'warning';
      const t = TONES[warn ? 'warn' : 'accent'];
      const bg = warn ? '#fffbeb' : '#f5f3ff';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border-collapse:separate">
<tr><td class="notice notice-${warn ? 'warn' : 'info'}" bgcolor="${bg}" style="padding:14px 16px;background-color:${bg};border:1px solid ${warn ? '#fde68a' : '#ddd6fe'};border-radius:10px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.body}">${b.title ? `<strong class="notice-title" style="display:block;margin-bottom:4px;color:${t.fg};font-weight:600">${escapeHtml(b.title)}</strong>` : ''}<span class="text">${inlineHtml(b.text, brand)}</span></td></tr></table>`;
    }
    case 'list': {
      const head = b.heading
        ? `<tr><td style="padding:0 0 4px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${tileHtml(b.heading.glyph, b.heading.tone, 28)}<td class="ink" style="padding:0 0 0 12px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:${C.ink}">${escapeHtml(b.heading.title)}${b.heading.count !== undefined ? `&nbsp;&nbsp;${pillHtml(String(b.heading.count), 'neutral')}` : ''}</td></tr></table></td></tr>`
        : '';
      const indent = b.heading ? 40 : 0;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
${head}${b.items
        .map(
          (it, i) =>
            `<tr><td class="rule" style="padding:12px 0 12px ${indent}px;${i || b.heading ? `border-top:1px solid ${C.divider};` : ''}font-family:${FONT}">${
              it.href
                ? `<a href="${escapeHtml(safeHref(it.href))}" target="_blank" class="ink" style="font-size:14px;line-height:21px;font-weight:600;color:${C.ink};text-decoration:none">${escapeHtml(it.title)}</a>`
                : `<span class="ink" style="font-size:14px;line-height:21px;font-weight:600;color:${C.ink}">${escapeHtml(it.title)}</span>`
            }${it.body ? `<div class="text" style="margin-top:2px;font-size:14px;line-height:21px;color:${C.body}">${escapeHtml(it.body)}</div>` : ''}${it.meta ? `<div class="muted" style="margin-top:4px;font-size:12px;line-height:18px;color:${C.muted}">${escapeHtml(it.meta)}</div>` : ''}</td></tr>`,
        )
        .join('\n')}
</table>`;
    }
  }
}

function logoHtml(brand: Brand): string {
  const home = escapeHtml(safeHref(brand.websiteUrl));
  const inner = brand.logoUrl
    ? `<img src="${escapeHtml(safeSrc(brand.logoUrl))}" width="${brand.logoWidth}" alt="${escapeHtml(brand.name)}" style="display:block;width:${brand.logoWidth}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;font-family:${FONT};font-size:18px;line-height:24px;font-weight:700;color:${C.ink}">`
    : `<span style="font-family:${FONT};font-size:18px;line-height:24px;font-weight:700;letter-spacing:-0.2px;color:${C.ink}"><span style="color:${brand.primaryColor}">&#9632;</span>&nbsp;${escapeHtml(brand.name)}</span>`;
  // White chip: invisible on the white card, keeps a dark logo legible in dark mode.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:8px;padding:6px 8px"><a href="${home}" target="_blank" style="text-decoration:none">${inner}</a></td></tr></table>`;
}

function headerHtml(c: EmailContent, brand: Brand): string {
  const ws = c.workspace
    ? `<td align="right" valign="middle" class="muted" style="font-family:${FONT};font-size:13px;line-height:18px;font-weight:500;color:${C.muted}">${escapeHtml(c.workspace)}</td>`
    : '';
  return `<tr><td class="px hdr" style="padding:24px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">${logoHtml(brand)}</td>${ws}</tr></table>
</td></tr>`;
}

function heroHtml(c: EmailContent, brand: Brand): string {
  if (!c.hero) return '';
  const h = HEROES[c.hero];
  const src = escapeHtml(assetUrl(brand, `email/${h.file}`));
  const { width, height } = HERO_SIZE;
  return `<tr><td class="px" style="padding:24px 40px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${h.bg}" style="background-color:${h.bg};border-radius:12px">
<img class="hero" src="${src}" width="${width}" height="${height}" alt="${escapeHtml(h.alt)}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;border-radius:12px;background-color:${h.bg};font-family:${FONT};font-size:13px;line-height:20px;color:${C.body}">
</td></tr></table>
</td></tr>`;
}

function eyebrowHtml(c: EmailContent, brand: Brand): string {
  if (!c.eyebrow) return '';
  const e = c.eyebrow;
  const tone = e.tone ?? 'brand';
  const fg = tone === 'brand' ? brand.accentColor : TONES[tone].fg;
  const dot = tone === 'brand' ? brand.primaryColor : TONES[tone].fg;
  const label = `<span class="eyebrow eyebrow-${tone}" style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${fg}">${escapeHtml(e.label)}</span>`;
  if (e.glyph) {
    // Security notices: a shield-shaped tile drawn in HTML, never an image.
    const t = tone === 'brand' ? 'accent' : tone;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr>${tileHtml(e.glyph, t, 40, true)}<td style="padding:0 0 0 14px" valign="middle">${label}</td></tr></table>`;
  }
  return `<p style="margin:0 0 12px;line-height:16px"><span class="dot dot-${tone}" style="color:${dot};font-size:10px;line-height:16px;vertical-align:1px">&#9679;</span>&nbsp;&nbsp;${label}</p>`;
}

function footerNav(c: EmailContent, brand: Brand): [string, string][] {
  const nav: [string, string][] = [];
  if (!c.noAccess) nav.push([`Open ${brand.name}`, safeHref(brand.appUrl)]);
  nav.push(['Help', `mailto:${brand.supportEmail}`]);
  if (c.kind !== 'security' && !c.noAccess)
    nav.push(['Notification settings', appLink(brand, NOTIFICATION_SETTINGS_PATH)]);
  return nav;
}

function footerLines(c: EmailContent): string[] {
  return [
    c.reason,
    c.kind === 'security'
      ? 'Security notices are sent for every sign-in and credential change and cannot be turned off.'
      : '',
  ].filter(Boolean);
}

function footerHtml(c: EmailContent, brand: Brand): string {
  const fs = `font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}`;
  const link = (href: string, text: string, strong = false) =>
    `<a href="${escapeHtml(safeHref(href))}" target="_blank" class="muted" style="color:${C.muted};text-decoration:${strong ? 'none' : 'underline'};${strong ? `font-weight:600;color:${C.body}` : ''}">${escapeHtml(text)}</a>`;
  const nav = footerNav(c, brand)
    .map(([t, h]) => link(h, t, true))
    .join(`<span class="muted" style="color:#c3c6cc">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>`);
  const legal = [
    escapeHtml(brand.legalName),
    brand.postalAddress ? escapeHtml(brand.postalAddress) : '',
  ]
    .filter(Boolean)
    .join(' &middot; ');
  return `<tr><td class="px" style="padding:28px 40px 8px">
<p class="muted nav" style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.body}">${nav}</p>
${footerLines(c)
  .map((l) => `<p class="muted" style="margin:0 0 8px;${fs}">${escapeHtml(l)}</p>`)
  .join('\n')}
<p class="muted" style="margin:0 0 8px;${fs}">Questions? Contact ${link(`mailto:${brand.supportEmail}`, brand.supportEmail)}.</p>
<p class="muted" style="margin:16px 0 0;${fs}">${legal}<br>${link(brand.websiteUrl, new URL(brand.websiteUrl).host)}</p>
</td></tr>`;
}

function darkCss(brand: Brand, prefix: string, bgPrefix: string): string {
  const lnk = mix(brand.accentColor, '#ffffff', 0.55);
  const tones = (Object.keys(TONES) as Tone[])
    .map((t) => {
      const v = TONES[t];
      return `${bgPrefix}.pill-${t},${bgPrefix}.tile-${t}{background-color:${v.darkBg}!important}
${prefix}.pill-${t},${prefix}.tile-${t},${prefix}.eyebrow-${t},${prefix}.dot-${t}{color:${v.darkFg}!important}`;
    })
    .join('\n');
  return `${bgPrefix}.bg{background-color:${DARK.page}!important}
${bgPrefix}.card,${bgPrefix}.panel{background-color:${DARK.card}!important;border-color:${DARK.border}!important}
${bgPrefix}.code{background-color:${DARK.panel}!important}
${bgPrefix}.notice-warn{background-color:#2a2108!important;border-color:#4a3a10!important}
${bgPrefix}.notice-info{background-color:#1d1838!important;border-color:#352c63!important}
${prefix}.text,${prefix}.text strong,${prefix}h1.text{color:${DARK.body}!important}
${prefix}.ink,${prefix}h1.ink,${prefix}.code{color:${DARK.ink}!important}
${prefix}.muted{color:${DARK.muted}!important}
${prefix}.nav a{color:${DARK.body}!important}
${prefix}.notice-warn .notice-title{color:${TONES.warn.darkFg}!important}
${prefix}.notice-info .notice-title{color:${TONES.accent.darkFg}!important}
${prefix}.lnk,${prefix}.eyebrow-brand{color:${lnk}!important}
${bgPrefix}.rule,${bgPrefix}.panel td{border-color:${DARK.border}!important}
${tones}`;
}

function html(c: EmailContent, brand: Brand): string {
  const preheader = escapeHtml(c.preheader);
  // Filler after the preheader so clients do not pull body text into the preview.
  const filler = '&#847;&zwnj;&nbsp;'.repeat(60);
  const greeting = c.greeting
    ? `<p class="text" style="${P}">Hi ${escapeHtml(firstName(c.greeting))},</p>`
    : '';
  const media = darkCss(brand, '', '');
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(c.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<!--[if mso]><style>table,td,p,a,span,div,h1{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}
img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}
@media screen and (max-width:620px){
.container{width:100%!important;max-width:100%!important}
.px{padding-left:24px!important;padding-right:24px!important}
.hdr{padding-left:16px!important;padding-right:24px!important}
.h1{font-size:22px!important;line-height:30px!important}
.btn{display:block!important;text-align:center!important}
}
@media (prefers-color-scheme:dark){
${media}
}
${darkCss(brand, '[data-ogsc] ', '[data-ogsb] ')}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background-color:${C.page};word-spacing:normal">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${C.page}">${preheader}${filler}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="${C.page}" style="background-color:${C.page}">
<tr><td align="center" style="padding:40px 12px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
<tr><td class="card" bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.border};border-radius:16px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${headerHtml(c, brand)}
${heroHtml(c, brand)}
<tr><td class="px" style="padding:${c.hero ? 32 : 28}px 40px 12px">
${eyebrowHtml(c, brand)}
<h1 class="ink h1" style="margin:0 0 20px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.4px;color:${C.ink}">${escapeHtml(c.heading)}</h1>
${greeting}
${c.blocks.map((b) => blockHtml(b, brand)).join('\n')}
</td></tr>
</table>
</td></tr>
${footerHtml(c, brand)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

// ─── plain text ──────────────────────────────────────────────────────────

function inlineText(content: Rich): string {
  const parts = typeof content === 'string' ? [content] : content;
  return parts
    .map((p) => {
      if (typeof p === 'string') return p;
      if ('strong' in p) return p.strong;
      if ('pill' in p) return p.pill;
      if ('product' in p) return p.product.name;
      if ('code' in p) return p.code;
      return `mailto:${p.text}` === p.href ? p.text : `${p.text} (${safeHref(p.href)})`;
    })
    .join('');
}

/** Greedy word wrap at 76 columns; long tokens (URLs) are never split. */
export function wrap(s: string, width = 76, indent = ''): string {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      if (line && (indent + line + ' ' + word).length > width) {
        out.push(indent + line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(indent + line);
  }
  return out.join('\n');
}

function rowsText(rows: [string, Rich][]): string {
  const w = Math.max(...rows.map(([k]) => k.length)) + 1;
  return rows.map(([k, v]) => `${`${k}:`.padEnd(w + 1)}${inlineText(v)}`).join('\n');
}

function itemsText(items: ListItem[]): string {
  return items
    .map((it) =>
      [
        `- ${it.title}`,
        it.body ? wrap(it.body, 76, '  ') : '',
        it.meta ? `  ${it.meta}` : '',
        it.href ? `  ${safeHref(it.href)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

function blockText(b: Block): string {
  switch (b.t) {
    case 'p':
    case 'muted':
      return wrap(inlineText(b.text));
    case 'button':
      return [
        `${b.label}:\n${safeHref(b.href)}`,
        b.secondary ? `\n${b.secondary.text}:\n${safeHref(b.secondary.href)}` : '',
      ].join('');
    case 'facts':
      return rowsText(b.rows);
    case 'card':
      return [
        b.meta?.length ? inlineText(b.meta) : '',
        wrap(b.title),
        b.pills?.length ? b.pills.map((p) => p.label).join(' · ') : '',
        b.rows?.length ? `\n${rowsText(b.rows)}` : '',
        // The card link is the same as the button below it, so the text part prints it once.
      ]
        .filter(Boolean)
        .join('\n');
    case 'notice':
      return [b.title ? `| ${b.title.toUpperCase()}` : '', wrap(inlineText(b.text), 76, '| ')]
        .filter(Boolean)
        .join('\n');
    case 'list':
      return [
        b.heading
          ? `${b.heading.title}${b.heading.count !== undefined ? ` (${b.heading.count})` : ''}\n${'-'.repeat(Math.min(76, b.heading.title.length + (b.heading.count !== undefined ? String(b.heading.count).length + 3 : 0)))}`
          : '',
        itemsText(b.items),
      ]
        .filter(Boolean)
        .join('\n');
  }
}

function text(c: EmailContent, brand: Brand): string {
  const footer = [
    ...footerLines(c),
    `Questions? Contact ${brand.supportEmail}.`,
    '',
    ...footerNav(c, brand).map(([t, h]) => `${t}: ${h.replace(/^mailto:/, '')}`),
    '',
    [brand.legalName, brand.postalAddress].filter(Boolean).join(' · '),
    safeHref(brand.websiteUrl),
  ];
  return [
    `${brand.name.toUpperCase()}${c.workspace ? ` · ${c.workspace}` : ''}`,
    '',
    ...(c.eyebrow ? [c.eyebrow.label.toUpperCase()] : []),
    c.heading,
    '='.repeat(Math.min(76, c.heading.length)),
    '',
    ...(c.greeting ? [`Hi ${firstName(c.greeting)},`, ''] : []),
    c.blocks.map(blockText).join('\n\n'),
    '',
    '--',
    ...footer.map((l) => wrap(l)),
    '',
  ].join('\n');
}

export function renderEmail(c: EmailContent, brand: Brand): RenderedEmail {
  if (c.kind === 'security' && c.hero)
    throw new Error('security notices carry no illustration (docs/operations/brand.md)');
  return { subject: c.subject, html: html(c, brand), text: text(c, brand), category: c.category };
}
