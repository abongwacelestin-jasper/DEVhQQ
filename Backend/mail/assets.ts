/**
 * Email images. The files live in Frontend/public/brand/email/ (the frontend
 * serves them, so production URLs are `<BRAND_ASSET_BASE_URL>/email/<file>`,
 * by default `<app origin>/brand/email/<file>`), and are regenerated from the
 * app's own artwork by `node infra/brand/email-assets.mjs`.
 *
 * Rules (docs/operations/brand.md):
 *  - one hero per non-security email, 1200 x 480 JPEG shown at 520 x 208,
 *    with alt text, explicit size and a fallback background colour that
 *    matches the art, so the email reads fully with images blocked;
 *  - security notices carry no image but the logo (image-heavy security
 *    mail looks like phishing and hurts deliverability);
 *  - product marks: 48 px PNGs of the app's <ProductMark>, shown at 24 px.
 */

import type { Brand } from '../config/mail.ts';
import { safeHref } from './layout.ts';

export interface Hero {
  file: string;
  alt: string;
  /** Edge colour of the artwork: shown while the image loads or when it is blocked. */
  bg: string;
}

/** Display size of a hero (the files are 2x). */
export const HERO_SIZE = { width: 520, height: 208 } as const;
/** Display size of a product mark (the files are 48 px). */
export const MARK_SIZE = 24;

export const HEROES = {
  invite: {
    file: 'hero-invite.jpg',
    alt: 'A laptop showing a project dashboard on a tidy desk',
    bg: '#efeef1',
  },
  digest: {
    file: 'hero-digest.jpg',
    alt: 'Task, pull request, deploy and incident records flowing into one summary',
    bg: '#ebebed',
  },
  task: {
    file: 'hero-task.jpg',
    alt: 'A clipboard checklist with ticked items',
    bg: '#ececee',
  },
  review: {
    file: 'hero-review.jpg',
    alt: 'A code editor window with floating brackets',
    bg: '#efeef1',
  },
  incident: {
    file: 'hero-incident.jpg',
    alt: 'A server with a red alert light next to a pager and fire extinguisher',
    bg: '#eaebef',
  },
  deploy: {
    file: 'hero-deploy.jpg',
    alt: 'A rocket launching from a server pad',
    bg: '#ebebed',
  },
  access: {
    file: 'hero-access.jpg',
    alt: 'A closed gate with a padlock and a keycard reader',
    bg: '#e3e3e5',
  },
  handover: {
    file: 'hero-handover.jpg',
    alt: 'A small team passing a puzzle piece around a laptop',
    bg: '#efeef1',
  },
  farewell: {
    file: 'hero-farewell.jpg',
    alt: 'A closed laptop with a padlock above it',
    bg: '#eeedf0',
  },
} satisfies Record<string, Hero>;

export type HeroId = keyof typeof HEROES;

/** Products with a mark file (`mark-<id>.png`). */
export const MARKED_PRODUCTS = ['renewberry', 'blog', 'mirror'] as const;

/** Absolute URL of a file under the brand asset base. */
export function assetUrl(brand: Brand, path: string): string {
  return safeHref(`${brand.assetBaseUrl}/${path.replace(/^\/+/, '')}`);
}
