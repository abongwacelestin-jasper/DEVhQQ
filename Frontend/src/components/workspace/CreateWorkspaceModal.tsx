import { useEffect, useState } from 'react';
import { CheckIcon } from 'lucide-react';
import { Modal, Field, inputClass } from '../ui/Modal';
import { Button } from '../ui/Button';
import { WorkspacesIllustration } from '../illustrations/WorkspacesIllustration';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { toast } from 'sonner';
import { errorMessage, isUnavailable } from '../work/apiState';
import { ApiError } from '../../api/client';
import { useDirectory } from '../team/useDirectory';
import { Avatar } from '../ui/Avatar';
import { moduleCatalog, workspaceTemplates } from '../../data/workspaces';
import type { WorkspaceTemplateId } from '../../contexts/WorkspaceContext';
import type { ModuleKey } from '../../types/workspace';

const palette = ['#4F46E5', '#0E7490', '#B45309', '#BE185D', '#15803D'];
const templateIds: readonly string[] = ['product', 'agency', 'regulated', 'startup'];
const isTemplateId = (t: string): t is WorkspaceTemplateId => templateIds.includes(t);

export function CreateWorkspaceModal() {
  const { createWorkspaceOpen, setCreateWorkspaceOpen } = useWorkspaceUI();
  const { workspaces, createWorkspace, switchTo } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState(workspaceTemplates[0].id);
  const [modules, setModules] = useState<ModuleKey[]>(workspaceTemplates[0].modules);
  const [mfa, setMfa] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState('');
  const { me, members } = useDirectory();
  const candidates = members.filter((m) => m.status === 'active' && m.id !== me);

  useEffect(() => {
    if (createWorkspaceOpen) {
      setName('');
      setTemplate(workspaceTemplates[0].id);
      setModules(workspaceTemplates[0].modules);
      setMfa(true);
      setPicked([]);
      setError('');
    }
  }, [createWorkspaceOpen]);

  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const close = () => setCreateWorkspaceOpen(false);

  const create = () => {
    if (name.trim().length < 2) return setError('Name the workspace — usually the company name.');
    if (slug.length < 2)
      return setError('The workspace address needs at least two letters or digits.');
    if (workspaces.some((w) => w.slug === slug))
      return setError(`devhq.app/${slug} is already taken.`);
    if (!isTemplateId(template)) return setError('Pick a template.');
    setError('');
    setBusy(true);
    // Organization:admin only; the server answers 403 for anyone else.
    createWorkspace({
      name: name.trim(),
      slug,
      color: palette[workspaces.length % palette.length],
      template,
      modules,
      mfaRequired: mfa,
      members: picked,
    })
      .then((ws) => {
        switchTo(ws.id);
        toast.success(
          `${ws.name} created${picked.length ? ` · ${picked.length} member${picked.length > 1 ? 's' : ''} added` : ''}`,
        );
        close();
      })
      .catch((e: unknown) =>
        setError(
          isUnavailable(e)
            ? 'Creating workspaces isn’t available on this server yet.'
            : e instanceof ApiError && e.status === 403
              ? 'Only organization admins can create workspaces.'
              : errorMessage(e, 'The workspaces API did not respond.'),
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      open={createWorkspaceOpen}
      onClose={close}
      title="Create a workspace"
      description="Each company gets its own isolated workspace — data, members and permissions never cross over."
      size="lg"
      illustration={<WorkspacesIllustration className="h-12 w-auto" />}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'Create workspace'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company or workspace name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Northwind Labs"
              className={inputClass}
            />
          </Field>
          <Field label="Workspace URL">
            <div className="flex h-8 items-center overflow-hidden rounded-md border border-line bg-sunken/50 text-[12.5px]">
              <span className="px-2 text-muted">devhq.app/</span>
              <span className="truncate font-medium text-ink">{slug || 'your-company'}</span>
            </div>
          </Field>
        </div>

        <fieldset>
          <legend className="text-[12px] font-medium text-ink">Start from a template</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {workspaceTemplates.map((t) => {
              const active = template === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTemplate(t.id);
                    setModules(t.modules);
                  }}
                  aria-pressed={active}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors duration-150 ${active ? 'border-accent bg-accent-soft/50' : 'border-line hover:border-line-strong'}`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? 'border-accent bg-accent' : 'border-line-strong'}`}
                  >
                    {active && <CheckIcon className="h-2.5 w-2.5 text-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold text-ink">{t.name}</span>
                    <span className="block text-[11.5px] text-muted">{t.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[12px] font-medium text-ink">Modules</legend>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {moduleCatalog.map((m) => (
              <label
                key={m.key}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${m.core ? '' : 'cursor-pointer hover:bg-sunken/60'}`}
              >
                <input
                  type="checkbox"
                  disabled={m.core}
                  checked={modules.includes(m.key)}
                  onChange={() =>
                    setModules((l) =>
                      l.includes(m.key) ? l.filter((x) => x !== m.key) : [...l, m.key],
                    )
                  }
                  className="h-3.5 w-3.5 accent-[#4F46E5]"
                />

                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-ink">{m.label}</span>
                  <span className="block truncate text-[11px] text-muted">{m.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="space-y-1.5">
            <legend className="text-[12px] font-medium text-ink">Security defaults</legend>
            <label className="flex items-center gap-2 text-[12.5px] text-ink">
              <input
                type="checkbox"
                checked={mfa}
                onChange={(e) => setMfa(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#4F46E5]"
              />{' '}
              Require MFA for everyone
            </label>
            {!mfa && (
              <p className="text-[11.5px] font-medium text-warn">
                Not recommended — production access will still require MFA.
              </p>
            )}
          </fieldset>
          <fieldset>
            <legend className="text-[12px] font-medium text-ink">Add teammates (optional)</legend>
            <p className="text-[11px] text-muted">
              Existing active members. New people are invited from Team.
            </p>
            <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto scroll-thin">
              {candidates.length === 0 && (
                <li className="text-[11.5px] text-muted">No other active members.</li>
              )}
              {candidates.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12.5px] text-ink hover:bg-sunken/60">
                    <input
                      type="checkbox"
                      checked={picked.includes(m.id)}
                      onChange={() =>
                        setPicked((l) =>
                          l.includes(m.id) ? l.filter((x) => x !== m.id) : [...l, m.id],
                        )
                      }
                      className="h-3.5 w-3.5 accent-[#4F46E5]"
                    />
                    <Avatar id={m.id} size="xs" />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <span className="text-[11px] text-muted">{m.role}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md bg-bad-soft px-3 py-2 text-[12px] font-medium text-bad"
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
