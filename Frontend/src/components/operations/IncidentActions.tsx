import React, { useCallback, useId, useMemo, useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import type { ApiIncidentAction } from '../../api/types';
import type { Member } from '../../types/team';
import type { ProductId } from '../../types/portfolio';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { GuardedButton, LoadingRows } from '../engineering/states';
import { useServerLevel } from '../engineering/data/hooks';
import { useDirectory } from '../team/useDirectory';
import { useIncidents } from '../../contexts/IncidentContext';
import { formatDay, fromInputDate, toInputDate } from '../../utils/date';
import {
  useIncidentActions,
  type IncidentActionInput,
  type IncidentActionPatch,
} from './useIncidentActions';

const EDIT_REASON = 'Adding or updating steps needs Infrastructure: contribute.';
const DELETE_REASON = 'Needs Infrastructure: manage';

const fieldClass =
  'h-8 w-full min-w-0 rounded-md border border-line bg-white px-2 text-[12px] text-ink outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60';

export const isOverdue = (a: Pick<ApiIncidentAction, 'due' | 'status'>, today: string) =>
  !!a.due && a.status !== 'done' && a.due < today;

export interface IncidentActionsViewProps {
  items: ApiIncidentAction[];
  loading: boolean;
  error: string | null;
  /** Ids with a write in flight; `new` while the add form is submitting. */
  busy: ReadonlySet<string>;
  /** Active members who can see the incident's product. */
  owners: Member[];
  nameOf: (id: string) => string;
  me: string | null;
  canEdit: boolean;
  canDelete: boolean;
  /** `YYYY-MM-DD` of the viewer's today, for overdue highlighting. */
  today: string;
  onAdd: (input: IncidentActionInput) => Promise<boolean>;
  onUpdate: (id: string, patch: IncidentActionPatch, success: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

/** The Recovery panel's list of mitigation steps and follow-ups (presentational). */
export function IncidentActionsView(props: IncidentActionsViewProps) {
  const { items, loading, error, canEdit } = props;
  const reasonId = useId();
  const mitigation = items.filter((a) => a.kind === 'mitigation');
  const followUps = items.filter((a) => a.kind === 'follow-up');

  return (
    <div>
      {!canEdit && (
        <p id={reasonId} className="px-3.5 pt-2.5 text-[11.5px] text-muted">
          {EDIT_REASON}
        </p>
      )}
      {error && (
        <p role="alert" className="px-3.5 pt-2.5 text-[12px] text-bad">
          Couldn’t load the recovery steps: {error}
        </p>
      )}
      {loading ? (
        <LoadingRows rows={2} label="Loading recovery steps" />
      ) : (
        <>
          <ActionGroup
            title="Mitigation"
            empty="No mitigation steps yet."
            list={mitigation}
            reasonId={canEdit ? undefined : reasonId}
            {...props}
          />
          <ActionGroup
            title="Follow-ups"
            empty="No follow-ups yet."
            list={followUps}
            reasonId={canEdit ? undefined : reasonId}
            {...props}
          />
        </>
      )}
      <AddActionForm {...props} reasonId={canEdit ? undefined : reasonId} />
    </div>
  );
}

function ActionGroup({
  title,
  empty,
  list,
  reasonId,
  ...props
}: IncidentActionsViewProps & {
  title: string;
  empty: string;
  list: ApiIncidentAction[];
  reasonId?: string;
}) {
  const headingId = useId();
  const open = list.filter((a) => a.status !== 'done').length;
  return (
    <section aria-labelledby={headingId} className="px-3.5 pt-2.5">
      <h3
        id={headingId}
        className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted"
      >
        {title}
        <span className="font-normal normal-case tracking-normal tabular-nums">
          {open} open · {list.length} total
        </span>
      </h3>
      {list.length === 0 ? (
        <p className="py-1.5 text-[12px] text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((a) => (
            <ActionItem key={a.id} action={a} reasonId={reasonId} {...props} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ActionItem({
  action: a,
  reasonId,
  owners,
  nameOf,
  canEdit,
  canDelete,
  busy,
  today,
  onUpdate,
  onDelete,
}: IncidentActionsViewProps & { action: ApiIncidentAction; reasonId?: string }) {
  const checkId = useId();
  const done = a.status === 'done';
  const overdue = isOverdue(a, today);
  const pending = busy.has(a.id);
  // The current owner stays selectable even if they have since lost access.
  const ownerOptions = owners.some((m) => m.id === a.owner)
    ? owners
    : [{ id: a.owner, name: nameOf(a.owner) } as Member, ...owners];
  return (
    <li
      className={`py-2 ${overdue ? '-mx-1.5 rounded-md bg-bad-soft/60 px-1.5' : ''}`}
      aria-busy={pending || undefined}
    >
      <div className="flex items-start gap-2">
        <input
          id={checkId}
          type="checkbox"
          checked={done}
          disabled={!canEdit || pending}
          aria-describedby={reasonId}
          onChange={() =>
            void onUpdate(
              a.id,
              { status: done ? 'open' : 'done' },
              done ? `Reopened “${a.title}”` : `“${a.title}” done`,
            )
          }
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent disabled:cursor-not-allowed"
        />
        <div className="min-w-0 flex-1">
          <label
            htmlFor={checkId}
            className={`block break-words text-[12.5px] font-medium ${done ? 'text-muted line-through' : 'text-ink'}`}
          >
            <span className="sr-only">{done ? 'Done: ' : 'Mark done: '}</span>
            {a.title}
          </label>
          {a.detail && <p className="break-words text-[11.5px] text-muted">{a.detail}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
            {a.status === 'in-progress' && <StatusBadge tone="info" label="In progress" />}
            {a.due && (
              <span className={overdue ? 'font-semibold text-bad' : undefined}>
                Due {formatDay(fromInputDate(a.due))}
              </span>
            )}
            {overdue && <StatusBadge tone="bad" label="Overdue" />}
            {done && a.doneAt && <span>Done {formatDay(new Date(a.doneAt))}</span>}
          </div>
        </div>
        <GuardedButton
          size="sm"
          variant="ghost"
          allowed={canDelete}
          reason={DELETE_REASON}
          disabled={pending}
          aria-label={`Delete “${a.title}”`}
          icon={<Trash2Icon className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => {
            if (window.confirm(`Delete “${a.title}”? This is recorded on the timeline.`))
              void onDelete(a.id);
          }}
        />
      </div>
      <label className="mt-1.5 flex items-center gap-2 pl-6 text-[11.5px] text-muted">
        <span className="shrink-0">Owner</span>
        <select
          value={a.owner}
          disabled={!canEdit || pending}
          aria-label={`Owner of “${a.title}”`}
          aria-describedby={reasonId}
          onChange={(e) => {
            const next = e.target.value;
            void onUpdate(a.id, { owner: next }, `Reassigned to ${nameOf(next)}`);
          }}
          className={`${fieldClass} h-7`}
        >
          {ownerOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

function AddActionForm({
  owners,
  me,
  canEdit,
  busy,
  onAdd,
  reasonId,
}: IncidentActionsViewProps & { reasonId?: string }) {
  const ids = { title: useId(), owner: useId(), due: useId(), kind: useId() };
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [kind, setKind] = useState<ApiIncidentAction['kind']>('mitigation');
  const pending = busy.has('new');
  const disabled = !canEdit || pending;
  const ownerValue =
    owner || (owners.some((m) => m.id === me) ? (me ?? '') : (owners[0]?.id ?? ''));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !ownerValue) return;
    const ok = await onAdd({ title: title.trim(), owner: ownerValue, due: due || null, kind });
    if (ok) {
      setTitle('');
      setDue('');
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="Add a recovery step"
      className="mt-2.5 space-y-2 border-t border-line px-3.5 py-2.5"
    >
      <div>
        <label htmlFor={ids.title} className="mb-0.5 block text-[11.5px] font-medium text-ink">
          Step
        </label>
        <input
          id={ids.title}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Roll back the CDN config"
          disabled={disabled}
          aria-describedby={reasonId}
          className={fieldClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={ids.owner} className="mb-0.5 block text-[11.5px] font-medium text-ink">
            Owner
          </label>
          <select
            id={ids.owner}
            value={ownerValue}
            onChange={(e) => setOwner(e.target.value)}
            disabled={disabled}
            aria-describedby={reasonId}
            className={fieldClass}
          >
            {owners.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.due} className="mb-0.5 block text-[11.5px] font-medium text-ink">
            Due <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id={ids.due}
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            disabled={disabled}
            aria-describedby={reasonId}
            className={fieldClass}
          />
        </div>
      </div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={ids.kind} className="mb-0.5 block text-[11.5px] font-medium text-ink">
            Kind
          </label>
          <select
            id={ids.kind}
            value={kind}
            onChange={(e) => setKind(e.target.value as ApiIncidentAction['kind'])}
            disabled={disabled}
            aria-describedby={reasonId}
            className={fieldClass}
          >
            <option value="mitigation">Mitigation</option>
            <option value="follow-up">Follow-up</option>
          </select>
        </div>
        <Button
          type="submit"
          size="md"
          variant="primary"
          disabled={disabled || !title.trim() || !ownerValue}
          aria-describedby={reasonId}
          icon={<PlusIcon className="h-3.5 w-3.5" aria-hidden />}
        >
          {pending ? 'Adding…' : 'Add step'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Recovery steps and follow-ups for one incident, wired to the API. After each
 * accepted write the incident is re-read so the server's timeline entry shows.
 */
export function IncidentActions({
  incidentId,
  product,
}: {
  incidentId: string;
  product: ProductId;
}) {
  const { reload } = useIncidents();
  const onWritten = useCallback(() => void reload().catch(() => undefined), [reload]);
  const state = useIncidentActions(incidentId, onWritten);
  const { atLeast } = useServerLevel();
  const directory = useDirectory();
  const owners = useMemo(
    () => directory.members.filter((m) => m.status === 'active' && m.products.includes(product)),
    [directory.members, product],
  );
  return (
    <IncidentActionsView
      {...state}
      owners={owners}
      nameOf={(id) => directory.memberById(id).name}
      me={directory.me}
      canEdit={atLeast('Infrastructure', 'contribute')}
      canDelete={atLeast('Infrastructure', 'manage')}
      today={toInputDate(new Date())}
      onAdd={state.add}
      onUpdate={state.update}
      onDelete={state.remove}
    />
  );
}
