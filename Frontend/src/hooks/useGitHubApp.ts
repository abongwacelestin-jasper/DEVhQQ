import { useCallback, useEffect, useState } from 'react';
import { repositories } from '../data/engineering';
import type { Repository } from '../types/engineering';
import type { ProductId } from '../types/portfolio';

export interface GitHubInstallation {
  org: string;
  access: 'all' | 'selected';
  permissions: Record<string, 'read' | 'write' | 'none'>;
  webhook: boolean;
  events?: string[];
  installedAt: string;
  suspended: boolean;
}

export const availableRepos: { name: string; language: string; suggested?: ProductId }[] = [
  { name: 'techorg/infra', language: 'HCL' },
  { name: 'techorg/design-tokens', language: 'TypeScript', suggested: 'mirror' },
  { name: 'blog/marketing-site', language: 'Astro', suggested: 'blog' },
  { name: 'mirror-acture/api', language: 'Go', suggested: 'mirror' },
];

export const githubPermissions = [
  {
    id: 'contents',
    label: 'Repository contents',
    hint: 'Read code for search and the code workspace',
    default: 'read' as const,
    allowWrite: true,
  },
  {
    id: 'pull_requests',
    label: 'Pull requests',
    hint: 'Link PRs to tasks; write lets DevHQ open PRs',
    default: 'read' as const,
    allowWrite: true,
  },
  {
    id: 'checks',
    label: 'Checks & CI status',
    hint: 'Show CI on tasks and PRs',
    default: 'read' as const,
    allowWrite: false,
  },
  {
    id: 'metadata',
    label: 'Metadata',
    hint: 'Required by GitHub',
    default: 'read' as const,
    allowWrite: false,
  },
  {
    id: 'administration',
    label: 'Administration',
    hint: 'Never requested — branch rules stay in GitHub',
    default: 'none' as const,
    allowWrite: false,
  },
];

const KEY = 'devhq.github-app';
const REPOS = 'devhq.github-repos';

function read<T>(k: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const defaultInstall: GitHubInstallation = {
  org: 'techorg',
  access: 'selected',
  permissions: Object.fromEntries(githubPermissions.map((p) => [p.id, p.default])),
  webhook: true,
  installedAt: '2026-06-02T10:00:00.000Z',
  suspended: false,
};

/** GitHub App installation + the repositories it grants, persisted for the browser session. */
export function useGitHubApp() {
  const [installation, setInstallation] = useState<GitHubInstallation>(() =>
    read(KEY, defaultInstall),
  );
  const [extra, setExtra] = useState<Repository[]>(() => read(REPOS, []));
  const [removed, setRemoved] = useState<string[]>(() => read(`${REPOS}.removed`, []));

  useEffect(() => {
    sessionStorage.setItem(KEY, JSON.stringify(installation));
  }, [installation]);
  useEffect(() => {
    sessionStorage.setItem(REPOS, JSON.stringify(extra));
  }, [extra]);
  useEffect(() => {
    sessionStorage.setItem(`${REPOS}.removed`, JSON.stringify(removed));
  }, [removed]);

  const repos = [...repositories, ...extra].filter((r) => !removed.includes(r.name));

  const connect = useCallback((list: { name: string; product: ProductId; language: string }[]) => {
    setExtra((l) => [
      ...l.filter((x) => !list.some((n) => n.name === x.name)),
      ...list.map((n) => ({
        name: n.name,
        product: n.product,
        defaultBranch: 'main',
        language: n.language,
        openPrs: 0,
        ci: 'none' as const,
        lastCommit: { sha: '—', message: 'Initial sync pending', author: 'm1', ago: 'now' },
        weeklyCommits: [0, 0, 0, 0, 0, 0, 0, 0],
        latestTag: '—',
      })),
    ]);
    setRemoved((r) => r.filter((x) => !list.some((n) => n.name === x)));
  }, []);

  const disconnect = useCallback((name: string) => {
    setExtra((l) => l.filter((x) => x.name !== name));
    setRemoved((r) => Array.from(new Set([...r, name])));
  }, []);

  return { installation, setInstallation, repos, connect, disconnect };
}
