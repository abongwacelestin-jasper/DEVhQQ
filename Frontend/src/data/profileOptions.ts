/**
 * Choices offered by the profile forms (onboarding and Settings). The server
 * validates the same sets (`Backend/routes/onboarding.routes.ts`).
 */
import type { OnboardingProfile } from '../api/types';

export const timezones = [
  'Africa/Lagos (WAT)',
  'Europe/London (GMT)',
  'Europe/Berlin (CET)',
  'America/New_York (ET)',
  'Asia/Tokyo (JST)',
  'Asia/Kolkata (IST)',
];

export const skillOptions = [
  'React',
  'TypeScript',
  'Node.js',
  'PostgreSQL',
  'Figma',
  'Design systems',
  'QA automation',
  'Playwright',
  'Kubernetes',
  'Terraform',
  'Observability',
  'Roadmapping',
  'Technical writing',
  'Accessibility',
];

export const notifyOptions = [
  { key: 'assigned', label: 'Tasks assigned to me' },
  { key: 'review', label: 'Review requests' },
  { key: 'mentions', label: 'Mentions & comments' },
  { key: 'deploys', label: 'Deploys on my products' },
  { key: 'incidents', label: 'Incidents on my products' },
];

export type EmailDelivery = NonNullable<OnboardingProfile['emailDelivery']>;

export const emailModes: { value: EmailDelivery; label: string }[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'daily', label: 'Daily digest' },
  { value: 'off', label: 'Off' },
];

export const DEFAULT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/** Field limits shared with the server schema. */
export const PROFILE_LIMITS = { title: 80, pronouns: 30, bio: 160 } as const;
