import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { repoFiles, branchesFor, type CodeFile } from '../data/codeWorkspace';
import { scanForSecrets } from '../utils/secretScan';
import { useAuth } from '../contexts/AuthContext';
import { useWork } from '../contexts/WorkContext';
import { memberById } from '../utils/status';
import type { ChangedFile, GitStatus, LintProblem, OutLine, TermLine } from '../types/ide';

export interface WorkspaceCommit {
  sha: string;
  message: string;
  branch: string;
  repo: string;
  files: number;
  signed: boolean;
  at: string;
}

let lineId = 0;
const L = (text: string, tone?: TermLine['tone']): TermLine => ({ id: ++lineId, text, tone });

/** State for the in-browser code workspace: files per branch, edits, tabs, sandboxed terminal and commits. */
export function useCodeWorkspace() {
  const { session, log } = useAuth();
  const { addComment } = useWork();
  const repos = Object.keys(repoFiles);
  const [repo, setRepo] = useState(repos[0]);
  const [extraBranches, setExtraBranches] = useState<Record<string, string[]>>({});
  const [branch, setBranch] = useState('fix/rb-221-retry-payments');
  const [store, setStore] = useState<Record<string, CodeFile[]>>({});
  const [base, setBase] = useState<Record<string, CodeFile[]>>({});
  const [tabs, setTabs] = useState<string[]>(['src/billing/retry.ts', 'playground.ts']);
  const [active, setActive] = useState('src/billing/retry.ts');
  const [commits, setCommits] = useState<WorkspaceCommit[]>([]);
  const [stashes, setStashes] = useState<{ key: string; files: CodeFile[]; label: string }[]>([]);
  const [term, setTerm] = useState<TermLine[]>([
    L(
      'DevHQ sandbox terminal — commands run against this workspace only. No network, no secrets.',
      'muted',
    ),
    L("Try 'node playground.ts', 'npm test' or 'help'.", 'muted'),
  ]);

  const branches = useMemo(
    () => [...branchesFor(repo), ...(extraBranches[repo] ?? [])],
    [repo, extraBranches],
  );
  const key = `${repo}@${branch}`;
  const original = base[key] ?? repoFiles[repo];
  const files = store[key] ?? original;
  const file = files.find((f) => f.path === active) ?? files[0];
  const taskKey = branch.match(/(rb|bl|ma)-\d+/i)?.[0].toUpperCase();

  const changes: ChangedFile[] = useMemo(() => {
    const edited = files
      .map((f) => {
        const before = original.find((o) => o.path === f.path);
        return {
          path: f.path,
          before: before?.content ?? '',
          after: f.content,
          status: (before ? 'M' : 'A') as GitStatus,
        };
      })
      .filter((c) => c.status === 'A' || c.before !== c.after);
    const deleted = original
      .filter((o) => !files.some((f) => f.path === o.path))
      .map((o) => ({ path: o.path, before: o.content, after: '', status: 'D' as GitStatus }));
    return [...edited, ...deleted];
  }, [files, original]);

  const problems: LintProblem[] = useMemo(() => {
    const secrets = scanForSecrets(files.map((f) => ({ path: f.path, content: f.content }))).map(
      (s) => ({ ...s, severity: 'error' as const }),
    );
    const lint: LintProblem[] = [];
    files.forEach((f) =>
      f.content.split('\n').forEach((line, i) => {
        if (/console\.log\(/.test(line))
          lint.push({
            file: f.path,
            line: i + 1,
            rule: 'no-console',
            preview: line.trim().slice(0, 60),
            severity: 'warning',
          });
        if (/:\s*any\b/.test(line))
          lint.push({
            file: f.path,
            line: i + 1,
            rule: 'no-explicit-any',
            preview: line.trim().slice(0, 60),
            severity: 'warning',
          });
        if (/TODO/.test(line))
          lint.push({
            file: f.path,
            line: i + 1,
            rule: 'todo-comment',
            preview: line.trim().slice(0, 60),
            severity: 'warning',
          });
      }),
    );
    return [...secrets, ...lint];
  }, [files]);

  const update = (fn: (list: CodeFile[]) => CodeFile[]) =>
    setStore((s) => ({ ...s, [key]: fn(s[key] ?? original) }));

  const edit = useCallback(
    (content: string, path?: string) => {
      const target = path ?? file.path;
      setStore((s) => ({
        ...s,
        [key]: (s[key] ?? original).map((f) => (f.path === target ? { ...f, content } : f)),
      }));
    },
    [key, original, file.path],
  );

  const open = useCallback((path: string) => {
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setActive(path);
  }, []);

  const closeTab = useCallback(
    (path: string) => {
      setTabs((t) => {
        const next = t.filter((x) => x !== path);
        if (active === path && next.length) setActive(next[next.length - 1]);
        return next;
      });
    },
    [active],
  );

  const print = useCallback(
    (lines: OutLine[]) =>
      setTerm((t) => [...t, ...lines.map((l) => L(l.text, l.tone))].slice(-1500)),
    [],
  );

  const statusOf = (path: string): GitStatus | undefined =>
    changes.find((c) => c.path === path)?.status;
  const originalOf = (path: string) => original.find((o) => o.path === path)?.content ?? '';

  const switchRepo = (r: string) => {
    setRepo(r);
    setBranch(branchesFor(r)[0]);
    const first = repoFiles[r][0].path;
    setTabs([first]);
    setActive(first);
  };

  const switchBranch = (b: string) => {
    if (b === branch) return;
    if (
      changes.length &&
      !window.confirm(
        `You have ${changes.length} uncommitted change(s) on ${branch}. They stay on that branch. Switch?`,
      )
    )
      return;
    setBranch(b);
  };

  const createBranch = (name: string) => {
    const clean = name.trim().replace(/[^a-zA-Z0-9/_.-]+/g, '-');
    if (!clean || branches.includes(clean)) return false;
    setExtraBranches((e) => ({ ...e, [repo]: [...(e[repo] ?? []), clean] }));
    setStore((s) => ({ ...s, [`${repo}@${clean}`]: files }));
    setBase((s) => ({ ...s, [`${repo}@${clean}`]: original }));
    setBranch(clean);
    log('Created branch', `${repo}:${clean}`);
    return true;
  };

  const discard = () => {
    setStore((s) => ({ ...s, [key]: original }));
    toast('Changes discarded');
  };

  const discardFile = (path: string) => {
    const before = original.find((o) => o.path === path);
    update((list) => {
      if (!before) return list.filter((f) => f.path !== path);
      return list.some((f) => f.path === path)
        ? list.map((f) => (f.path === path ? before : f))
        : [...list, before];
    });
    if (!before) closeTab(path);
  };

  const commit = ({
    message,
    signed,
    openPr,
  }: {
    message: string;
    signed: boolean;
    openPr: boolean;
  }) => {
    if (branch === 'main') {
      toast.error('Push rejected', { description: 'main is protected. Create a branch first.' });
      return false;
    }
    const sha = Math.random().toString(16).slice(2, 9);
    setBase((b) => ({ ...b, [key]: files }));
    setCommits((c) => [
      { sha, message, branch, repo, files: changes.length, signed, at: new Date().toISOString() },
      ...c,
    ]);
    setTerm((t) => [
      ...t,
      L(`$ git commit -m "${message}"`, 'cmd'),
      L(`[${branch} ${sha}] ${message}`),
      L(` ${changes.length} file(s) changed${signed ? ' · signed (SSH)' : ''}`, 'muted'),
      L(`$ git push origin ${branch}`, 'cmd'),
      L(`To github.com:${repo}.git  ${branch} -> ${branch}`, 'ok'),
    ]);
    log('Pushed commit', `${repo}@${branch} ${sha} · ${message}`, !signed);
    if (taskKey)
      addComment(taskKey, `Pushed ${sha} to ${branch} from the code workspace: “${message}”`);
    toast.success(`Pushed ${sha}`, {
      description: openPr
        ? `Pull request opened for ${branch}`
        : `${changes.length} file(s) · ${memberById(session?.memberId ?? 'm1').name}`,
    });
    return true;
  };

  const createFile = (path: string) => {
    const clean = path.trim().replace(/^\/+/, '');
    if (
      !clean ||
      clean.endsWith('/') ||
      !/^[\w./-]+$/.test(clean) ||
      files.some((f) => f.path === clean)
    )
      return false;
    update((list) => [...list, { path: clean, content: '' }]);
    open(clean);
    return true;
  };

  const renameFile = (from: string, to: string) => {
    const clean = to.trim().replace(/^\/+/, '');
    if (
      !clean ||
      clean === from ||
      !/^[\w./-]+$/.test(clean) ||
      files.some((f) => f.path === clean)
    )
      return false;
    update((list) => list.map((f) => (f.path === from ? { ...f, path: clean } : f)));
    setTabs((t) => t.map((x) => (x === from ? clean : x)));
    if (active === from) setActive(clean);
    return true;
  };

  const deleteFile = (path: string) => {
    if (files.length <= 1) return false;
    update((list) => list.filter((f) => f.path !== path));
    closeTab(path);
    return true;
  };

  const replaceFiles = (edits: { path: string; content: string }[]) => {
    const map = new Map(edits.map((e) => [e.path, e.content]));
    update((list) =>
      list.map((f) => (map.has(f.path) ? { ...f, content: map.get(f.path) as string } : f)),
    );
  };

  const stash = () => {
    if (!changes.length) return false;
    setStashes((st) => [
      { key, files, label: `WIP on ${branch}: ${changes.length} file(s)` },
      ...st,
    ]);
    setStore((s) => ({ ...s, [key]: original }));
    return true;
  };

  const popStash = () => {
    const i = stashes.findIndex((s) => s.key === key);
    if (i < 0) return false;
    setStore((s) => ({ ...s, [key]: stashes[i].files }));
    setStashes((st) => st.filter((_, x) => x !== i));
    return true;
  };

  const findFile = (name?: string) =>
    files.find((x) => x.path === name || (!!name && x.path.endsWith(`/${name}`)));

  /** Built-in shell commands. `node`, `npm test` and `tsc` are handled by the workbench, which runs real code. */
  const run = (cmd: string) => {
    const out: TermLine[] = [L(`$ ${cmd}`, 'cmd')];
    const [c, ...args] = cmd.split(/\s+/);
    if (c === 'help') {
      [
        'Run       node <file> · npm test · npx tsc --noEmit',
        'Files     ls · cat <file> · code <file> · touch <file> · rm <file> · mv <from> <to> · grep <text> · wc <file> · pwd',
        'Git       git status · git diff · git log · git branch · git checkout [-b] <branch> · git stash [pop|list]',
        'Checks    npm run lint · scan',
        'Other     whoami · date · echo <text> · history · clear (Ctrl+L)',
      ].forEach((h) => out.push(L(h, 'muted')));
    } else if (c === 'clear') return setTerm([]);
    else if (c === 'pwd') out.push(L(`/workspace/${repo.split('/')[1]}`));
    else if (c === 'date') out.push(L(new Date().toString()));
    else if (c === 'echo') out.push(L(args.join(' ')));
    else if (c === 'history')
      term
        .filter((t) => t.tone === 'cmd' && t.text.startsWith('$ '))
        .slice(-15)
        .forEach((t, i) =>
          out.push(L(`  ${String(i + 1).padStart(3)}  ${t.text.slice(2)}`, 'muted')),
        );
    else if (c === 'code' || c === 'open') {
      const f = findFile(args[0]);
      if (f) {
        open(f.path);
        out.push(L(`Opened ${f.path}`, 'ok'));
      } else out.push(L(`code: ${args[0] ?? ''}: no such file`, 'bad'));
    } else if (c === 'touch')
      out.push(
        args[0] && createFile(args[0])
          ? L(`Created ${args[0]}`, 'ok')
          : L(`touch: cannot create '${args[0] ?? ''}'`, 'bad'),
      );
    else if (c === 'rm' && !args.some((a) => a.startsWith('-'))) {
      const f = findFile(args[0]);
      out.push(
        f && deleteFile(f.path)
          ? L(`removed '${f.path}'`, 'ok')
          : L(`rm: cannot remove '${args[0] ?? ''}'`, 'bad'),
      );
    } else if (c === 'mv') {
      const f = findFile(args[0]);
      out.push(
        f && args[1] && renameFile(f.path, args[1])
          ? L(`renamed '${f.path}' -> '${args[1]}'`, 'ok')
          : L('mv: invalid source or destination', 'bad'),
      );
    } else if (c === 'wc') {
      const f = findFile(args[0]);
      out.push(
        f
          ? L(
              `  ${f.content.split('\n').length} lines  ${f.content.split(/\s+/).filter(Boolean).length} words  ${f.content.length} chars  ${f.path}`,
            )
          : L(`wc: ${args[0] ?? ''}: no such file`, 'bad'),
      );
    } else if (c === 'grep') {
      const needle = args.join(' ').replace(/^["']|["']$/g, '');
      if (!needle) out.push(L('usage: grep <text>', 'bad'));
      else {
        let n = 0;
        files.forEach((f) =>
          f.content.split('\n').forEach((line, i) => {
            if (line.toLowerCase().includes(needle.toLowerCase()) && n < 40) {
              n++;
              out.push(L(`${f.path}:${i + 1}: ${line.trim()}`));
            }
          }),
        );
        if (!n) out.push(L('no matches', 'muted'));
      }
    } else if (cmd === 'git diff') {
      if (!changes.length) out.push(L('no changes', 'muted'));
      changes.forEach((ch) => {
        out.push(L(`diff --git a/${ch.path} b/${ch.path}`, 'muted'));
        const a = ch.before.split('\n');
        const b = ch.after.split('\n');
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          if (a[i] !== b[i]) {
            if (a[i] !== undefined && ch.status !== 'A') out.push(L(`- ${a[i]}`, 'bad'));
            if (b[i] !== undefined && ch.status !== 'D') out.push(L(`+ ${b[i]}`, 'ok'));
          }
        }
      });
    } else if (c === 'git' && args[0] === 'checkout') {
      const target = args[1] === '-b' ? args[2] : args[1];
      if (args[1] === '-b')
        out.push(
          target && createBranch(target)
            ? L(`Switched to a new branch '${target}'`, 'ok')
            : L('fatal: invalid or existing branch name', 'bad'),
        );
      else if (target && branches.includes(target)) {
        setBranch(target);
        out.push(L(`Switched to branch '${target}'`, 'ok'));
      } else out.push(L(`error: pathspec '${target ?? ''}' did not match any branch`, 'bad'));
    } else if (c === 'git' && args[0] === 'stash') {
      if (args[1] === 'pop')
        out.push(
          popStash()
            ? L('Restored stashed changes', 'ok')
            : L('No stash entries for this branch', 'bad'),
        );
      else if (args[1] === 'list') {
        if (!stashes.length) out.push(L('no stashes', 'muted'));
        stashes.forEach((s, i) => out.push(L(`stash@{${i}}: ${s.label}`)));
      } else
        out.push(
          stash()
            ? L(`Saved working directory: WIP on ${branch}`, 'ok')
            : L('No local changes to save', 'muted'),
        );
    } else if (c === 'ls') files.forEach((f) => out.push(L(f.path)));
    else if (c === 'cat') {
      const f = findFile(args[0]);
      out.push(f ? L(f.content) : L(`cat: ${args[0] ?? ''}: no such file`, 'bad'));
    } else if (c === 'whoami')
      out.push(
        L(`${memberById(session?.memberId ?? 'm1').email} · sandbox · no network, no secrets`),
      );
    else if (cmd === 'git status') {
      out.push(L(`On branch ${branch}`));
      if (changes.length)
        changes.forEach((ch) =>
          out.push(
            L(
              `  ${ch.status === 'A' ? 'new file' : ch.status === 'D' ? 'deleted' : 'modified'}:   ${ch.path}`,
              'bad',
            ),
          ),
        );
      else out.push(L('nothing to commit, working tree clean', 'ok'));
    } else if (cmd === 'git log') {
      commits
        .filter((x) => x.repo === repo)
        .forEach((x) => out.push(L(`${x.sha} ${x.message} (${x.branch})`)));
      out.push(L('a41f9c2 fix(billing): retry failed webhooks', 'muted'));
    } else if (cmd === 'git branch')
      branches.forEach((b) =>
        out.push(L(`${b === branch ? '* ' : '  '}${b}`, b === branch ? 'ok' : undefined)),
      );
    else if (cmd === 'npm run lint') {
      const lint = problems.filter((p) => p.severity === 'warning');
      if (!lint.length) out.push(L('✓ No lint problems', 'ok'));
      lint.forEach((p) => out.push(L(`${p.file}:${p.line}  warning  ${p.rule}`, 'warn')));
    } else if (c === 'scan') {
      const s = problems.filter((p) => p.severity === 'error');
      out.push(
        L(
          s.length ? `✗ ${s.length} secret(s) found` : '✓ Secret scan clean',
          s.length ? 'bad' : 'ok',
        ),
      );
      s.forEach((p) => out.push(L(`  ${p.file}:${p.line} ${p.rule} ${p.preview}`, 'bad')));
    } else if (/^(rm|curl|wget|ssh|sudo|env|printenv|npm|npx|yarn|pnpm)\b/.test(c))
      out.push(L(`${cmd}: not available in the sandbox`, 'bad'));
    else out.push(L(`${c}: command not found — try 'help'`, 'bad'));
    setTerm((t) => [...t, ...out]);
  };

  return {
    repos,
    repo,
    switchRepo,
    branches,
    branch,
    switchBranch,
    createBranch,
    createFile,
    renameFile,
    deleteFile,
    replaceFiles,
    stash,
    popStash,
    stashes,
    files,
    file,
    edit,
    tabs,
    active,
    open,
    closeTab,
    setActive,
    changes,
    statusOf,
    originalOf,
    discard,
    discardFile,
    commit,
    commits,
    problems,
    term,
    run,
    print,
    taskKey,
  };
}
