/** Static install instructions for the TavetaHQ CLI and git hooks. Copy only — no state. */
export const cliTools = [
  {
    id: 'cli',
    name: 'TavetaHQ CLI',
    cmd: 'npm i -g @devhq/cli && devhq login',
    detail: 'Branch from tasks, log time and see deploy status from your terminal.',
  },
  {
    id: 'hook',
    name: 'Pre-commit secret scan',
    cmd: 'devhq hooks install',
    detail: 'Blocks commits containing keys, tokens or private keys.',
  },
  {
    id: 'gh',
    name: 'Git commit template',
    cmd: 'devhq git template --task',
    detail: 'Pre-fills commit messages with the task key from your branch name.',
  },
] as const;

/** `GET /api/tokens` item (SEC lane: scoped personal access tokens, hashed at rest). */
export interface ApiAccessToken {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}
