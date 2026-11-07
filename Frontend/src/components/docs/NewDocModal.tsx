import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Modal, Field, inputClass } from '../ui/Modal';
import { Button } from '../ui/Button';
import { DocsIllustration } from '../illustrations/DocsIllustration';
import { useDocs } from '../../contexts/DocsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { docKindMeta, docTemplates } from '../../data/docs';
import type { DocKind, DocVisibility } from '../../types/docs';

export function NewDocModal({
  open,
  onClose,
  projectId,
  initialKind = 'spec',
}: {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  initialKind?: DocKind;
}) {
  const { create } = useDocs();
  const { canSeeProduct, log } = useAuth();
  const { allowedProjects: projects } = useProductFilter();
  const navigate = useNavigate();
  const allowed = projects.filter((p) => canSeeProduct(p.product));
  const [title, setTitle] = useState('');
  const [pid, setPid] = useState(projectId ?? allowed[0]?.id ?? '');
  const [kind, setKind] = useState<DocKind>('spec');
  const [vis, setVis] = useState<DocVisibility>('project');

  useEffect(() => {
    if (open) {
      setTitle('');
      setKind(initialKind);
      setVis('project');
      setPid(projectId ?? allowed[0]?.id ?? '');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const project = projects.find((p) => p.id === pid);
    if (!project || !title.trim()) return;
    const body = docTemplates[kind].replace(/^# .*$/m, `# ${title.trim()}`);
    let doc;
    try {
      doc = await create({
        projectId: pid,
        product: project.product,
        title: title.trim(),
        kind,
        visibility: vis,
        body,
      });
    } catch (e) {
      toast.error('Could not create the doc', {
        description: e instanceof Error ? e.message : 'The docs API did not respond.',
      });
      return;
    }
    log('Created doc', `${title.trim()} · ${project.name}`);
    toast.success('Doc created', {
      description: 'Saved as a draft. Every save creates a version.',
    });
    navigate(`/docs/${doc.id}?edit=1`);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project doc"
      description="Start from a template. Docs inherit the project’s access rules."
      illustration={<DocsIllustration className="h-14 w-auto" />}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!title.trim() || !pid}>
            Create doc
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Invoice export spec"
            className={inputClass}
          />
        </Field>
        <Field label="Project">
          <select value={pid} onChange={(e) => setPid(e.target.value)} className={inputClass}>
            {allowed.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Who can see it">
          <select
            value={vis}
            onChange={(e) => setVis(e.target.value as DocVisibility)}
            className={inputClass}
          >
            <option value="project">Project members</option>
            <option value="workspace">Whole workspace</option>
            <option value="restricted">Restricted — editors only</option>
          </select>
        </Field>
      </div>
      <p className="mb-1.5 mt-3 text-[12px] font-medium text-ink">Template</p>
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {(Object.keys(docKindMeta) as DocKind[]).map((k) => (
          <li key={k}>
            <button
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors duration-150 ${kind === k ? 'border-ink bg-sunken/60' : 'border-line hover:border-line-strong'}`}
            >
              <span
                className={`rounded px-1.5 py-px text-[10.5px] font-semibold ${docKindMeta[k].color}`}
              >
                {docKindMeta[k].label}
              </span>
              <span className="mt-1 block truncate text-[11px] text-muted">
                {docTemplates[k]
                  .split('\n')
                  .filter((l) => l.startsWith('## '))
                  .map((l) => l.slice(3))
                  .join(' · ') || 'Free form'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
