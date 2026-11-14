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
    install: 'Settings → Plugins → Marketplace → “TavetaHQ”',
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
