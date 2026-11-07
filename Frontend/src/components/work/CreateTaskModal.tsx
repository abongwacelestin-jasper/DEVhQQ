import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Modal, Field, inputClass } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { ChecklistIllustration } from '../illustrations/ChecklistIllustration';
import { useWork } from '../../contexts/WorkContext';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { products } from '../../data/portfolio';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { useDirectory } from '../team/useDirectory';
import { NOW, addDays, formatDay, fromInputDate, toInputDate } from '../../utils/date';
import { priorityMeta, taskStatusMeta } from '../../utils/status';
import type { ProductId } from '../../types/portfolio';
import type { Priority, TaskStatus, TaskType } from '../../types/work';

const types: { value: TaskType; label: string }[] = [
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'task', label: 'Task' },
  { value: 'design', label: 'Design' },
];

export function CreateTaskModal() {
  const { createTaskDefaults, closeCreateTask } = useWorkspaceUI();
  const { allowedProjects: projects } = useProductFilter();
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const { createTask, tasks } = useWork();
  const { members } = useDirectory();
  const navigate = useNavigate();
  const open = createTaskDefaults !== null;

  const [title, setTitle] = useState('');
  const [product, setProduct] = useState<ProductId>('renewberry');
  const [projectId, setProjectId] = useState('p1');
  const [type, setType] = useState<TaskType>('feature');
  const [priority, setPriority] = useState<Priority>('medium');
  const [status, setStatus] = useState<TaskStatus>('backlog');
  const [assignee, setAssignee] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [due, setDue] = useState(toInputDate(addDays(NOW, 7)));
  const [estimate, setEstimate] = useState(3);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!createTaskDefaults) return;
    const d = createTaskDefaults;
    const projects = projectsRef.current;
    const proj = d.projectId ? projects.find((p) => p.id === d.projectId) : undefined;
    const prod = d.product ?? proj?.product ?? 'renewberry';
    setTitle('');
    setProduct(prod);
    setProjectId(d.projectId ?? projects.find((p) => p.product === prod)?.id ?? 'p1');
    setType(d.type ?? 'feature');
    setPriority(d.priority ?? 'medium');
    setStatus(d.status ?? 'backlog');
    setAssignee(d.assignee ?? '');
    setReviewer('');
    setDue(toInputDate(addDays(NOW, 7)));
    setEstimate(3);
    setDescription('');
    setError('');
  }, [createTaskDefaults]);

  const eligible = useMemo(
    () => members.filter((m) => m.status === 'active' && m.products.includes(product)),
    [members, product],
  );
  const load = (id: string) =>
    tasks
      .filter((t) => t.assignee === id && t.status !== 'done')
      .reduce((s, t) => s + t.estimate, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3)
      return setError('Give the task a clear title (at least 3 characters).');
    if (!assignee)
      return setError('Choose who owns this task — every task needs an accountable owner.');
    if (reviewer && reviewer === assignee)
      return setError('Reviewer must be a different person from the assignee.');
    let key: string;
    try {
      key = await createTask({
        title: title.trim(),
        product,
        projectId,
        type,
        priority,
        status,
        assignee,
        reviewer: reviewer || undefined,
        due: formatDay(fromInputDate(due)),
        estimate,
        description: description.trim() || undefined,
      });
    } catch {
      setError('The task could not be created. Check the values and try again.');
      return;
    }
    closeCreateTask();
    toast.success(`${key} created`, {
      description: 'Assignment recorded in the task history.',
      action: { label: 'Open', onClick: () => navigate(`/tasks/${key}`) },
    });
  };

  return (
    <Modal
      open={open}
      onClose={closeCreateTask}
      title="New task"
      description="Creation, assignment and every later change are recorded with who and when."
      size="lg"
      illustration={<ChecklistIllustration className="h-12 w-auto" />}
      footer={
        <>
          <Button onClick={closeCreateTask}>Cancel</Button>
          <Button variant="primary" type="submit" form="create-task">
            Create task
          </Button>
        </>
      }
    >
      <form id="create-task" onSubmit={submit} className="space-y-3">
        <Field label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Add audit export to CSV"
            className={inputClass}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-[12px] font-medium text-ink">Type</span>
          <Segmented<TaskType> label="Task type" value={type} onChange={setType} options={types} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Product">
            <select
              value={product}
              onChange={(e) => {
                const p = e.target.value as ProductId;
                setProduct(p);
                setProjectId(projects.find((x) => x.product === p)?.id ?? '');
                setAssignee('');
                setReviewer('');
              }}
              className={inputClass}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Project">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={inputClass}
            >
              {projects
                .filter((p) => p.product === product)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Assignee" hint="Only people with access to this product are listed.">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className={inputClass}
            >
              <option value="">Choose an owner…</option>
              {eligible.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.role} · {load(m.id)}/{m.capacity} pts
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reviewer (optional)">
            <select
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              className={inputClass}
            >
              <option value="">No reviewer</option>
              {eligible
                .filter((m) => m.id !== assignee)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.role}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Priority">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className={inputClass}
            >
              {(Object.keys(priorityMeta) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {priorityMeta[p].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className={inputClass}
            >
              {(['backlog', 'in-progress'] as TaskStatus[]).map((s) => (
                <option key={s} value={s}>
                  {taskStatusMeta[s].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={due}
              min={toInputDate(NOW)}
              onChange={(e) => setDue(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Estimate (pts)">
            <input
              type="number"
              min={1}
              max={21}
              value={estimate}
              onChange={(e) => setEstimate(Math.max(1, Number(e.target.value)))}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What does done look like?"
            className={`${inputClass} h-auto resize-none py-1.5`}
          />
        </Field>
        {error && (
          <p
            role="alert"
            className="rounded-md bg-bad-soft px-3 py-2 text-[12px] font-medium text-bad"
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
