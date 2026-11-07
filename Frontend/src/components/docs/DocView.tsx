import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeftIcon,
  BoldIcon,
  CheckSquareIcon,
  CodeIcon,
  CopyPlusIcon,
  DownloadIcon,
  EyeIcon,
  HeadingIcon,
  LinkIcon,
  ListIcon,
  LockIcon,
  MessageSquarePlusIcon,
  PaperclipIcon,
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
import { DocHistory } from './DocHistory';
import { DocComments } from './DocComments';
import { withContext } from './diff';
import {
  useDocCollab,
  type ApiDocCommentAnchor,
  type ApiDocDiff,
  type ApiDocVersionMeta,
} from './useDocCollab';
import { errorMessage } from '../work/apiState';
import { useDocs } from '../../contexts/DocsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useReauth } from '../../contexts/ReauthContext';
import { useWork } from '../../contexts/WorkContext';
import { useStarredDocs } from '../../hooks/useStarredDocs';
import { useDirectory } from '../team/useDirectory';
import { formatBytes, useFileUpload } from '../work/useFileUpload';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { docKindMeta } from '../../data/docs';
import { taskStatusMeta } from '../../utils/status';
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

const MAX_QUOTE = 280;

export function DocView({ doc }: { doc: ProjectDoc }) {
  const { save, update, remove, create, applyServerDoc, refreshDoc } = useDocs();
  const { canDo, session, log } = useAuth();
  const { requestReauth } = useReauth();
  const { tasks } = useWork();
  const { isStarred, toggle } = useStarredDocs();
  const { memberById } = useDirectory();
  const { allowedProjects: projects } = useProductFilter();
  const collab = useDocCollab(doc.id);
  const attach = useFileUpload('doc-attachment');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const editing = params.get('edit') === '1';
  const [draft, setDraft] = useState(doc.body);
  const [title, setTitle] = useState(doc.title);
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [rail, setRail] = useState<RailTab>('outline');
  const [compare, setCompare] = useState<{
    id: string;
    label: string;
    summary: string;
    diff: ApiDocDiff;
  } | null>(null);
  const [selection, setSelection] = useState<ApiDocCommentAnchor | null>(null);
  const [anchor, setAnchor] = useState<ApiDocCommentAnchor | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const readRef = useRef<HTMLDivElement>(null);
  const me = session?.memberId ?? '';
  const canEdit =
    canDo('doc:create') && (doc.visibility !== 'restricted' || doc.editors.includes(me));
  const project = projects.find((p) => p.id === doc.projectId);
  const dirty = draft !== doc.body || title !== doc.title;
  const words = doc.body.split(/\s+/).filter(Boolean).length;

  useEffect(() => {
    setDraft(doc.body);
    setTitle(doc.title);
    setCompare(null);
    setSelection(null);
    setAnchor(null);
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reset drafts only when switching docs, not on every server refresh

  // Notification links point at `/docs/:id?comment=<id>`: open the comments rail on that thread.
  const focusComment = params.get('comment');
  useEffect(() => {
    if (!focusComment) return;
    setRail('comments');
    if (collab.comments.status !== 'ready') return;
    const target = collab.comments.items.find((c) => c.id === focusComment);
    const el = document.getElementById(`doc-comment-${target?.parentId ?? focusComment}`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
  }, [focusComment, collab.comments.status, collab.comments.items]);

  const setEdit = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set('edit', '1');
    else next.delete('edit');
    setParams(next, { replace: true });
  };

  /**
   * One server call writes the doc and snapshots it (`POST …/versions`), then the
   * doc is re-read. When doc-collab isn't deployed, fall back to a plain PATCH.
   */
  const doSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    const nextTitle = title.trim() || doc.title;
    try {
      let result: 'saved' | 'unavailable';
      try {
        result = await collab.saveVersion({
          summary: summary.trim() || 'Edited',
          title: nextTitle,
          body: draft,
        });
      } catch (e) {
        toast.error('Saving the doc failed', { description: errorMessage(e) });
        return; // keep the draft for another try
      }
      if (result === 'saved') await refreshDoc(doc.id);
      else await save(doc.id, draft, nextTitle); // reports its own failure, then rejects
      setSummary('');
      setEdit(false);
      toast.success('Saved', {
        description:
          result === 'saved'
            ? 'A new version was recorded.'
            : 'Version history is unavailable on this server.',
      });
    } catch {
      /* DocsContext already reported the failure and resynced; keep the draft. */
    } finally {
      setSaving(false);
    }
  };

  const openCompare = async (v: ApiDocVersionMeta, label: string) => {
    const diff = await collab.diff(v.id);
    if (!diff) return;
    setCompare({ id: v.id, label, summary: v.summary, diff });
    setEdit(false);
  };

  const restoreVersion = async (v: ApiDocVersionMeta, label: string) => {
    const res = await collab.restore(v.id, `Restored ${label}`);
    if (!res) return;
    applyServerDoc(res.doc);
    setDraft(res.doc.body);
    setTitle(res.doc.title);
    setCompare(null);
    toast.success(`Restored ${label}`, {
      description: `Saved as v${res.version.number}; the previous state is kept in history.`,
    });
  };

  /** Remember a selection inside the rendered doc so it can anchor a comment. */
  const captureSelection = () => {
    const sel = window.getSelection();
    const root = readRef.current;
    if (!sel || sel.isCollapsed || !root || !sel.anchorNode || !root.contains(sel.anchorNode)) {
      setSelection(null);
      return;
    }
    const quote = sel.toString().replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE);
    if (!quote) return setSelection(null);
    const start = doc.body.indexOf(quote);
    const heading =
      start >= 0
        ? doc.body
            .slice(0, start)
            .split('\n')
            .reverse()
            .find((l) => l.startsWith('## '))
            ?.slice(3)
            .trim()
            .slice(0, 200)
        : undefined;
    setSelection({
      quote,
      ...(start >= 0 ? { start, end: start + quote.length } : {}),
      ...(heading ? { heading } : {}),
    });
  };

  const commentOnSelection = () => {
    if (!selection) return;
    setAnchor(selection);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    setRail('comments');
  };

  const onAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const done = await attach.upload(file, doc.id);
    if (!done) return;
    const el = areaRef.current;
    const at = el ? el.selectionStart : draft.length;
    const label = done.name.replace(/[[\]()]/g, '');
    const md = `[${label}](/api/files/${done.fileId})`;
    setDraft((d) => `${d.slice(0, at)}${at && d[at - 1] !== '\n' ? ' ' : ''}${md}${d.slice(at)}`);
    toast.success('Attachment added', { description: `${done.name} · ${formatBytes(done.size)}` });
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
    // A small edit: plain PATCH (no named version). The server snapshots published docs itself.
    update(doc.id, { body: lines.join('\n') });
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
  const versionCount =
    collab.versions.status === 'ready' ? collab.versions.items.length : undefined;
  const commentCount = collab.comments.status === 'ready' ? collab.openCount : undefined;

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
          {/* The docs API sets visibility at creation and does not accept changes to it. */}
          <select
            value={doc.visibility}
            disabled
            title="Visibility is set when the doc is created"
            aria-label="Visibility"
            className="h-6 rounded border border-line bg-white px-1 text-[11px] text-ink disabled:opacity-80"
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
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={attach.state.status === 'uploading'}
                title="Attach file"
                aria-label="Attach file"
                className="rounded p-1.5 text-muted hover:bg-white hover:text-ink disabled:opacity-50"
              >
                <PaperclipIcon className="h-3.5 w-3.5" />
              </button>
              <input ref={fileRef} type="file" className="hidden" onChange={onAttach} />
              <span className="ml-auto pr-2 text-[11px] text-muted">
                {draft.split(/\s+/).filter(Boolean).length} words · ⌘S to save
              </span>
            </div>
            {attach.state.status !== 'idle' && attach.state.status !== 'done' && (
              <p
                role={attach.state.status === 'uploading' ? 'status' : 'alert'}
                className={`mb-1.5 flex items-center gap-2 rounded-md px-2 py-1 text-[11.5px] ${attach.state.status === 'uploading' ? 'bg-sunken text-ink' : 'bg-bad-soft text-bad'}`}
              >
                <PaperclipIcon className="h-3 w-3 shrink-0" aria-hidden />
                <span className="flex-1">
                  {attach.state.status === 'uploading'
                    ? `Uploading ${attach.state.name} · ${attach.state.progress}%`
                    : attach.state.message}
                </span>
                <button
                  type="button"
                  onClick={attach.state.status === 'uploading' ? attach.cancel : attach.reset}
                  className="font-medium underline"
                >
                  {attach.state.status === 'uploading' ? 'Cancel' : 'Dismiss'}
                </button>
              </p>
            )}
            <div className="grid gap-3 xl:grid-cols-2">
              <textarea
                ref={areaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    void doSave();
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
              <Button variant="primary" disabled={!dirty || saving} onClick={() => void doSave()}>
                {saving ? 'Saving…' : 'Save version'}
              </Button>
            </div>
          </div>
        ) : compare ? (
          <div className="px-4 py-3 lg:px-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px] text-ink">
                <b className="font-mono">{compare.label}</b> ({compare.summary || 'Edited'}) →
                current
                <span className="ml-2 tabular-nums text-ok">+{compare.diff.added}</span>
                <span className="ml-1 tabular-nums text-bad">−{compare.diff.removed}</span>
                {compare.diff.titleChanged && (
                  <span className="ml-2 text-[11.5px] text-warn">· title changed</span>
                )}
              </p>
              <button
                type="button"
                onClick={() => setCompare(null)}
                className="text-[12px] font-medium text-accent hover:underline"
              >
                Close compare
              </button>
            </div>
            {compare.diff.added + compare.diff.removed === 0 ? (
              <p className="rounded-md border border-line px-3 py-4 text-center text-[12px] text-muted">
                No differences — this version matches the current doc.
              </p>
            ) : (
              <pre
                aria-label={`Changes from ${compare.label} to the current doc`}
                className="overflow-x-auto rounded-md border border-line font-mono text-[12px] leading-[18px]"
              >
                {withContext(compare.diff.ops).map((l, i) =>
                  l.op === 'gap' ? (
                    <div key={i} className="bg-sunken/60 px-3 text-[11px] text-muted">
                      ⋯ {l.n} unchanged {l.n === 1 ? 'line' : 'lines'}
                    </div>
                  ) : (
                    <div
                      key={i}
                      className={`px-3 ${l.op === 'add' ? 'bg-ok-soft text-ok' : l.op === 'remove' ? 'bg-bad-soft text-bad line-through' : 'text-muted'}`}
                    >
                      <span aria-hidden>
                        {l.op === 'add' ? '+ ' : l.op === 'remove' ? '- ' : '  '}
                      </span>
                      <span className="sr-only">
                        {l.op === 'add' ? 'Added: ' : l.op === 'remove' ? 'Removed: ' : ''}
                      </span>
                      {l.line || ' '}
                    </div>
                  ),
                )}
              </pre>
            )}
          </div>
        ) : (
          <div className="relative px-4 py-3 lg:px-6">
            {selection && collab.comments.status === 'ready' && (
              <div className="sticky top-2 z-10 mb-2 flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<MessageSquarePlusIcon className="h-3.5 w-3.5" />}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={commentOnSelection}
                >
                  Comment on selection
                </Button>
              </div>
            )}
            <div ref={readRef} onMouseUp={captureSelection} onKeyUp={captureSelection}>
              <DocRenderer body={doc.body} onToggle={canEdit ? toggleLine : undefined} />
            </div>
            <p className="mt-6 border-t border-line pt-2 text-[11.5px] text-muted">
              Last edited by {memberById(doc.updatedBy).name} {relative(new Date(doc.updatedAt))} ·{' '}
              {formatDateTime(new Date(doc.updatedAt))}
            </p>
          </div>
        )}
      </article>

      <aside className="min-w-0 border-t border-line xl:w-[290px] xl:border-l xl:border-t-0">
        <div className="border-b border-line px-3 py-2">
          <Segmented
            fill
            label="Doc details"
            value={rail}
            onChange={setRail}
            options={[
              { value: 'outline', label: 'Outline' },
              { value: 'linked', label: 'Tasks', count: linked.length },
              { value: 'versions', label: 'History', count: versionCount },
              { value: 'comments', label: 'Comments', count: commentCount },
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
                      <Avatar id={task.assignee} size="xs" />{' '}
                      {memberById(task.assignee).name.split(' ')[0]} · due {task.due}
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
          <DocHistory
            status={collab.versions.status}
            versions={collab.versions.items}
            demo={collab.versions.demo}
            error={collab.versions.error}
            canEdit={canEdit}
            comparing={compare?.id}
            memberById={memberById}
            onCompare={(v, label) => void openCompare(v, label)}
            onRestore={(v, label) => void restoreVersion(v, label)}
            onRetry={() => void collab.loadVersions()}
          />
        )}
        {rail === 'comments' && (
          <DocComments
            status={collab.comments.status}
            comments={collab.comments.items}
            demo={collab.comments.demo}
            error={collab.comments.error}
            body={doc.body}
            pendingAnchor={anchor}
            onClearAnchor={() => setAnchor(null)}
            memberById={memberById}
            onAdd={collab.addComment}
            onResolve={(id, resolved) => void collab.setResolved(id, resolved)}
            onRetry={() => void collab.loadComments()}
          />
        )}
      </aside>
    </div>
  );
}
