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
 *  - `color-scheme: light dark` plus dark overrides; the logo sits on its own
 *    white chip so a dark logo stays visible when the client inverts colours;
 *  - a hidden preheader followed by filler so the inbox preview shows the
 *    preheader, not footer text;
 *  - no external CSS, no script, no images other than the brand logo.
 *
 * Safety: every interpolated value passes through `escapeHtml` (names, task
 * and incident titles are user-controlled). Links must be absolute http(s) or
 * mailto URLs; anything else is a programming error and throws, so a
 * relative or `javascript:` link can never reach a recipient.
 */

import type { Brand } from '../config/mail.ts';
import type { MailCategory } from './transport.ts';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline text: plain string, bold run, or link. */
export type Inline = string | { strong: string } | { href: string; text: string };

export type Block =
  | { t: 'p'; text: Inline[] | string }
  /** `showUrl` prints the link under the button for clients that block buttons (token links). */
  | { t: 'button'; href: string; label: string; showUrl?: boolean }
  | { t: 'facts'; rows: [label: string, value: string][] }
  | { t: 'notice'; tone?: 'info' | 'warning'; title?: string; text: Inline[] | string }
  | { t: 'list'; items: { title: string; href?: string; body?: string; meta?: string }[] }
  | { t: 'muted'; text: Inline[] | string };

export interface EmailContent {
  category: MailCategory;
  subject: string;
  /** Inbox preview line (about 40 to 110 characters). */
  preheader: string;
  heading: string;
  /** Recipient's name for the greeting; omitted → no greeting. */
  greeting?: string;
  blocks: Block[];
  /** Footer line: why the recipient got this email. */
  reason: string;
  /** Security notices cannot be turned off; others link to the notification settings. */
  kind: 'security' | 'account' | 'notification';
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

const C = {
  page: '#f3f4f6',
  card: '#ffffff',
  border: '#e5e7eb',
  ink: '#111827',
  body: '#374151',
  muted: '#6b7280',
  soft: '#f9fafb',
  warnBg: '#fffbeb',
  warnBorder: '#d97706',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

// ─── HTML ────────────────────────────────────────────────────────────────

function inlineHtml(content: Inline[] | string, brand: Brand): string {
  const parts = typeof content === 'string' ? [content] : content;
  return parts
    .map((p) => {
      if (typeof p === 'string') return escapeHtml(p);
      if ('strong' in p)
        return `<strong style="color:${C.ink};font-weight:600">${escapeHtml(p.strong)}</strong>`;
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
  const width = Math.min(520, Math.max(200, label.length * 9 + 56));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px">
<tr><td align="center" bgcolor="${bg}" style="border-radius:8px;background-color:${bg}">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:46px;v-text-anchor:middle;width:${width}px" arcsize="17%" stroke="f" fillcolor="${bg}"><w:anchorlock/><center style="color:${fg};font-family:Arial,sans-serif;font-size:15px;font-weight:bold">${text}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${url}" target="_blank" class="btn" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;color:${fg};text-decoration:none;border-radius:8px;background-color:${bg};border:1px solid ${bg}">${text}</a><!--<![endif]-->
</td></tr></table>`;
}

function blockHtml(b: Block, brand: Brand): string {
  switch (b.t) {
    case 'p':
      return `<p class="text" style="${P}">${inlineHtml(b.text, brand)}</p>`;
    case 'muted':
      return `<p class="muted" style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted}">${inlineHtml(b.text, brand)}</p>`;
    case 'button':
      return (
        buttonHtml(b.href, b.label, brand) +
        (b.showUrl
          ? `\n<p class="muted" style="margin:-12px 0 24px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};word-break:break-all">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(safeHref(b.href))}" target="_blank" class="lnk" style="color:${brand.accentColor};text-decoration:underline">${escapeHtml(safeHref(b.href))}</a></p>`
          : '')
      );
    case 'facts':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="facts" style="margin:0 0 24px;border:1px solid ${C.border};border-radius:8px;border-collapse:separate">
${b.rows
  .map(
    ([k, v], i) =>
      `<tr><td class="muted" valign="top" style="padding:10px 14px;${i ? `border-top:1px solid ${C.border};` : ''}font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};width:34%">${escapeHtml(k)}</td><td class="text" valign="top" style="padding:10px 14px;${i ? `border-top:1px solid ${C.border};` : ''}font-family:${FONT};font-size:14px;line-height:20px;color:${C.ink};word-break:break-word">${escapeHtml(v)}</td></tr>`,
  )
  .join('\n')}
</table>`;
    case 'notice': {
      const warn = b.tone === 'warning';
      const edge = warn ? C.warnBorder : brand.accentColor;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
<tr><td class="notice" style="padding:14px 16px;background-color:${warn ? C.warnBg : C.soft};border-left:4px solid ${edge};border-radius:4px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.body}">${b.title ? `<strong class="text" style="display:block;margin-bottom:4px;color:${C.ink}">${escapeHtml(b.title)}</strong>` : ''}<span class="text">${inlineHtml(b.text, brand)}</span></td></tr></table>`;
    }
    case 'list':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
${b.items
  .map(
    (it, i) =>
      `<tr><td class="rule" style="padding:14px 0;${i ? `border-top:1px solid ${C.border};` : ''}font-family:${FONT}">${
        it.href
          ? `<a href="${escapeHtml(safeHref(it.href))}" target="_blank" class="lnk" style="font-size:15px;line-height:22px;font-weight:600;color:${brand.accentColor};text-decoration:none">${escapeHtml(it.title)}</a>`
          : `<span class="text" style="font-size:15px;line-height:22px;font-weight:600;color:${C.ink}">${escapeHtml(it.title)}</span>`
      }${it.body ? `<div class="text" style="margin-top:2px;font-size:14px;line-height:21px;color:${C.body}">${escapeHtml(it.body)}</div>` : ''}${it.meta ? `<div class="muted" style="margin-top:4px;font-size:12px;line-height:18px;color:${C.muted}">${escapeHtml(it.meta)}</div>` : ''}</td></tr>`,
  )
  .join('\n')}
</table>`;
  }
}

function logoHtml(brand: Brand): string {
  const home = escapeHtml(safeHref(brand.websiteUrl));
  const inner = brand.logoUrl
    ? `<img src="${escapeHtml(safeHref(brand.logoUrl))}" width="${brand.logoWidth}" alt="${escapeHtml(brand.name)}" style="display:block;width:${brand.logoWidth}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;font-family:${FONT};font-size:18px;font-weight:700;color:${C.ink}">`
    : `<span style="font-family:${FONT};font-size:18px;line-height:24px;font-weight:700;letter-spacing:-0.2px;color:${C.ink}"><span style="color:${brand.primaryColor}">&#9632;</span>&nbsp;${escapeHtml(brand.name)}</span>`;
  // White chip: keeps a dark logo legible when a client renders dark mode.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:8px;padding:8px 12px"><a href="${home}" target="_blank" style="text-decoration:none">${inner}</a></td></tr></table>`;
}

function footerHtml(c: EmailContent, brand: Brand): string {
  const fs = `font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}`;
  const link = (href: string, text: string) =>
    `<a href="${escapeHtml(safeHref(href))}" target="_blank" style="color:${C.muted};text-decoration:underline">${escapeHtml(text)}</a>`;
  const lines = [
    escapeHtml(c.reason),
    c.kind === 'security'
      ? 'Security notices are sent for every sign-in and credential change and cannot be turned off.'
      : c.kind === 'notification'
        ? `You can choose which notifications you receive in ${link(appLink(brand, NOTIFICATION_SETTINGS_PATH), 'your notification settings')}.`
        : '',
    `Questions? Contact ${link(`mailto:${brand.supportEmail}`, brand.supportEmail)}.`,
  ].filter(Boolean);
  const legal = [
    escapeHtml(brand.legalName),
    brand.postalAddress ? escapeHtml(brand.postalAddress) : '',
  ]
    .filter(Boolean)
    .join(' &middot; ');
  return `<tr><td class="px" style="padding:24px 40px 8px">
${lines.map((l) => `<p class="muted" style="margin:0 0 8px;${fs}">${l}</p>`).join('\n')}
<p class="muted" style="margin:16px 0 0;${fs}">${legal}<br>${link(brand.websiteUrl, new URL(brand.websiteUrl).host)}</p>
</td></tr>`;
}

function html(c: EmailContent, brand: Brand): string {
  const preheader = escapeHtml(c.preheader);
  // Filler after the preheader so clients do not pull body text into the preview.
  const filler = '&#847;&zwnj;&nbsp;'.repeat(60);
  const greeting = c.greeting
    ? `<p class="text" style="${P}">Hello ${escapeHtml(c.greeting)},</p>`
    : '';
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
<!--[if mso]><style>table,td,p,a,span,div{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}
img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}
@media screen and (max-width:620px){
.container{width:100%!important;max-width:100%!important}
.px{padding-left:24px!important;padding-right:24px!important}
.h1{font-size:22px!important;line-height:30px!important}
.btn{display:block!important;text-align:center!important}
}
@media (prefers-color-scheme:dark){
.bg{background-color:#0b0f17!important}
.card{background-color:#111827!important;border-color:#1f2937!important}
.text,.text strong,h1.text{color:#e5e7eb!important}
.muted{color:#9ca3af!important}
.rule,.facts,.facts td{border-color:#1f2937!important}
.lnk{color:${mix(brand.accentColor, '#ffffff', 0.55)}!important}
.notice{background-color:#1f2937!important}
}
[data-ogsc] .text,[data-ogsc] h1{color:#e5e7eb!important}
[data-ogsc] .muted{color:#9ca3af!important}
[data-ogsc] .lnk{color:${mix(brand.accentColor, '#ffffff', 0.55)}!important}
[data-ogsb] .card{background-color:#111827!important}
[data-ogsb] .notice{background-color:#1f2937!important}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background-color:${C.page};word-spacing:normal">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${C.page}">${preheader}${filler}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="${C.page}" style="background-color:${C.page}">
<tr><td align="center" style="padding:32px 12px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
<tr><td class="px" style="padding:0 40px 20px">${logoHtml(brand)}</td></tr>
<tr><td class="card" bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.border};border-radius:12px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td height="4" bgcolor="${brand.primaryColor}" style="height:4px;line-height:4px;font-size:4px;background-color:${brand.primaryColor};border-radius:12px 12px 0 0">&nbsp;</td></tr>
<tr><td class="px" style="padding:36px 40px 16px">
<h1 class="text h1" style="margin:0 0 20px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.3px;color:${C.ink}">${escapeHtml(c.heading)}</h1>
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

function inlineText(content: Inline[] | string): string {
  const parts = typeof content === 'string' ? [content] : content;
  return parts
    .map((p) =>
      typeof p === 'string'
        ? p
        : 'strong' in p
          ? p.strong
          : `mailto:${p.text}` === p.href
            ? p.text
            : `${p.text} (${safeHref(p.href)})`,
    )
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

function blockText(b: Block): string {
  switch (b.t) {
    case 'p':
    case 'muted':
      return wrap(inlineText(b.text));
    case 'button':
      return `${b.label}:\n${safeHref(b.href)}`;
    case 'facts': {
      const w = Math.max(...b.rows.map(([k]) => k.length)) + 1;
      return b.rows.map(([k, v]) => `${`${k}:`.padEnd(w + 1)}${v}`).join('\n');
    }
    case 'notice':
      return [b.title ? `| ${b.title.toUpperCase()}` : '', wrap(inlineText(b.text), 76, '| ')]
        .filter(Boolean)
        .join('\n');
    case 'list':
      return b.items
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
}

function text(c: EmailContent, brand: Brand): string {
  const footer = [
    c.reason,
    c.kind === 'security'
      ? 'Security notices are sent for every sign-in and credential change and cannot be turned off.'
      : c.kind === 'notification'
        ? `Choose which notifications you receive: ${appLink(brand, NOTIFICATION_SETTINGS_PATH)}`
        : '',
    `Questions? Contact ${brand.supportEmail}.`,
    '',
    [brand.legalName, brand.postalAddress].filter(Boolean).join(' · '),
    safeHref(brand.websiteUrl),
  ].filter((l, i) => l !== '' || i === 3);
  return [
    brand.name.toUpperCase(),
    '',
    c.heading,
    '='.repeat(Math.min(76, c.heading.length)),
    '',
    ...(c.greeting ? [`Hello ${c.greeting},`, ''] : []),
    c.blocks.map(blockText).join('\n\n'),
    '',
    '--',
    ...footer.map((l) => wrap(l)),
    '',
  ].join('\n');
}

export function renderEmail(c: EmailContent, brand: Brand): RenderedEmail {
  return { subject: c.subject, html: html(c, brand), text: text(c, brand), category: c.category };
}
