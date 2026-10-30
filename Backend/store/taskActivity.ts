/**
 * Seed task activity — the audit trail behind every task.
 *
 * The workspace's "now" is Friday 23 October 2026, so the seeds are dated
 * relative to that day rather than to the wall clock: a demo reloaded next
 * month must still look like the same working week.
 */

import type { Subtask, TaskComment, TaskEvent, TimeLog } from '../types.ts';

const MONTH = { Sep: 8, Oct: 9 } as const;

const at = (month: keyof typeof MONTH, day: number, h = 10, min = 0) =>
  new Date(Date.UTC(2026, MONTH[month], day, h, min)).toISOString();

/** When each task was created and by whom. */
export const taskCreation: Record<string, { at: string; by: string }> = {
  'RB-212': { at: at('Oct', 9, 10, 12), by: 'm2' },
  'RB-221': { at: at('Oct', 14, 9, 30), by: 'm2' },
  'RB-226': { at: at('Oct', 15, 11, 5), by: 'm2' },
  'RB-230': { at: at('Oct', 16, 16, 20), by: 'm2' },
  'RB-218': { at: at('Oct', 9, 10, 40), by: 'm2' },
  'RB-209': { at: at('Oct', 2, 8, 55), by: 'm4' },
  'RB-231': { at: at('Oct', 19, 9, 0), by: 'm2' },
  'BL-17': { at: at('Sep', 28, 14, 10), by: 'm3' },
  'BL-22': { at: at('Oct', 7, 12, 0), by: 'm3' },
  'BL-18': { at: at('Oct', 7, 12, 4), by: 'm3' },
  'BL-24': { at: at('Oct', 13, 15, 30), by: 'm3' },
  'BL-26': { at: at('Oct', 20, 10, 15), by: 'm3' },
  'MA-38': { at: at('Oct', 1, 9, 20), by: 'm3' },
  'MA-36': { at: at('Oct', 12, 13, 45), by: 'm11' },
  'MA-44': { at: at('Oct', 21, 8, 10), by: 'm11' },
  'MA-41': { at: at('Oct', 6, 10, 0), by: 'm3' },
  'MA-40': { at: at('Oct', 6, 10, 5), by: 'm3' },
  'MA-35': { at: at('Sep', 30, 11, 30), by: 'm9' },
};

/** Pull requests the GitHub App linked to a task. */
export const taskPullRequests: Record<string, number> = {
  'RB-212': 148,
  'RB-221': 152,
  'RB-209': 149,
  'BL-17': 151,
  'BL-24': 153,
  'MA-36': 47,
  'MA-35': 46,
};

/** Blocking relationships. */
export const taskBlockedBy: Record<string, string> = {
  'RB-218': 'RB-212',
  'MA-40': 'MA-38',
};

let n = 0;
const ev = (
  taskKey: string,
  when: string,
  actor: string,
  kind: TaskEvent['kind'],
  from?: string,
  to?: string,
  note?: string,
): TaskEvent => ({ id: `se${++n}`, taskKey, actor, at: when, kind, from, to, note });

export const seedEvents: TaskEvent[] = [
  ev('RB-212', at('Oct', 9, 10, 14), 'm2', 'assignee', undefined, 'm5'),
  ev('RB-212', at('Oct', 13, 9, 2), 'm5', 'status', 'backlog', 'in-progress'),
  ev(
    'RB-212',
    at('Oct', 21, 15, 3),
    'm5',
    'linked',
    undefined,
    'PR #148',
    'Linked by GitHub App from branch name',
  ),
  ev('RB-212', at('Oct', 22, 17, 22), 'm2', 'priority', 'medium', 'high'),
  ev('RB-212', at('Oct', 23, 14, 30), 'm5', 'status', 'in-progress', 'review'),
  ev('RB-212', at('Oct', 23, 14, 31), 'm5', 'reviewer', undefined, 'm10'),
  ev('RB-221', at('Oct', 14, 9, 31), 'm2', 'assignee', undefined, 'm7'),
  ev(
    'RB-221',
    at('Oct', 15, 10, 12),
    'm2',
    'assignee',
    'm7',
    'm4',
    'Yuki is at capacity — moving to Kofi',
  ),
  ev('RB-221', at('Oct', 16, 9, 40), 'm4', 'status', 'backlog', 'in-progress'),
  ev('RB-221', at('Oct', 21, 11, 15), 'm4', 'linked', undefined, 'PR #152'),
  ev('RB-221', at('Oct', 22, 9, 0), 'm2', 'due', 'Oct 28', 'Oct 25', 'Pulled in for v2.4 cut'),
  ev('RB-226', at('Oct', 15, 11, 6), 'm2', 'assignee', undefined, 'm9'),
  ev('RB-226', at('Oct', 20, 10, 30), 'm9', 'status', 'backlog', 'in-progress'),
  ev('RB-230', at('Oct', 16, 16, 21), 'm2', 'assignee', undefined, 'm7'),
  ev('RB-218', at('Oct', 9, 10, 41), 'm2', 'assignee', undefined, 'm5'),
  ev('RB-209', at('Oct', 2, 8, 56), 'm4', 'assignee', undefined, 'm4'),
  ev('RB-209', at('Oct', 3, 10, 0), 'm4', 'status', 'backlog', 'in-progress'),
  ev('RB-209', at('Oct', 19, 16, 44), 'm4', 'status', 'in-progress', 'review'),
  ev('RB-209', at('Oct', 22, 12, 20), 'm10', 'status', 'review', 'done', 'Released in a41f9c2'),
  ev('RB-231', at('Oct', 19, 9, 1), 'm2', 'assignee', undefined, 'm1'),
  ev('RB-231', at('Oct', 22, 8, 30), 'm1', 'status', 'backlog', 'in-progress'),
  ev('BL-17', at('Sep', 28, 14, 11), 'm3', 'assignee', undefined, 'm6'),
  ev('BL-17', at('Oct', 1, 9, 10), 'm6', 'status', 'backlog', 'in-progress'),
  ev('BL-17', at('Oct', 16, 18, 2), 'm6', 'status', 'in-progress', 'review'),
  ev(
    'BL-17',
    at('Oct', 23, 15, 18),
    'm8',
    'status',
    'review',
    'done',
    'Merged PR #151 and released 7c20be1',
  ),
  ev('BL-22', at('Oct', 7, 12, 1), 'm3', 'assignee', undefined, 'm6'),
  ev('BL-22', at('Oct', 21, 9, 15), 'm6', 'status', 'backlog', 'in-progress'),
  ev('BL-18', at('Oct', 7, 12, 5), 'm3', 'assignee', undefined, 'm6'),
  ev('BL-24', at('Oct', 13, 15, 31), 'm3', 'assignee', undefined, 'm8'),
  ev('BL-24', at('Oct', 14, 9, 0), 'm8', 'status', 'backlog', 'in-progress'),
  ev('BL-24', at('Oct', 22, 16, 40), 'm8', 'status', 'in-progress', 'review'),
  ev('BL-26', at('Oct', 20, 10, 16), 'm3', 'assignee', undefined, 'm1'),
  ev('MA-38', at('Oct', 1, 9, 21), 'm3', 'assignee', undefined, 'm9'),
  ev('MA-38', at('Oct', 5, 10, 0), 'm9', 'status', 'backlog', 'in-progress'),
  ev('MA-38', at('Oct', 15, 14, 0), 'm3', 'due', 'Oct 16', 'Oct 20', 'Empty states added to scope'),
  ev('MA-36', at('Oct', 12, 13, 46), 'm11', 'assignee', undefined, 'm7'),
  ev('MA-36', at('Oct', 20, 11, 0), 'm7', 'status', 'in-progress', 'review'),
  ev('MA-44', at('Oct', 21, 8, 11), 'm11', 'assignee', undefined, 'm11'),
  ev('MA-44', at('Oct', 21, 8, 40), 'm11', 'status', 'backlog', 'in-progress'),
  ev('MA-44', at('Oct', 22, 10, 30), 'm11', 'priority', 'high', 'urgent'),
  ev('MA-41', at('Oct', 6, 10, 1), 'm3', 'assignee', undefined, 'm5'),
  ev('MA-40', at('Oct', 6, 10, 6), 'm3', 'assignee', undefined, 'm8'),
  ev('MA-35', at('Sep', 30, 11, 31), 'm9', 'assignee', undefined, 'm9'),
  ev('MA-35', at('Oct', 14, 17, 20), 'm7', 'status', 'review', 'done'),
];

export const seedComments: TaskComment[] = [
  {
    id: 'tc1',
    taskKey: 'RB-212',
    author: 'm2',
    text: 'Scope check: reset links should expire after 30 minutes and be single-use.',
    at: at('Oct', 20, 10, 5),
  },
  {
    id: 'tc2',
    taskKey: 'RB-212',
    author: 'm5',
    text: 'Done. Tokens are hashed at rest; PR #148 is up.',
    at: at('Oct', 21, 15, 10),
  },
  {
    id: 'tc3',
    taskKey: 'RB-212',
    author: 'm10',
    text: 'Staging deploy failed on the migration, so I can’t test yet.',
    at: at('Oct', 23, 10, 30),
  },
  {
    id: 'tc4',
    taskKey: 'RB-221',
    author: 'm5',
    text: 'Requested changes — the retry cap should be configurable per plan.',
    at: at('Oct', 22, 14, 12),
  },
  {
    id: 'tc5',
    taskKey: 'MA-38',
    author: 'm3',
    text: 'This is blocking invite emails. Can we split the empty states out?',
    at: at('Oct', 22, 9, 48),
  },
  {
    id: 'tc6',
    taskKey: 'RB-231',
    author: 'm2',
    text: 'Can we lock the Payments v2 scope before the Nov 6 release?',
    at: at('Oct', 23, 15, 18),
  },
];

export const seedSubtasks: Subtask[] = [
  {
    id: 'st1',
    taskKey: 'RB-212',
    title: 'Token table + migration',
    done: true,
    doneBy: 'm5',
    doneAt: at('Oct', 15, 16, 0),
  },
  {
    id: 'st2',
    taskKey: 'RB-212',
    title: 'Reset email template',
    done: true,
    doneBy: 'm9',
    doneAt: at('Oct', 17, 11, 30),
  },
  {
    id: 'st3',
    taskKey: 'RB-212',
    title: 'Rate-limit reset requests',
    done: true,
    doneBy: 'm5',
    doneAt: at('Oct', 21, 10, 0),
  },
  { id: 'st4', taskKey: 'RB-212', title: 'QA on staging', done: false },
  {
    id: 'st5',
    taskKey: 'RB-221',
    title: 'Backoff policy (max 4 attempts)',
    done: true,
    doneBy: 'm4',
    doneAt: at('Oct', 20, 12, 0),
  },
  { id: 'st6', taskKey: 'RB-221', title: 'Per-plan retry cap', done: false },
  { id: 'st7', taskKey: 'RB-221', title: 'Dunning email copy', done: false },
  {
    id: 'st8',
    taskKey: 'MA-38',
    title: 'Welcome screen',
    done: true,
    doneBy: 'm9',
    doneAt: at('Oct', 10, 15, 0),
  },
  { id: 'st9', taskKey: 'MA-38', title: 'Invite teammates step', done: false },
  { id: 'st10', taskKey: 'MA-38', title: 'Empty states', done: false },
  {
    id: 'st11',
    taskKey: 'RB-231',
    title: 'Review spec with Daniel',
    done: true,
    doneBy: 'm1',
    doneAt: at('Oct', 22, 11, 0),
  },
  { id: 'st12', taskKey: 'RB-231', title: 'Confirm invoice export scope', done: false },
];

export const seedTimeLogs: TimeLog[] = [
  {
    id: 'tl1',
    taskKey: 'RB-212',
    member: 'm5',
    minutes: 360,
    at: at('Oct', 15, 18, 0),
    note: 'Token model and migration',
  },
  {
    id: 'tl2',
    taskKey: 'RB-212',
    member: 'm5',
    minutes: 300,
    at: at('Oct', 21, 17, 0),
    note: 'Rate limiting + tests',
  },
  { id: 'tl3', taskKey: 'RB-221', member: 'm4', minutes: 240, at: at('Oct', 20, 17, 30) },
  {
    id: 'tl4',
    taskKey: 'RB-221',
    member: 'm4',
    minutes: 180,
    at: at('Oct', 22, 16, 0),
    note: 'Addressing review',
  },
  { id: 'tl5', taskKey: 'MA-38', member: 'm9', minutes: 420, at: at('Oct', 12, 17, 0) },
  { id: 'tl6', taskKey: 'BL-17', member: 'm6', minutes: 600, at: at('Oct', 14, 18, 0) },
  {
    id: 'tl7',
    taskKey: 'RB-231',
    member: 'm1',
    minutes: 90,
    at: at('Oct', 22, 12, 0),
    note: 'Spec review',
  },
  {
    id: 'tl8',
    taskKey: 'MA-44',
    member: 'm11',
    minutes: 150,
    at: at('Oct', 23, 11, 0),
    note: 'Load test repro',
  },
];
