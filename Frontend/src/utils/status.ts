import type { Health, ProductId, Tone } from '../types/portfolio';
import type { CiStatus, ReviewState } from '../types/engineering';
import type { DeployStatus, LaneStatus } from '../types/operations';
import type { Priority, ProjectStatus, TaskStatus } from '../types/work';
import { members } from '../data/team';
import { products } from '../data/portfolio';

export const healthMeta: Record<Health, { label: string; tone: Tone }> = {
  healthy: { label: 'Healthy', tone: 'ok' },
  degraded: { label: 'Degraded', tone: 'bad' },
  'at-risk': { label: 'At risk', tone: 'warn' },
};

export const deployMeta: Record<DeployStatus, { label: string; tone: Tone }> = {
  succeeded: { label: 'Succeeded', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  'awaiting-approval': { label: 'Awaiting approval', tone: 'warn' },
  running: { label: 'Running', tone: 'info' },
  'rolled-back': { label: 'Rolled back', tone: 'neutral' },
};

export const laneMeta: Record<LaneStatus, { label: string; tone: Tone }> = {
  healthy: { label: 'Healthy', tone: 'ok' },
  failed: { label: 'Last deploy failed', tone: 'bad' },
  pending: { label: 'Approval pending', tone: 'warn' },
  degraded: { label: 'Service degraded', tone: 'bad' },
};

export const ciMeta: Record<CiStatus, { label: string; tone: Tone }> = {
  passing: { label: 'CI passing', tone: 'ok' },
  failing: { label: 'CI failing', tone: 'bad' },
  running: { label: 'CI running', tone: 'info' },
  none: { label: 'No checks', tone: 'neutral' },
};

export const reviewMeta: Record<ReviewState, { label: string; tone: Tone }> = {
  'review-required': { label: 'Review required', tone: 'warn' },
  'changes-requested': { label: 'Changes requested', tone: 'bad' },
  approved: { label: 'Approved', tone: 'ok' },
  merged: { label: 'Merged', tone: 'accent' },
};

export const taskStatusMeta: Record<TaskStatus, { label: string; tone: Tone }> = {
  backlog: { label: 'Backlog', tone: 'neutral' },
  'in-progress': { label: 'In progress', tone: 'info' },
  review: { label: 'In review', tone: 'accent' },
  done: { label: 'Done', tone: 'ok' },
};

export const projectStatusMeta: Record<ProjectStatus, { label: string; tone: Tone }> = {
  'on-track': { label: 'On track', tone: 'ok' },
  'at-risk': { label: 'At risk', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'bad' },
  planned: { label: 'Planned', tone: 'neutral' },
};

export const priorityMeta: Record<Priority, { label: string; tone: Tone }> = {
  urgent: { label: 'Urgent', tone: 'bad' },
  high: { label: 'High', tone: 'warn' },
  medium: { label: 'Medium', tone: 'neutral' },
  low: { label: 'Low', tone: 'neutral' },
};

export const toneText: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  neutral: 'text-muted',
  info: 'text-info',
  accent: 'text-accent',
};

export const toneDot: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  neutral: 'bg-subtle',
  info: 'bg-info',
  accent: 'bg-accent',
};

export function memberById(id: string) {
  return members.find((m) => m.id === id) ?? members[0];
}

export function productById(id: ProductId) {
  return products.find((p) => p.id === id) ?? products[0];
}

export function firstName(id: string) {
  return memberById(id).name.split(' ')[0];
}
