import type { ProductId } from '../types/portfolio';

export interface CanaryState {
  product: ProductId;
  /** Release being trialled on a slice of production traffic; null when no canary is running. */
  candidate: { sha: string; version: string } | null;
  /** Release serving the rest of production — what a rollback returns to. */
  stable: { sha: string; version: string };
  /** Share of production traffic on the candidate, 0–100. */
  traffic: number;
  errorRate: { candidate: number; stable: number };
  p95Ms: { candidate: number; stable: number };
  ci: 'passing' | 'failing' | 'running';
  startedAgo: string;
}

/** Traffic steps a canary is promoted through; 100 means fully rolled out. */
export const canarySteps = [5, 25, 50, 100];

/** Error rate above which a canary is flagged unhealthy (absolute %, and ×3 the stable rate). */
export const canaryErrorBudget = 1;

export const canaries: CanaryState[] = [
  {
    product: 'renewberry',
    candidate: { sha: 'a41f9c2', version: '2.3.1+1' },
    stable: { sha: '9be2c40', version: '2.3.1' },
    traffic: 25,
    errorRate: { candidate: 3.4, stable: 0.4 },
    p95Ms: { candidate: 612, stable: 238 },
    ci: 'passing',
    startedAgo: '3h',
  },
  {
    product: 'blog',
    candidate: null,
    stable: { sha: '7c20be1', version: '1.8.4' },
    traffic: 0,
    errorRate: { candidate: 0, stable: 0.1 },
    p95Ms: { candidate: 0, stable: 142 },
    ci: 'passing',
    startedAgo: '1d',
  },
  {
    product: 'mirror',
    candidate: { sha: '0f77d1a', version: '0.9.0' },
    stable: { sha: 'c3a9e21', version: '0.8.7' },
    traffic: 50,
    errorRate: { candidate: 0.2, stable: 0.3 },
    p95Ms: { candidate: 188, stable: 201 },
    ci: 'passing',
    startedAgo: '6d',
  },
];
