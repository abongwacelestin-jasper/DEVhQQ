/**
 * Read projections for repos, PRs and CI runs — the exact shapes F-ENG consumes.
 * Rows are filtered so live GitHub data and the labelled demo set never mix.
 */

import { db } from '../../store/db.ts';
import { assertGithubAvailable, githubLive } from '../../integrations/github/config.ts';
import { ciForSha } from '../../integrations/github/webhook.ts';
import { ensureGithubDemo } from './demo.ts';
import { ago, ciRuns, pulls } from './store.ts';
import type { CiRun, CiStatus, PullRequestRow, Repo } from './types.ts';

/** Gate for every repo/PR/CI read: 503 when unconfigured in prod, lazy demo seed otherwise. */
export function prepareGithubRead() {
  assertGithubAvailable();
  if (!githubLive()) ensureGithubDemo();
}

/** Live mode hides demo rows; demo mode shows everything (all labelled). */
export function included(row: { source: string }): boolean {
  return githubLive() ? row.source !== 'demo' : true;
}

function repoCi(r: Repo): CiStatus {
  const runs = [...ciRuns.values()]
    .filter((x) => x.repoId === r.id && x.branch === r.defaultBranch)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (!runs.length) return r.lastCommit ? ciForSha(r.id, r.lastCommit.sha) : 'none';
  return ciForSha(r.id, runs[0].sha);
}

export function repoView(r: Repo) {
  return {
    id: r.id,
    name: r.name,
    product: r.product,
    defaultBranch: r.defaultBranch,
    language: r.language,
    private: r.private,
    url: r.url ?? null,
    openPrs: [...pulls.values()].filter((p) => p.repoId === r.id && p.state === 'open').length,
    ci: repoCi(r),
    lastCommit: r.lastCommit
      ? { ...r.lastCommit, ago: ago(r.lastCommit.at) }
      : { sha: '', message: 'No commits recorded yet', author: '', ago: '—', at: null },
    weeklyCommits: r.weeklyCommits,
    latestTag: r.latestTag,
    linkedBy: r.linkedBy,
    linkedAt: r.linkedAt,
    updatedAt: r.updatedAt,
    source: r.source,
  };
}

export function repoDetail(r: Repo) {
  const runs = [...ciRuns.values()]
    .filter((x) => x.repoId === r.id)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return {
    ...repoView(r),
    githubId: r.githubId ?? null,
    installationId: r.installationId ?? null,
    commits: r.recentCommits.map((c) => ({
      ...c,
      repo: r.name,
      ago: ago(c.at),
      ci: ciForSha(r.id, c.sha),
    })),
    branchProtection: r.branchProtection ?? null,
    recentRuns: runs.slice(0, 10).map(runView),
  };
}

export function pullView(p: PullRequestRow) {
  return {
    id: p.id,
    number: p.number,
    title: p.title,
    product: p.product,
    repo: p.repo,
    repoId: p.repoId,
    branch: p.branch,
    base: p.base,
    taskKey: p.taskKey,
    author: p.author,
    authorLogin: p.authorLogin ?? null,
    reviewers: p.reviewers,
    ci: p.ci,
    review: p.review,
    state: p.state,
    draft: p.draft,
    age: ago(p.createdAt),
    additions: p.additions,
    deletions: p.deletions,
    headSha: p.headSha,
    url: p.url ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    mergedAt: p.mergedAt ?? null,
    source: p.source,
  };
}

export function pullDetail(p: PullRequestRow) {
  const task = p.taskKey ? db.tasks.get(p.taskKey) : undefined;
  return {
    ...pullView(p),
    reviews: p.reviews,
    checks: [...ciRuns.values()]
      .filter((x) => x.repoId === p.repoId && x.sha === p.headSha)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(runView),
    task: task
      ? { key: task.key, title: task.title, status: task.status, assignee: task.assignee }
      : null,
  };
}

export function runView(r: CiRun) {
  return { ...r, url: r.url ?? null, ago: ago(r.completedAt ?? r.startedAt) };
}
