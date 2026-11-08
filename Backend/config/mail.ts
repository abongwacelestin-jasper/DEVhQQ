/**
 * Mail and brand configuration (read once at boot, like the rest of config/).
 *
 *   MAIL_TRANSPORT    console (default) | smtp | resend
 *   MAIL_FROM         RFC 5322 From, e.g. `DevHQ <no-reply@mail.example.com>`
 *   MAIL_REPLY_TO     optional Reply-To address
 *   RESEND_API_KEY    Resend API key (or RESEND_API_KEY_FILE, a file holding it)
 *   RESEND_TIMEOUT_MS per-attempt timeout of the Resend API call (10 s)
 *   APP_URL           base of every link in an email (default APP_ORIGIN)
 *   BRAND_*           name, legal name, logo, colours, support address, postal
 *                     address and website shown in every email
 *   BRAND_ASSET_BASE_URL  where the email images live (default <app origin>/brand)
 *
 * Every brand value is optional. Unset values are derived from the app's
 * own address (APP_URL, else APP_ORIGIN), so emails look complete with zero
 * BRAND_* configuration: website = the app origin, logo and images = the
 * PNG/JPEG files the frontend serves under /brand/, support and reply-to =
 * support@<registrable domain>, sender = no-reply@<registrable domain>. The
 * one exception is the postal address: it is a legal statement, so it is
 * never invented; unset, the footer omits the line.
 *
 * Production fails closed: `MAIL_TRANSPORT=resend` without a key or without
 * MAIL_FROM refuses to boot, an unknown transport refuses to boot, and every
 * explicitly configured URL must be https. Outside production a missing key
 * falls back to the console transport with a warning, so development and the
 * test suites never need a real provider.
 *
 * `loadMailConfig` takes the variables as a plain record so tests can check
 * the fail-closed paths without touching the process environment;
 * `mailEnvFromProcess` lists every variable it reads (the docs generator
 * scans for `process.env.NAME`).
 */

import { readFileSync } from 'node:fs';

export type MailTransportKind = 'console' | 'smtp' | 'resend';

export interface Brand {
  /** Product name used in subjects and copy, e.g. "DevHQ". */
  name: string;
  /** Company name in the footer, e.g. "DevHQ Technologies Ltd". */
  legalName: string;
  /** Absolute URL of a PNG (recommended) or SVG logo; unset renders a text wordmark. */
  logoUrl?: string;
  /**
   * Base URL of the email images (heroes, product marks), no trailing slash.
   * Files live at `<assetBaseUrl>/email/…`; the frontend serves them from
   * Frontend/public/brand/, so the default is `<app origin>/brand`.
   */
  assetBaseUrl: string;
  /** Rendered logo width in px (height scales). */
  logoWidth: number;
  /** Buttons and the top rule. `#rrggbb`. */
  primaryColor: string;
  /** Links and highlights. `#rrggbb`. */
  accentColor: string;
  supportEmail: string;
  /** Physical address for the compliance footer; empty omits the line. */
  postalAddress: string;
  websiteUrl: string;
  /** Base of every in-app link (no trailing slash). */
  appUrl: string;
}

export interface MailConfig {
  transport: MailTransportKind;
  from: string;
  replyTo?: string;
  resend: { apiKey?: string; baseUrl: string; timeoutMs: number };
  brand: Brand;
  /** Non-fatal configuration problems, logged once at boot. */
  warnings: string[];
}

export type MailEnv = Record<string, string | undefined>;

/** Every variable this module reads, as literal `process.env.NAME` reads. */
export function mailEnvFromProcess(): MailEnv {
  return {
    MAIL_TRANSPORT: process.env.MAIL_TRANSPORT,
    MAIL_FROM: process.env.MAIL_FROM,
    MAIL_REPLY_TO: process.env.MAIL_REPLY_TO,
    SMTP_FROM: process.env.SMTP_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_API_KEY_FILE: process.env.RESEND_API_KEY_FILE,
    RESEND_BASE_URL: process.env.RESEND_BASE_URL,
    RESEND_TIMEOUT_MS: process.env.RESEND_TIMEOUT_MS,
    APP_URL: process.env.APP_URL,
    BRAND_NAME: process.env.BRAND_NAME,
    BRAND_LEGAL_NAME: process.env.BRAND_LEGAL_NAME,
    BRAND_LOGO_URL: process.env.BRAND_LOGO_URL,
    BRAND_LOGO_WIDTH: process.env.BRAND_LOGO_WIDTH,
    BRAND_PRIMARY_COLOR: process.env.BRAND_PRIMARY_COLOR,
    BRAND_ACCENT_COLOR: process.env.BRAND_ACCENT_COLOR,
    BRAND_SUPPORT_EMAIL: process.env.BRAND_SUPPORT_EMAIL,
    BRAND_POSTAL_ADDRESS: process.env.BRAND_POSTAL_ADDRESS,
    BRAND_WEBSITE_URL: process.env.BRAND_WEBSITE_URL,
    BRAND_ASSET_BASE_URL: process.env.BRAND_ASSET_BASE_URL,
  };
}

const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
/** `Name <addr@domain>` or a bare address; no CR/LF (header injection). */
const FROM = /^(?:[^<>\r\n]{1,100}\s)?<([^<>\s]+)>$|^([^<>\s]+)$/;

export function isEmailAddress(s: string): boolean {
  return ADDRESS.test(s);
}

/** Address part of a From value, or undefined when it is not a valid mailbox. */
export function mailboxAddress(from: string): string | undefined {
  if (/[\r\n]/.test(from)) return undefined;
  const m = FROM.exec(from.trim());
  const addr = m?.[1] ?? m?.[2];
  return addr && ADDRESS.test(addr) ? addr : undefined;
}

/** `#rgb` or `#rrggbb` → lower-case `#rrggbb`; anything else is refused. */
export function normalizeColor(name: string, raw: string): string {
  const v = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`;
  throw new Error(`${name} must be a hex colour like #4f46e5 (got "${raw}")`);
}

function absoluteUrl(name: string, raw: string, httpsOnly: boolean): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error(`${name} must be an absolute URL (got "${raw}")`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    throw new Error(`${name} must be an http(s) URL`);
  if (httpsOnly && u.protocol !== 'https:') throw new Error(`${name} must use https in production`);
  if (u.username || u.password) throw new Error(`${name} must not contain credentials`);
  return u.toString().replace(/\/$/, '');
}

/**
 * Reads NAME or NAME_FILE (a path to a file holding the value, as Compose and
 * Railway secret mounts provide). Both set is ambiguous and refused; an empty
 * file means "not configured", matching infra/docker/entrypoint.sh.
 */
export function secretValue(env: MailEnv, name: string): string | undefined {
  const direct = env[name]?.trim();
  const file = env[`${name}_FILE`]?.trim();
  if (direct && file) throw new Error(`Both ${name} and ${name}_FILE are set; refusing to guess`);
  if (file) {
    let value: string;
    try {
      value = readFileSync(file, 'utf8');
    } catch {
      throw new Error(`${name}_FILE points at an unreadable file`);
    }
    return value.replace(/[\r\n]+$/, '').trim() || undefined;
  }
  return direct || undefined;
}

function positiveInt(name: string, raw: string | undefined, def: number, max: number): number {
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > max)
    throw new Error(`${name} must be a positive integer up to ${max}`);
  return n;
}

/**
 * Two-part public suffixes (and hosting platforms whose subdomains belong to
 * different customers) that the registrable-domain guess must not stop at.
 * A short list on purpose: it covers the common cases, and an unusual suffix
 * only affects defaults that BRAND_SUPPORT_EMAIL / MAIL_FROM override.
 */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'me.uk',
  'ltd.uk',
  'plc.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'co.nz',
  'org.nz',
  'co.za',
  'org.za',
  'com.ng',
  'org.ng',
  'com.gh',
  'org.gh',
  'co.ke',
  'or.ke',
  'co.ug',
  'co.tz',
  'com.br',
  'com.mx',
  'com.ar',
  'co.jp',
  'ne.jp',
  'co.kr',
  'co.in',
  'net.in',
  'org.in',
  'com.sg',
  'com.my',
  'com.hk',
  'com.cn',
  'com.tr',
  'co.il',
  'com.eg',
  'up.railway.app',
  'vercel.app',
  'netlify.app',
  'onrender.com',
  'herokuapp.com',
  'pages.dev',
  'workers.dev',
  'fly.dev',
  'github.io',
]);

/**
 * Registrable domain of a host: `app.example.com` → `example.com`,
 * `mail.example.co.uk` → `example.co.uk`. Localhost and IP addresses have
 * none and map to `devhq.local`, a name that can never receive mail.
 */
export function registrableDomain(host: string): string {
  const h = host
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || /^[\d.]+$/.test(h) || h.includes(':'))
    return 'devhq.local';
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  for (let n = 3; n >= 2; n--) {
    const suffix = labels.slice(-n).join('.');
    if (MULTI_PART_SUFFIXES.has(suffix))
      return labels.length > n ? labels.slice(-(n + 1)).join('.') : h;
  }
  return labels.slice(-2).join('.');
}

const LOGO_EXT = /\.(png|svg|jpe?g|gif)$/i;

export function loadMailConfig(
  env: MailEnv,
  opts: { isProd: boolean; appOrigin: string },
): MailConfig {
  const { isProd } = opts;
  const warnings: string[] = [];
  const kindRaw = (env.MAIL_TRANSPORT ?? 'console').trim().toLowerCase() || 'console';
  if (kindRaw !== 'console' && kindRaw !== 'smtp' && kindRaw !== 'resend') {
    if (isProd)
      throw new Error(`MAIL_TRANSPORT must be console, smtp or resend (got "${kindRaw}")`);
    warnings.push(`MAIL_TRANSPORT="${kindRaw}" is not recognised — using console`);
  }
  let transport: MailTransportKind =
    kindRaw === 'smtp' || kindRaw === 'resend' ? kindRaw : 'console';

  // Links: APP_URL when set (validated strictly in production), else APP_ORIGIN.
  const appUrl = env.APP_URL?.trim()
    ? absoluteUrl('APP_URL', env.APP_URL, isProd)
    : absoluteUrl('APP_ORIGIN', opts.appOrigin, isProd && transport === 'resend');
  const appOrigin = new URL(appUrl).origin;
  const mailDomain = registrableDomain(new URL(appUrl).hostname);

  const name = env.BRAND_NAME?.trim() || 'DevHQ';
  if (name.length > 60 || /[\r\n<>]/.test(name))
    throw new Error('BRAND_NAME must be at most 60 characters with no angle brackets');
  const legalName = env.BRAND_LEGAL_NAME?.trim() || name;

  // Default: the lockup PNG the frontend serves (Frontend/public/brand/).
  let logoUrl: string | undefined = `${appOrigin}/brand/devhq-email-logo.png`;
  if (env.BRAND_LOGO_URL?.trim()) {
    logoUrl = absoluteUrl('BRAND_LOGO_URL', env.BRAND_LOGO_URL, isProd);
    const path = new URL(logoUrl).pathname;
    if (/\.[a-z0-9]{2,5}$/i.test(path) && !LOGO_EXT.test(path))
      throw new Error('BRAND_LOGO_URL must point at a PNG or SVG image');
    if (/\.svg$/i.test(path))
      warnings.push(
        'BRAND_LOGO_URL is an SVG: Gmail and Outlook do not display SVG images; use a PNG for email',
      );
  }

  const supportEmail = env.BRAND_SUPPORT_EMAIL?.trim() || `support@${mailDomain}`;
  if (!ADDRESS.test(supportEmail))
    throw new Error('BRAND_SUPPORT_EMAIL must be a valid email address');

  const websiteUrl = env.BRAND_WEBSITE_URL?.trim()
    ? absoluteUrl('BRAND_WEBSITE_URL', env.BRAND_WEBSITE_URL, isProd)
    : appOrigin;
  const assetBaseUrl = env.BRAND_ASSET_BASE_URL?.trim()
    ? absoluteUrl('BRAND_ASSET_BASE_URL', env.BRAND_ASSET_BASE_URL, isProd)
    : `${appOrigin}/brand`;

  const postalAddress = (env.BRAND_POSTAL_ADDRESS ?? '').replace(/\s+/g, ' ').trim();
  if (postalAddress.length > 300) throw new Error('BRAND_POSTAL_ADDRESS is too long');

  const brand: Brand = {
    name,
    legalName,
    logoUrl,
    assetBaseUrl,
    logoWidth: positiveInt('BRAND_LOGO_WIDTH', env.BRAND_LOGO_WIDTH, 120, 560),
    primaryColor: normalizeColor('BRAND_PRIMARY_COLOR', env.BRAND_PRIMARY_COLOR || '#4f46e5'),
    accentColor: normalizeColor('BRAND_ACCENT_COLOR', env.BRAND_ACCENT_COLOR || '#3730a3'),
    supportEmail,
    postalAddress,
    websiteUrl,
    appUrl,
  };

  // Sender. SMTP_FROM stays honoured for existing SMTP deployments.
  const fromRaw = env.MAIL_FROM?.trim() || (transport === 'smtp' ? env.SMTP_FROM?.trim() : '');
  if (isProd && transport === 'resend' && !fromRaw)
    throw new Error('MAIL_FROM is required when MAIL_TRANSPORT=resend in production');
  const from = fromRaw || `${name} <no-reply@${mailDomain}>`;
  if (!mailboxAddress(from))
    throw new Error('MAIL_FROM must look like "DevHQ <no-reply@mail.example.com>"');
  // Replies reach a person: the support mailbox unless another is configured.
  const replyTo = env.MAIL_REPLY_TO?.trim() || supportEmail;
  if (replyTo && !ADDRESS.test(replyTo))
    throw new Error('MAIL_REPLY_TO must be a single valid email address');

  const apiKey = secretValue(env, 'RESEND_API_KEY');
  if (apiKey && /\s/.test(apiKey)) throw new Error('RESEND_API_KEY must not contain whitespace');
  if (transport === 'resend' && !apiKey) {
    if (isProd)
      throw new Error(
        'RESEND_API_KEY (or RESEND_API_KEY_FILE) is required when MAIL_TRANSPORT=resend in production',
      );
    warnings.push('MAIL_TRANSPORT=resend but RESEND_API_KEY is unset — using console transport');
    transport = 'console';
  }
  const baseUrl = env.RESEND_BASE_URL?.trim()
    ? absoluteUrl('RESEND_BASE_URL', env.RESEND_BASE_URL, isProd)
    : 'https://api.resend.com';

  if (isProd && transport !== 'console' && !postalAddress)
    warnings.push(
      'BRAND_POSTAL_ADDRESS is unset: emails go out without a postal address in the footer',
    );

  return {
    transport,
    from,
    replyTo,
    resend: {
      apiKey,
      baseUrl,
      timeoutMs: positiveInt('RESEND_TIMEOUT_MS', env.RESEND_TIMEOUT_MS, 10_000, 60_000),
    },
    brand,
    warnings,
  };
}
