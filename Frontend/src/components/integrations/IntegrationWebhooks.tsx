import React, { useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CopyIcon, PlusIcon, ShieldAlertIcon, Trash2Icon, WebhookIcon } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { Modal, Field, inputClass } from '../ui/Modal';
import { StatusBadge } from '../ui/StatusBadge';
import { DataState, GuardedButton, InlineError, LoadMore } from '../engineering/states';
import { useIntegrationWebhooks } from '../engineering/data/hooks';
import type { ApiWebhook, ApiWebhookDelivery } from '../engineering/data/types';
import { formatDateTime } from '../../utils/date';
import { validateHttpsUrl, webhookEventTypes } from './catalogue';

const MANAGE_REASON = 'Needs Administration: manage — ask an Owner';

/** Puts focus back on the control that opened a dialog once it closes. */
function useReturnFocus() {
  const trigger = useRef<HTMLElement | null>(null);
  const remember = (e: React.SyntheticEvent<HTMLElement>) => {
    trigger.current = e.currentTarget;
  };
  const restore = () => {
    const el = trigger.current;
    setTimeout(() => el?.focus(), 0);
  };
  return { remember, restore };
}

export function IntegrationWebhooks({
  integrationId,
  canManage,
  urlRequired = true,
}: {
  integrationId: string;
  canManage: boolean;
  /** Slack/PagerDuty subscriptions post to the integration's own target; only generic webhooks take a URL. */
  urlRequired?: boolean;
}) {
  const [testError, setTestError] = useState<unknown>(null);
  const hooks = useIntegrationWebhooks(integrationId);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<ApiWebhook | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const [secret, setSecret] = useState<{ url: string; value: string } | null>(null);
  const addFocus = useReturnFocus();
  const delFocus = useReturnFocus();

  const deliveries = useMemo(
    () =>
      hooks.items
        .flatMap((w) => (w.deliveries ?? []).map((d) => ({ ...d, endpoint: w.url })))
        .sort((a, b) => b.at.localeCompare(a.at)),
    [hooks.items],
  );

  if (hooks.status !== 'ready')
    return (
      <DataState
        status={hooks.status}
        error={hooks.error}
        what="Webhook endpoints"
        onRetry={() => void hooks.reload()}
      />
    );

  const closeDelete = () => {
    setDeleting(null);
    setDeleteError(null);
    delFocus.restore();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyDelete(true);
    setDeleteError(null);
    try {
      await hooks.remove(deleting.id);
      toast.success('Endpoint removed', { description: deleting.url });
      closeDelete();
    } catch (e) {
      setDeleteError(e);
    } finally {
      setBusyDelete(false);
    }
  };

  return (
    <div className="space-y-4">
      {secret && (
        <div
          role="alert"
          className="rounded-lg border border-warn/40 bg-warn-soft/60 px-3.5 py-3 text-[12.5px] text-ink"
        >
          <p className="flex items-center gap-1.5 font-semibold">
            <ShieldAlertIcon className="h-4 w-4 text-warn" aria-hidden />
            Copy the signing secret now — it won’t be shown again
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-muted">For {secret.url}</p>
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-white px-2.5 py-1.5 font-mono text-[12px]">
              {secret.value}
            </code>
            <Button
              size="sm"
              icon={<CopyIcon className="h-3.5 w-3.5" />}
              onClick={() => {
                void navigator.clipboard?.writeText(secret.value);
                toast.success('Secret copied');
              }}
            >
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      <Panel
        title="Endpoints"
        meta={<span>HMAC-SHA256 signed · retried with backoff</span>}
        action={
          <GuardedButton
            allowed={canManage}
            reason={MANAGE_REASON}
            size="sm"
            icon={<PlusIcon className="h-3.5 w-3.5" />}
            onClick={(e) => {
              addFocus.remember(e);
              setAdding(true);
            }}
          >
            Add endpoint
          </GuardedButton>
        }
      >
        {hooks.items.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <WebhookIcon className="h-6 w-6 text-subtle" aria-hidden />
            <p className="mt-2 text-[12.5px] text-muted">
              No outbound webhooks yet. Add an endpoint to receive signed TavetaHQ events.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {hooks.items.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-2.5 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[12px] text-ink">
                    {w.url || 'Integration target'}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-muted">
                    {w.events.map((ev) => (
                      <span key={ev} className="rounded bg-sunken px-1.5 py-px font-mono">
                        {ev}
                      </span>
                    ))}
                    {w.secretHint && <span>· secret …{w.secretHint}</span>}
                    <span>· added {formatDateTime(new Date(w.createdAt))}</span>
                  </p>
                </div>
                <StatusBadge
                  tone={w.active ? 'ok' : 'neutral'}
                  label={w.active ? 'Active' : 'Paused'}
                  dot
                />
                <GuardedButton
                  allowed={canManage}
                  reason={MANAGE_REASON}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTestError(null);
                    hooks
                      .test(w.id)
                      .then(() => toast.success('Test delivery queued'))
                      .catch((err: unknown) => setTestError(err));
                  }}
                >
                  Send test
                </GuardedButton>
                <GuardedButton
                  allowed={canManage}
                  reason={MANAGE_REASON}
                  size="sm"
                  variant="ghost"
                  icon={<Trash2Icon className="h-3.5 w-3.5" />}
                  aria-label={`Remove endpoint ${w.url}`}
                  onClick={(e) => {
                    delFocus.remember(e);
                    setDeleting(w);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <InlineError error={testError} />
        <LoadMore hasMore={hooks.hasMore} loading={hooks.loadingMore} onClick={hooks.loadMore} />
      </Panel>

      <Panel title="Delivery log" meta={<span>{deliveries.length} recent</span>}>
        {deliveries.length === 0 ? (
          <p className="px-3.5 py-4 text-[12.5px] text-muted">No deliveries recorded yet.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[680px] text-[12px]">
              <caption className="sr-only">Outbound webhook deliveries, newest first</caption>
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] text-muted">
                  <th scope="col" className="px-3.5 py-2 font-medium">
                    Result
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Event
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Endpoint
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Attempt
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Duration
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-3.5 py-2 font-medium">
                    Next retry
                  </th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <DeliveryRow key={d.id} d={d} endpoint={d.endpoint} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <AddEndpointModal
        urlRequired={urlRequired}
        open={adding}
        onClose={() => {
          setAdding(false);
          addFocus.restore();
        }}
        onAdd={async (body) => {
          const created = await hooks.add(body);
          if (created?.secret) setSecret({ url: created.url, value: created.secret });
          toast.success('Subscription added', { description: body.url || undefined });
        }}
      />

      <Modal
        open={!!deleting}
        onClose={closeDelete}
        size="sm"
        title="Remove endpoint?"
        description={deleting?.url}
        footer={
          <>
            <Button size="sm" onClick={closeDelete}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              data-autofocus
              disabled={busyDelete}
              onClick={() => void confirmDelete()}
            >
              {busyDelete ? 'Removing…' : 'Remove'}
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-muted">
          TavetaHQ stops delivering events to this URL. Pending retries are cancelled.
        </p>
        <InlineError error={deleteError} />
      </Modal>
    </div>
  );
}

function DeliveryRow({ d, endpoint }: { d: ApiWebhookDelivery; endpoint: string }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-3.5 py-2">
        <span
          className={`inline-block min-w-[40px] rounded px-1 text-center font-mono text-[11px] font-semibold ${d.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}
          title={d.error}
        >
          {d.httpStatus ?? 'ERR'}
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-ink">{d.event}</td>
      <td className="max-w-[220px] truncate px-3 py-2 font-mono text-muted">{endpoint}</td>
      <td className="px-3 py-2 text-right tabular-nums text-muted">{d.attempt ?? 1}</td>
      <td className="px-3 py-2 text-right tabular-nums text-muted">
        {d.durationMs !== undefined ? `${d.durationMs}ms` : '—'}
      </td>
      <td className="px-3 py-2 tabular-nums text-muted">{formatDateTime(new Date(d.at))}</td>
      <td className="px-3.5 py-2 tabular-nums text-muted">
        {d.nextRetryAt ? formatDateTime(new Date(d.nextRetryAt)) : d.ok ? '—' : 'Gave up'}
      </td>
    </tr>
  );
}

function AddEndpointModal({
  open,
  onClose,
  onAdd,
  urlRequired,
}: {
  urlRequired: boolean;
  open: boolean;
  onClose: () => void;
  onAdd: (body: { url: string; events: string[] }) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['incident.opened', 'incident.resolved']);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const urlErrId = useId();

  const urlError = !urlRequired && !url ? null : validateHttpsUrl(url);
  const eventsError = events.length ? null : 'Pick at least one event.';

  const close = () => {
    setUrl('');
    setEvents(['incident.opened', 'incident.resolved']);
    setTouched(false);
    setError(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (urlError || eventsError) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd({ url: url.trim(), events });
      close();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add webhook endpoint"
      description="TavetaHQ signs every payload with HMAC-SHA256. The signing secret is shown once."
      footer={
        <>
          <Button size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" form="add-endpoint" disabled={busy}>
            {busy ? 'Adding…' : 'Add endpoint'}
          </Button>
        </>
      }
    >
      <form id="add-endpoint" onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
        <Field
          label="Payload URL"
          hint="https:// only. Private and internal addresses are rejected."
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="https://hooks.example.com/devhq"
            inputMode="url"
            aria-invalid={touched && !!urlError}
            aria-describedby={touched && urlError ? urlErrId : undefined}
            className={inputClass}
          />
        </Field>
        {touched && urlError && (
          <p id={urlErrId} className="-mt-2 text-[11.5px] text-bad">
            {urlError}
          </p>
        )}
        <fieldset>
          <legend className="text-[12px] font-medium text-ink">Events</legend>
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            {webhookEventTypes.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={events.includes(ev)}
                  onChange={() =>
                    setEvents((l) => (l.includes(ev) ? l.filter((x) => x !== ev) : [...l, ev]))
                  }
                  className="h-3.5 w-3.5 accent-[#4F46E5]"
                />
                <span className="font-mono text-ink">{ev}</span>
              </label>
            ))}
          </div>
          {touched && eventsError && (
            <p className="mt-1 text-[11.5px] text-bad" role="alert">
              {eventsError}
            </p>
          )}
        </fieldset>
        <InlineError error={error} />
      </form>
    </Modal>
  );
}
