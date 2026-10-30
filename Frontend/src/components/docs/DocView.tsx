import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  BoldIcon,
  CheckIcon,
  CheckSquareIcon,
  CodeIcon,
  CopyPlusIcon,
  DownloadIcon,
  EyeIcon,
  GitCompareIcon,
  HeadingIcon,
  HistoryIcon,
  LinkIcon,
  ListIcon,
  LockIcon,
  MessageSquareIcon,
  PencilIcon,
  QuoteIcon,
  StarIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { ProductMark } from '../ui/ProductMark';
import { Segmented } from '../ui/Segmented';
import { DocRenderer, slug } from './DocRenderer';
import { useDocs } from '../../contexts/DocsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useReauth } from '../../contexts/ReauthContext';
import { useWork } from '../../contexts/WorkContext';
import { useStarredDocs } from '../../hooks/useStarredDocs';
import { projects } from '../../data/work';
import { docKindMeta } from '../../data/docs';
import { firstName, memberById, taskStatusMeta } from '../../utils/status';
import { formatDateTime, relative } from '../../utils/date';
import type { DocStatus, ProjectDoc } from '../../types/docs';

type RailTab = 'outline' | 'linked' | 'versions' | 'comments';
export const statusTone: Record<DocStatus, string> = {
  draft: 'bg-sunken text-ink',
  'in-review': 'bg-warn-soft text-warn',
  published: 'bg-ok-soft text-ok',
};

const tools: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  before: string;
  after?: string;
  line?: boolean;
}[] = [
  { label: 'Section heading', icon: HeadingIcon, before: '## ', line: true },
  { label: 'Bold', icon: BoldIcon, before: '**', after: '**' },
  { label: 'List item', icon: ListIcon, before: '- ', line: true },
  { label: 'Checklist item', icon: CheckSquareIcon, before: '- [ ] ', line: true },
  { label: 'Note', icon: QuoteIcon, before: '> ', line: true },
  { label: 'Code block', icon: CodeIcon, before: '```\n', after: '\n```' },
];

/** Line-level diff between two versions — enough to see what a save changed. */
function diffLines(a: string, b: string) {
  const A = a.split('\n');
  const B = b.split('\n');
  const out: { t: 'same' | 'add' | 'del'; s: string }[] = [];
  const setB = new Set(B);
  const setA = new Set(A);
  A.forEach((l) => out.push({ t: setB.has(l) ? 'same' : 'del', s: l }));
  B.forEach((l) => !setA.has(l) && out.push({ t: 'add', s: l }));
  return out.filter((x) => x.t !== 'same' || x.s.trim()).slice(0, 200);
}

export function DocView({ doc }: { doc: ProjectDoc }) {
  const { save, update, restore, comment, resolveComment, remove, create } = useDocs();
  const { canDo, session, log } = useAuth();
  const { requestReauth } = useReauth();
  const { tasks } = useWork();
  const { isStarred, toggle } = useStarredDocs();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const editing = params.get('edit') === '1';
  const [draft, setDraft] = useState(doc.body);
  const [title, setTitle] = useState(doc.title);
  const [summary, setSummary] = useState('');
  const [rail, setRail] = useState<RailTab>('outline');
  const [note, setNote] = useState('');
  const [compare, setCompare] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const me = session?.memberId ?? 'm1';
  const canEdit =
    canDo('doc:create') && (doc.visibility !== 'restricted' || doc.editors.includes(me));
  const project = projects.find((p) => p.id === doc.projectId);
  const dirty = draft !== doc.body || title !== doc.title;
  const words = doc.body.split(/\s+/).filter(Boolean).length;

  useEffect(() => {
    setDraft(doc.body);
    setTitle(doc.title);
    setCompare(null);
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEdit = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set('edit', '1');
    else next.delete('edit');
    setParams(next, { replace: true });
  };

  const doSave = () => {
    if (!dirty) return;
    save(doc.id, draft, title.trim() || doc.title, summary.trim());
    setSummary('');
    setEdit(false);
    toast.success('Saved', { description: `Version ${doc.versions.length + 1} recorded` });
  };

  const insert = (t: (typeof tools)[number]) => {
    const el = areaRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = draft.slice(s, e);
    const lineStart = t.line ? draft.lastIndexOf('\n', s - 1) + 1 : s;
    const next = t.line
      ? draft.slice(0, lineStart) + t.before + draft.slice(lineStart)
      : draft.slice(0, s) + t.before + sel + (t.after ?? '') + draft.slice(e);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = t.line ? e + t.before.length : s + t.before.length + sel.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const toggleLine = (i: number) => {
    if (!canEdit) return;
    const lines = doc.body.split('\n');
    lines[i] = lines[i].replace(/^- \[( |x)\]/, (m) => (m === '- [x]' ? '- [ ]' : '- [x]'));
    save(doc.id, lines.join('\n'), doc.title, 'Toggled checklist item');
  };

  const exportMd = () => {
    const url = URL.createObjectURL(
      new Blob([`# ${doc.title}\n\n${doc.body}\n`], { type: 'text/markdown' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(doc.title) || 'doc'}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported as Markdown');
  };

  const duplicate = async () => {
    let copy;
    try {
      copy = await create({
        projectId: doc.projectId,
        product: doc.product,
        title: `${doc.title} (copy)`,
        kind: doc.kind,
        visibility: doc.visibility,
        body: doc.body,
      });
    } catch (e) {
      toast.error('Could not duplicate the doc', {
        description: e instanceof Error ? e.message : 'The docs API did not respond.',
      });
      return;
    }
    log('Duplicated doc', doc.title);
    toast.success('Duplicate created as a draft');
    navigate(`/docs/${copy.id}?edit=1`);
  };

  const outline = doc.body
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3));
  const checks = doc.body.split('\n').filter((l) => /^- \[( |x)\]/.test(l));
  const linkedKeys = Array.from(new Set(doc.body.match(/\b(?:RB|BL|MA)-\d+\b/g) ?? []));
  const linked = linkedKeys.map((k) => ({ key: k, task: tasks.find((t) => t.key === k) }));
  const compareVersion = doc.versions.find((v) => v.id === compare);

  return (
    <div className="flex min-w-0 flex-1 flex-col xl:flex-row">
      <article className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2">
          <Link
            to="/docs"
            className="rounded-md p-1 text-muted hover:bg-sunken lg:hidden"
            aria-label="Back to docs"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </Link>
          <ProductMark product={doc.product} size="sm" />
          <span className="min-w-0 truncate text-[12px] text-muted">{project?.name}</span>
          <span
            className={`rounded px-1.5 py-px text-[11px] font-semibold ${docKindMeta[doc.kind].color}`}
          >
            {docKindMeta[doc.kind].label}
          </span>
          <select
            value={doc.status}
            disabled={!canEdit}
            onChange={(e) => {
              const s = e.target.value as DocStatus;
              if (s === 'published' && !canDo('doc:publish'))
                return toast.error('Only project managers and admins can publish');
              update(doc.id, { status: s });
              log('Changed doc status', `${doc.title} → ${s}`);
            }}
            aria-label="Status"
            className={`h-6 rounded border-0 px-1.5 text-[11px] font-semibold capitalize ${statusTone[doc.status]}`}
          >
            <option value="draft">Draft</option>
            <option value="in-review">In review</option>
            <option value="published">Published</option>
          </select>
          <select
            value={doc.visibility}
            disabled={!canEdit}
            onChange={(e) => {
              update(doc.id, { visibility: e.target.value as ProjectDoc['visibility'] });
              log(
                'Changed doc visibility',
                `${doc.title} → ${e.target.value}`,
                e.target.value === 'workspace',
              );
            }}
            aria-label="Visibility"
            className="h-6 rounded border border-line bg-white px-1 text-[11px] text-ink"
          >
            <option value="project">Project members</option>
            <option value="workspace">Whole workspace</option>
            <option value="restricted">Editors only</option>
          </select>
          <span className="hidden items-center gap-1 text-[11.5px] text-muted sm:inline-flex">
            {doc.visibility === 'restricted' ? (
              <LockIcon className="h-3 w-3" />
            ) : doc.visibility === 'workspace' ? (
              <EyeIcon className="h-3 w-3" />
            ) : (
              <UsersIcon className="h-3 w-3" />
            )}
            {words} words · {Math.max(1, Math.round(words / 220))} min read
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              aria-label={isStarred(doc.id) ? 'Unstar' : 'Star'}
              icon={
                <StarIcon
                  className={`h-3.5 w-3.5 ${isStarred(doc.id) ? 'fill-warn text-warn' : ''}`}
                />
              }
              onClick={() => toggle(doc.id)}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label="Copy link"
              icon={<LinkIcon className="h-3.5 w-3.5" />}
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href.split('?')[0]);
                toast.success('Link copied — only people with access can open it');
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label="Export Markdown"
              icon={<DownloadIcon className="h-3.5 w-3.5" />}
              onClick={exportMd}
            />
            {canDo('doc:create') && (
              <Button
                size="sm"
                variant="ghost"
                aria-label="Duplicate"
                icon={<CopyPlusIcon className="h-3.5 w-3.5" />}
                onClick={duplicate}
              />
            )}
            {canEdit && !editing && (
              <Button
                size="sm"
                icon={<PencilIcon className="h-3.5 w-3.5" />}
                onClick={() => setEdit(true)}
              >
                Edit
              </Button>
            )}
            {canDo('doc:publish') && (
              <Button
                size="sm"
                variant="ghost"
                aria-label="Delete doc"
                icon={<Trash2Icon className="h-3.5 w-3.5" />}
                onClick={() =>
                  requestReauth({
                    title: `Delete “${doc.title}”`,
                    description: 'All versions and comments are removed permanently.',
                    actionLabel: 'Verify & delete',
                    onConfirm: () => {
                      remove(doc.id);
                      log('Deleted doc', doc.title, true);
                      toast('Doc deleted');
                      navigate('/docs');
                    },
                  })
                }
              />
            )}
          </div>
        </header>

        {editing ? (
          <div className="p-3.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Title"
              className="mb-2 w-full rounded-md border border-line px-2.5 py-1.5 text-[16px] font-semibold text-ink outline-none focus:border-accent"
            />
            <div
              role="toolbar"
              aria-label="Formatting"
              className="mb-1.5 flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-sunken/40 p-0.5"
            >
              {tools.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => insert(t)}
                  title={t.label}
                  aria-label={t.label}
                  className="rounded p-1.5 text-muted hover:bg-white hover:text-ink"
                >
                  <t.icon className="h-3.5 w-3.5" />
                </button>
              ))}
              <span className="ml-auto pr-2 text-[11px] text-muted">
                {draft.split(/\s+/).filter(Boolean).length} words · ⌘S to save
              </span>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              <textarea
                ref={areaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    doSave();
                  }
                }}
                aria-label="Doc content"
                className="min-h-[420px] w-full resize-y rounded-md border border-line bg-sunken/30 p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none focus:border-accent"
              />

              <div className="hidden rounded-md border border-dashed border-line p-3 xl:block">
                <p className="mb-1 text-[11px] font-semibold text-muted">Preview</p>
                <DocRenderer body={draft} />
              </div>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              # heading · ## section · - list · - [ ] checklist · &gt; note · ``` code · task keys
              like RB-212 link automatically
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What changed? (shown in history)"
                className="h-8 min-w-0 flex-1 rounded-md border border-line px-2.5 text-[12.5px] outline-none focus:border-accent"
              />
              <Button
                onClick={() => {
                  setDraft(doc.body);
                  setTitle(doc.title);
                  setEdit(false);
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" disabled={!dirty} onClick={doSave}>
                Save version
              </Button>
            </div>
          </div>
        ) : compareVersion ? (
          <div className="px-4 py-3 lg:px-6">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[12.5px] text-ink">
                <b>{compareVersion.id}</b> ({compareVersion.summary}) → current
              </p>
              <button
                onClick={() => setCompare(null)}
                className="text-[12px] font-medium text-accent hover:underline"
              >
                Close compare
              </button>
            </div>
            <pre className="overflow-x-auto rounded-md border border-line font-mono text-[12px] leading-[18px]">
              {diffLines(compareVersion.body, doc.body).map((l, i) => (
                <div
                  key={i}
                  className={`px-3 ${l.t === 'add' ? 'bg-ok-soft text-ok' : l.t === 'del' ? 'bg-bad-soft text-bad line-through' : 'text-muted'}`}
                >
                  {l.t === 'add' ? '+ ' : l.t === 'del' ? '- ' : '  '}
                  {l.s}
                </div>
              ))}
            </pre>
          </div>
        ) : (
          <div className="px-4 py-3 lg:px-6">
            <DocRenderer body={doc.body} onToggle={canEdit ? toggleLine : undefined} />
            <p className="mt-6 border-t border-line pt-2 text-[11.5px] text-muted">
              Created by {memberById(doc.createdBy).name} ·{' '}
              {formatDateTime(new Date(doc.createdAt))} · last edited by{' '}
              {memberById(doc.updatedBy).name} {relative(new Date(doc.updatedAt))}
            </p>
          </div>
        )}
      </article>

      <aside className="min-w-0 border-t border-line xl:w-[290px] xl:border-l xl:border-t-0">
        <div className="border-b border-line px-3 py-2">
          <Segmented
            label="Doc details"
            value={rail}
            onChange={setRail}
            options={[
              { value: 'outline', label: 'Outline' },
              { value: 'linked', label: 'Tasks', count: linked.length },
              { value: 'versions', label: 'History', count: doc.versions.length },
              {
                value: 'comments',
                label: 'Comments',
                count: doc.comments.filter((c) => !c.resolved).length,
              },
            ]}
          />
        </div>
        {rail === 'outline' && (
          <div className="space-y-3 p-3">
            {checks.length > 0 && (
              <div>
                <p className="flex justify-between text-[11.5px] text-muted">
                  <span>Checklist</span>
                  <span className="tabular-nums">
                    {checks.filter((c) => c.startsWith('- [x]')).length}/{checks.length}
                  </span>
                </p>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full bg-ok"
                    style={{
                      width: `${(checks.filter((c) => c.startsWith('- [x]')).length / checks.length) * 100}%`,
                    }}
                  />
                </span>
              </div>
            )}
            {outline.length === 0 ? (
              <p className="text-[12px] text-muted">Add ## sections to build an outline.</p>
            ) : (
              <ul className="space-y-0.5">
                {outline.map((o) => (
                  <li key={o}>
                    <a
                      href={`#${slug(o)}`}
                      className="block truncate rounded px-1.5 py-1 text-[12.5px] text-ink hover:bg-sunken"
                    >
                      {o}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <p className="mb-1 text-[11.5px] text-muted">Editors</p>
              <div className="flex -space-x-1">
                {doc.editors.map((e) => (
                  <Avatar key={e} id={e} size="sm" ring />
                ))}
              </div>
            </div>
          </div>
        )}
        {rail === 'linked' && (
          <ul className="divide-y divide-line">
            {linked.length === 0 && (
              <li className="px-3 py-6 text-center text-[12px] text-muted">
                Mention a task key like RB-212 in the doc to link it here.
              </li>
            )}
            {linked.map(({ key, task }) => (
              <li key={key}>
                {task ? (
                  <Link to={`/tasks/${key}`} className="block px-3 py-2 hover:bg-sunken/50">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11.5px] font-semibold text-accent">
                        {key}
                      </span>
                      <span className="text-[11px] text-muted">
                        {taskStatusMeta[task.status].label}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-ink">
                      {task.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                      <Avatar id={task.assignee} size="xs" /> {firstName(task.assignee)} · due{' '}
                      {task.due}
                    </span>
                  </Link>
                ) : (
                  <p className="px-3 py-2 text-[12px] text-muted">
                    <span className="font-mono">{key}</span> · not found or no access
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {rail === 'versions' && (
          <ol className="divide-y divide-line">
            {doc.versions.map((ver, i) => (
              <li key={ver.id + ver.at} className="flex items-start gap-2 px-3 py-2">
                <HistoryIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-ink">{ver.summary}</p>
                  <p className="text-[11px] text-muted">
                    {memberById(ver.by).name} · {formatDateTime(new Date(ver.at))}
                  </p>
                  {i > 0 && ver.body && (
                    <span className="mt-1 flex gap-3">
                      <button
                        onClick={() => {
                          setCompare(ver.id);
                          setEdit(false);
                        }}
                        className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
                      >
                        <GitCompareIcon className="h-3 w-3" /> Compare
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => {
                            restore(doc.id, ver.id);
                            setCompare(null);
                            toast.success(`Restored ${ver.id}`);
                          }}
                          className="text-[11.5px] font-medium text-accent hover:underline"
                        >
                          Restore
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {i === 0 && <span className="text-[10.5px] font-semibold text-ok">Current</span>}
              </li>
            ))}
          </ol>
        )}
        {rail === 'comments' && (
          <div className="p-3">
            <ul className="space-y-2">
              {doc.comments.length === 0 && (
                <li className="py-4 text-center text-[12px] text-muted">
                  <MessageSquareIcon className="mx-auto mb-1 h-4 w-4" />
                  No comments yet.
                </li>
              )}
              {doc.comments.map((c) => (
                <li
                  key={c.id}
                  className={`rounded-md border border-line p-2 ${c.resolved ? 'opacity-60' : ''}`}
                >
                  <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
                    <Avatar id={c.by} size="xs" />{' '}
                    <b className="font-semibold text-ink">{firstName(c.by)}</b> ·{' '}
                    {relative(new Date(c.at))}
                  </p>
                  <p className="mt-1 text-[12.5px] text-ink">{c.text}</p>
                  <button
                    onClick={() => resolveComment(doc.id, c.id)}
                    className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent"
                  >
                    <CheckIcon className="h-3 w-3" />
                    {c.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) {
                  comment(doc.id, note.trim());
                  setNote('');
                }
              }}
              className="mt-2 flex gap-1.5"
            >
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a comment"
                className="h-8 min-w-0 flex-1 rounded-md border border-line px-2 text-[12.5px] outline-none focus:border-accent"
              />
              <Button size="md" variant="primary" type="submit" disabled={!note.trim()}>
                Post
              </Button>
            </form>
          </div>
        )}
      </aside>
    </div>
  );
}
