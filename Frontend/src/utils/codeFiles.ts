export interface TreeNode {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  children: TreeNode[];
}

export interface CodeSymbol {
  name: string;
  kind: 'function' | 'const' | 'type' | 'class' | 'heading';
  line: number;
}

/** Nested folder tree from flat paths — folders first, then files, alphabetically. */
export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'dir', children: [] };
  paths.forEach((p) => {
    const parts = p.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      let child = node.children.find(
        (c) => c.name === part && c.kind === (isFile ? 'file' : 'dir'),
      );
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          kind: isFile ? 'file' : 'dir',
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    });
  });
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    [...nodes]
      .sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
      )
      .map((n) => ({ ...n, children: sort(n.children) }));
  return sort(root.children);
}

const symbolRules: { re: RegExp; kind: CodeSymbol['kind'] }[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/, kind: 'function' },
  { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: 'class' },
  { re: /^\s*(?:export\s+)?(?:interface|type|enum)\s+(\w+)/, kind: 'type' },
  { re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)/, kind: 'const' },
];

/** Top-level symbols for the Outline view and breadcrumbs. */
export function outlineOf(path: string, content: string): CodeSymbol[] {
  const lines = content.split('\n');
  if (path.endsWith('.md')) {
    return lines.flatMap((l, i) => {
      const m = l.match(/^#{1,4}\s+(.+)/);
      return m ? [{ name: m[1].trim(), kind: 'heading' as const, line: i + 1 }] : [];
    });
  }
  return lines.flatMap((l, i) => {
    for (const r of symbolRules) {
      const m = l.match(r.re);
      if (m) return [{ name: m[1], kind: r.kind, line: i + 1 }];
    }
    return [];
  });
}

const langs: Record<string, [string, string]> = {
  ts: ['typescript', 'TypeScript'],
  tsx: ['typescript', 'TypeScript JSX'],
  js: ['javascript', 'JavaScript'],
  mjs: ['javascript', 'JavaScript'],
  cjs: ['javascript', 'JavaScript'],
  jsx: ['javascript', 'JavaScript JSX'],
  json: ['json', 'JSON'],
  md: ['markdown', 'Markdown'],
  css: ['css', 'CSS'],
  html: ['html', 'HTML'],
  yml: ['yaml', 'YAML'],
  yaml: ['yaml', 'YAML'],
  py: ['python', 'Python'],
  sh: ['shell', 'Shell Script'],
};

const ext = (path: string) => path.split('.').pop()?.toLowerCase() ?? '';
export const languageOf = (path: string) => langs[ext(path)]?.[0] ?? 'plaintext';
export const languageLabel = (path: string) => langs[ext(path)]?.[1] ?? 'Plain Text';

/** Languages Monaco can format out of the box. */
export const formattable = new Set(['typescript', 'javascript', 'json', 'css', 'html']);
export const runnable = (path: string) =>
  /\.(ts|js|mjs|cjs)$/.test(path) && !path.endsWith('.d.ts');
export const isTest = (path: string) => /\.(test|spec)\.(ts|js)$/.test(path);

/** Resolves a relative import the way Node + TypeScript would, against workspace paths only. */
export function resolveImport(from: string, spec: string, paths: Set<string>): string | null {
  if (!spec.startsWith('.')) return null;
  const parts = from.split('/').slice(0, -1);
  spec.split('/').forEach((seg) => {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  });
  const base = parts.join('/');
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.json`,
    `${base}/index.ts`,
    `${base}/index.js`,
  ];
  return candidates.find((c) => paths.has(c)) ?? null;
}
