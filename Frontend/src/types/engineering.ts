import type { ProductId, Tone } from './portfolio';

export type CiStatus = 'passing' | 'failing' | 'running' | 'none';
export type ReviewState = 'review-required' | 'changes-requested' | 'approved' | 'merged';

export interface PullRequest {
  number: number;
  title: string;
  product: ProductId;
  repo: string;
  branch: string;
  taskKey?: string;
  author: string;
  reviewers: string[];
  ci: CiStatus;
  review: ReviewState;
  age: string;
  additions: number;
  deletions: number;
}

export interface Repository {
  name: string;
  product: ProductId;
  defaultBranch: string;
  language: string;
  openPrs: number;
  ci: CiStatus;
  lastCommit: { sha: string; message: string; author: string; ago: string };
  weeklyCommits: number[];
  latestTag: string;
}

export interface TraceStep {
  kind: 'task' | 'pr' | 'ci' | 'staging' | 'production' | 'health';
  label: string;
  value: string;
  tone: Tone;
}

export interface Trace {
  taskKey: string;
  steps: TraceStep[];
  note: string;
}
