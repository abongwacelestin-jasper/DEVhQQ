import { useMemo } from 'react';
import { useGitHubAppStatus, useRepos } from '../components/engineering/data/hooks';
import type { ApiRepo } from '../components/engineering/data/types';
import type { Repository } from '../types/engineering';

/**
 * GitHub App installation status (`GET /api/github/app`) and the repositories
 * the server has linked (`GET /api/repos`).
 *
 * The installation itself is configured on GitHub (permissions, repository
 * selection, suspension); DevHQ only reads it. Nothing is kept in browser
 * storage and nothing is synthesised when the server has no answer.
 */

/** Adapter for older consumers that expect the presentational `Repository` shape. */
export function toRepository(r: ApiRepo): Repository {
  return {
    name: r.name,
    product: r.product,
    defaultBranch: r.defaultBranch,
    language: r.language ?? '—',
    openPrs: r.openPrs ?? 0,
    ci: r.ci ?? 'none',
    lastCommit: r.lastCommit
      ? {
          sha: r.lastCommit.sha.slice(0, 7),
          message: r.lastCommit.message,
          author: r.lastCommit.author,
          ago: r.lastCommit.at,
        }
      : { sha: '—', message: '—', author: '', ago: '—' },
    weeklyCommits: r.weeklyCommits ?? [],
    latestTag: r.latestTag ?? '—',
  };
}

/** Permission rows shown for the installation, in display order. Presentation only. */
export const githubPermissions = [
  { id: 'contents', label: 'Repository contents' },
  { id: 'pull_requests', label: 'Pull requests' },
  { id: 'checks', label: 'Checks & CI status' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'administration', label: 'Administration' },
] as const;

export function useGitHubApp() {
  const app = useGitHubAppStatus();
  const repoList = useRepos();
  const repos = useMemo(() => repoList.items.map(toRepository), [repoList.items]);
  return { app, repoList, repos };
}
