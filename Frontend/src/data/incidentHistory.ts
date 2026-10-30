import type { ProductId } from '../types/portfolio';

export interface PastIncident {
  id: string;
  product: ProductId;
  severity: 'SEV1' | 'SEV2' | 'SEV3';
  service: string;
  title: string;
  started: string;
  /** Minutes from alert to resolution. */
  minutes: number;
  owner: string;
}

/** Resolved incidents from the last ~90 days — the basis for MTTR and frequency analytics. */
export const pastIncidents: PastIncident[] = [
  {
    id: 'INC-27',
    product: 'renewberry',
    severity: 'SEV2',
    service: 'renewberry-api',
    title: 'Webhook backlog after provider outage',
    started: 'Oct 14, 07:20',
    minutes: 96,
    owner: 'm11',
  },
  {
    id: 'INC-26',
    product: 'mirror',
    severity: 'SEV3',
    service: 'mirror-app',
    title: 'Slow thumbnail generation',
    started: 'Oct 9, 13:05',
    minutes: 54,
    owner: 'm11',
  },
  {
    id: 'INC-25',
    product: 'renewberry',
    severity: 'SEV1',
    service: 'renewberry-web',
    title: 'Checkout unavailable',
    started: 'Oct 3, 18:42',
    minutes: 38,
    owner: 'm11',
  },
  {
    id: 'INC-24',
    product: 'blog',
    severity: 'SEV3',
    service: 'blog-web',
    title: 'Sitemap job timing out',
    started: 'Sep 29, 02:10',
    minutes: 140,
    owner: 'm11',
  },
  {
    id: 'INC-23',
    product: 'renewberry',
    severity: 'SEV2',
    service: 'renewberry-api',
    title: 'Invoice PDF errors',
    started: 'Sep 24, 10:30',
    minutes: 72,
    owner: 'm5',
  },
  {
    id: 'INC-22',
    product: 'mirror',
    severity: 'SEV2',
    service: 'mirror-sync',
    title: 'Sync worker stalled',
    started: 'Sep 18, 21:15',
    minutes: 165,
    owner: 'm11',
  },
  {
    id: 'INC-21',
    product: 'blog',
    severity: 'SEV3',
    service: 'blog-media',
    title: 'Image upload failures',
    started: 'Sep 12, 11:48',
    minutes: 44,
    owner: 'm6',
  },
  {
    id: 'INC-20',
    product: 'renewberry',
    severity: 'SEV3',
    service: 'renewberry-web',
    title: 'Login page slow',
    started: 'Sep 6, 09:02',
    minutes: 61,
    owner: 'm11',
  },
  {
    id: 'INC-19',
    product: 'renewberry',
    severity: 'SEV2',
    service: 'renewberry-api',
    title: 'Rate limiter misconfigured',
    started: 'Aug 30, 15:30',
    minutes: 118,
    owner: 'm11',
  },
  {
    id: 'INC-18',
    product: 'mirror',
    severity: 'SEV3',
    service: 'mirror-app',
    title: '/health flapping',
    started: 'Aug 24, 04:55',
    minutes: 210,
    owner: 'm11',
  },
  {
    id: 'INC-17',
    product: 'blog',
    severity: 'SEV2',
    service: 'blog-web',
    title: 'Editor autosave lost drafts',
    started: 'Aug 11, 16:20',
    minutes: 135,
    owner: 'm6',
  },
];

export const onCall = [
  {
    member: 'm11',
    role: 'Primary',
    until: 'Mon 09:00',
    products: ['renewberry', 'blog', 'mirror'] as ProductId[],
  },
  {
    member: 'm5',
    role: 'Secondary',
    until: 'Mon 09:00',
    products: ['renewberry', 'mirror'] as ProductId[],
  },
];
