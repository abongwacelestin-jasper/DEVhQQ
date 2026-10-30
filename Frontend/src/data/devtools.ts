export interface IdeOption {
  id: string;
  name: string;
  short: string;
  color: string;
  scheme: string;
  install: string;
  features: string[];
}

export const ideOptions: IdeOption[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    short: 'VS',
    color: '#0B5E99',
    scheme: 'vscode',
    install: 'code --install-extension devhq.devhq',
    features: [
      'Task sidebar',
      'Branch from task',
      'Pre-commit secret scan',
      'PR status in status bar',
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    short: 'Cu',
    color: '#0F1115',
    scheme: 'cursor',
    install: 'cursor --install-extension devhq.devhq',
    features: [
      'Task sidebar',
      'Branch from task',
      'Pre-commit secret scan',
      'AI context limited to your product access',
    ],
  },
  {
    id: 'jetbrains',
    name: 'JetBrains IDEs',
    short: 'JB',
    color: '#B42318',
    scheme: 'jetbrains',
    install: 'Settings → Plugins → Marketplace → “DevHQ”',
    features: ['Task tool window', 'Commit message templates', 'Pre-commit secret scan'],
  },
  {
    id: 'zed',
    name: 'Zed',
    short: 'Z',
    color: '#4F46E5',
    scheme: 'zed',
    install: 'zed: install extension devhq',
    features: ['Task picker', 'Branch from task'],
  },
  {
    id: 'neovim',
    name: 'Neovim',
    short: 'Nv',
    color: '#137333',
    scheme: 'nvim',
    install: "{ 'devhq/devhq.nvim' }  -- lazy.nvim",
    features: ['Telescope task picker', 'Commit linting'],
  },
];

export interface DevConnection {
  id: string;
  ideId: string;
  device: string;
  connectedAt: string;
  lastUsed: string;
  scopes: string[];
}

export const devScopes = [
  { id: 'tasks:read', label: 'Read assigned tasks', required: true },
  { id: 'tasks:write', label: 'Update task status and log time', required: false },
  { id: 'repo:read', label: 'Read repository metadata', required: true },
  { id: 'pr:write', label: 'Open pull requests', required: false },
  { id: 'deploy:read', label: 'See deployment status', required: false },
];

export const seedConnections: DevConnection[] = [
  {
    id: 'dc1',
    ideId: 'vscode',
    device: 'MacBook Pro · Kofi',
    connectedAt: '2026-09-14T10:00:00.000Z',
    lastUsed: '12m ago',
    scopes: ['tasks:read', 'tasks:write', 'repo:read', 'pr:write'],
  },
];

export const cliTools = [
  {
    id: 'cli',
    name: 'DevHQ CLI',
    cmd: 'npm i -g @devhq/cli && devhq login',
    detail: 'Branch from tasks, log time and see deploy status from your terminal.',
  },
  {
    id: 'hook',
    name: 'Pre-commit secret scan',
    cmd: 'devhq hooks install',
    detail: 'Blocks commits containing keys, tokens or private keys. Required by workspace policy.',
  },
  {
    id: 'gh',
    name: 'Git commit template',
    cmd: 'devhq git template --task',
    detail: 'Pre-fills commit messages with the task key from your branch name.',
  },
];
