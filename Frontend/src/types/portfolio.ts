export type ProductId = 'renewberry' | 'blog' | 'mirror';
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'info' | 'accent';
export type Health = 'healthy' | 'degraded' | 'at-risk';

export interface Product {
  id: ProductId;
  name: string;
  code: string;
  tagline: string;
  health: Health;
  healthReasons: string[];
  openTasks: number;
  lateTasks: number;
  openPrs: number;
  lastDeploy: { sha: string; ago: string };
  milestone: { name: string; progress: number; due: string };
  uptime: number;
  activeProjects: number;
  lead: string;
  memberCount: number;
  repos: string[];
}

export interface Release {
  id: string;
  product: ProductId;
  name: string;
  scope: string;
  due: string;
  done: number;
  total: number;
}

export interface AttentionItem {
  id: string;
  product: ProductId;
  title: string;
  detail: string;
  meta: string;
  tone: Tone;
  to: string;
}

export interface ActivityItem {
  id: string;
  product: ProductId;
  text: string;
  ago: string;
  tone: Tone;
}
