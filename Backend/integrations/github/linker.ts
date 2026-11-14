/**
 * Links pull requests to TavetaHQ tasks.
 *
 * A task key (e.g. `RB-212`) is looked for first in the branch name
 * (`feat/rb-212-password-reset`), then in the PR title. A link is only made
 * when the task exists and belongs to the repo's product, so a PR can never
 * attach itself to another product's task. The link sets `task.pr`, persists
 * the task, and records an immutable `linked` task event.
 */

import { audit } from '../../audit/auditLog.ts';
import { publish } from '../../lib/events.ts';
import { randomToken } from '../../security/crypto.ts';
import { repos } from '../../data/index.ts';
import type { Task } from '../../types.ts';
import type { PullRequestRow } from '../../domain/engineering/types.ts';

const KEY = /(?:^|[^A-Za-z0-9])([A-Za-z]{2,5})-(\d{1,6})(?=$|[^0-9])/;

export function taskKeyFrom(text: string | undefined): string | undefined {
  const m = text?.match(KEY);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : undefined;
}

/** Finds the task a PR refers to (branch first, then title), scoped to the PR's product. */
export async function findTaskFor(
  pr: Pick<PullRequestRow, 'branch' | 'title' | 'product'>,
): Promise<Task | undefined> {
  for (const source of [pr.branch, pr.title]) {
    const key = taskKeyFrom(source);
    const task = key ? await repos.tasks.get(key) : undefined;
    if (task && task.product === pr.product) return task;
  }
  return undefined;
}

/** Links the PR to its task if one matches. Returns the task key when a new link was made. */
export async function linkPullToTask(
  pr: PullRequestRow,
  actor: string,
  requestId?: string,
): Promise<string | undefined> {
  const task = await findTaskFor(pr);
  if (!task) return undefined;
  pr.taskKey = task.key;
  if (task.pr === pr.number) return undefined;
  const from = task.pr ? `PR #${task.pr}` : undefined;
  task.pr = pr.number;
  task.updatedAt = new Date().toISOString();
  await repos.tasks.put(task);
  const event = {
    id: `ev-gh-${randomToken(6)}`,
    taskKey: task.key,
    actor,
    at: task.updatedAt,
    kind: 'linked' as const,
    from,
    to: `PR #${pr.number}`,
    note: `PR #${pr.number} · ${pr.repo}`,
  };
  await repos.taskEvents.append(event);
  audit.append({
    actor,
    action: 'task.linked',
    target: `${task.key} ↔ ${pr.repo}#${pr.number}`,
    requestId,
  });
  publish('task', { key: task.key, pr: pr.number, kind: 'linked' });
  return task.key;
}
