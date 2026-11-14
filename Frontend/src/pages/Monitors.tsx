import React, { useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PencilIcon, PlusIcon, RefreshCwIcon, ServerOffIcon, Trash2Icon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { ProductMark } from '../components/ui/ProductMark';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Sparkline } from '../components/ui/Sparkline';
import { Button } from '../components/ui/Button';
import { Modal, Field, inputClass } from '../components/ui/Modal';
import {
  DataState,
  GuardedButton,
  InlineError,
  LoadMore,
  SampleDataBadge,
} from '../components/engineering/states';
import {
  useMonitorChecks,
  useMonitors,
  useServerLevel,
  type MonitorRow as MonitorRowData,
} from '../components/engineering/data/hooks';
import type {
  ApiMonitor,
  ApiMonitorCheck,
  ApiMonitorStatus,
  MonitorInput,
} from '../components/engineering/data/types';
import { validateHttpsUrl } from '../components/integrations/catalogue';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useAuth } from '../contexts/AuthContext';
import { products } from '../data/portfolio';
import { productById } from '../utils/status';
import { formatDateTime } from '../utils/date';
import type { ProductId, Tone } from '../types/portfolio';

const statusMeta: Record<ApiMonitorStatus, { label: string; tone: Tone }> = {
  up: { label: 'Up', tone: 'ok' },
  degraded: { label: 'Degraded', tone: 'warn' },
  down: { label: 'Down', tone: 'bad' },
  pending: { label: 'Pending', tone: 'neutral' },
  paused: { label: 'Paused', tone: 'neutral' },
};

const INTERVALS = [
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 900, label: 'Every 15 minutes' },
];

/** How many recent checks the bar shows. */
const BAR_CHECKS = 40;
const WRITE_REASON = 'Needs Infrastructure: manage — ask Operations or an Owner';
const DEMO_REASON = 'Sample monitor — read-only. Create your own to edit it.';

/** Puts focus back on the control that opened a dialog once it closes. */
function useReturnFocus() {
  const trigger = useRef<HTMLElement | null>(null);
  return {
    remember: (e: React.SyntheticEvent<HTMLElement>) => {
      trigger.current = e.currentTarget;
    },
    restore: () => {
      const el = trigger.current;
      setTimeout(() => el?.focus(), 0);
    },
  };
}

export function Monitors() {
  const { matches } = useProductFilter();
  const mon = useMonitors();
  const { atLeast } = useServerLevel();
  const canWrite = atLeast('Infrastructure', 'manage');
  const [editing, setEditing] = useState<ApiMonitor | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ApiMonitor | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const formFocus = useReturnFocus();
  const delFocus = useReturnFocus();

  const rows = useMemo(() => mon.items.filter((m) => matches(m.product)), [mon.items, matches]);

  // Per-product uptime is the mean of that product's monitors as the server reports it.
  const summary = useMemo(
    () =>
      products
        .filter((p) => matches(p.id))
        .map((p) => {
          const pcts = rows
            .filter((m) => m.product === p.id && typeof m.uptimePct === 'number')
            .map((m) => m.uptimePct as number);
          return {
            product: p,
            count: rows.filter((m) => m.product === p.id).length,
            uptime: pcts.length
              ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100) / 100
              : null,
          };
        })
        .filter((s) => s.count > 0),
    [rows, matches],
  );

  const closeForm = () => {
    setEditing(null);
    formFocus.restore();
  };
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
      await mon.remove(deleting.id);
      toast.success('Monitor deleted', { description: deleting.name });
      closeDelete();
    } catch (e) {
      setDeleteError(e);
    } finally {
      setBusyDelete(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Monitors"
        description="External HTTP checks run by the TavetaHQ scheduler. Repeated failures open an incident. A successful deploy doesn’t mean a healthy service."
        actions={
          <GuardedButton
            allowed={canWrite}
            reason={WRITE_REASON}
            variant="primary"
            size="sm"
            icon={<PlusIcon className="h-3.5 w-3.5" />}
            onClick={(e) => {
              formFocus.remember(e);
              setEditing('new');
            }}
          >
            New monitor
          </GuardedButton>
        }
      />

      {mon.status !== 'ready' ? (
        <DataState
          status={mon.status}
          error={mon.error}
          what="Monitors"
          onRetry={() => void mon.reload()}
        />
      ) : (
        <>
          {summary.length > 0 && (
            <div className="flex flex-col gap-px overflow-hidden rounded-xl border border-line bg-line sm:flex-row">
              {summary.map((s) => (
                <div
                  key={s.product.id}
                  className="flex flex-1 items-center gap-3 bg-surface px-4 py-3.5"
                >
                  <ProductMark product={s.product.id} size="lg" />
                  <div>
                    <p className="text-xs text-muted">
                      {s.product.name} · {s.count} monitor{s.count === 1 ? '' : 's'}
                    </p>
                    <p
                      className={`text-2xl font-semibold tabular-nums tracking-tight ${s.uptime !== null && s.uptime < 99.5 ? 'text-bad' : 'text-ink'}`}
                    >
                      {s.uptime === null ? '—' : `${s.uptime}%`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Panel
            title="Uptime checks"
            meta={
              <>
                <SampleDataBadge source={mon.items.some((m) => m.readOnly) ? 'demo' : mon.source} />
                <span>{rows.length} monitors · newest check on the right</span>
              </>
            }
          >
            {rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12.5px] text-muted">
                <p>No monitors yet{mon.items.length ? ' for the selected products' : ''}.</p>
                {canWrite && (
                  <p className="mt-1">Add one to start checking an endpoint from the scheduler.</p>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((m) => (
                  <MonitorRow
                    key={m.id}
                    m={m}
                    canWrite={canWrite}
                    onEdit={(e) => {
                      formFocus.remember(e);
                      setEditing(m);
                    }}
                    onDelete={(e) => {
                      delFocus.remember(e);
                      setDeleting(m);
                    }}
                    onCheck={() => mon.checkNow(m.id)}
                  />
                ))}
              </ul>
            )}
            <LoadMore hasMore={mon.hasMore} loading={mon.loadingMore} onClick={mon.loadMore} />
          </Panel>
        </>
      )}

      <Panel title="Hosts">
        <div className="flex items-start gap-3 px-4 py-4 text-[12.5px] text-muted" role="status">
          <ServerOffIcon className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden />
          <p>
            Host metrics need an infrastructure agent — not connected. TavetaHQ shows uptime checks
            only, rather than estimated CPU or memory figures.{' '}
            <Link to="/integrations" className="font-medium text-ink underline">
              Integrations
            </Link>
          </p>
        </div>
      </Panel>

      <MonitorFormModal
        key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')}
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        onClose={closeForm}
        onSubmit={async (input) => {
          if (editing && editing !== 'new') {
            await mon.update(editing.id, input);
            toast.success('Monitor saved', { description: input.name });
          } else {
            await mon.create(input);
            toast.success('Monitor created', { description: input.name });
          }
        }}
      />

      <Modal
        open={!!deleting}
        onClose={closeDelete}
        size="sm"
        title={`Delete ${deleting?.name ?? 'monitor'}?`}
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
              {busyDelete ? 'Deleting…' : 'Delete monitor'}
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-muted">
          Checks stop immediately and the check history is removed. Incidents it opened are kept.
        </p>
        <InlineError error={deleteError} />
      </Modal>
    </div>
  );
}

function MonitorRow({
  m,
  canWrite,
  onEdit,
  onDelete,
  onCheck,
}: {
  m: MonitorRowData;
  canWrite: boolean;
  onEdit: (e: React.MouseEvent<HTMLElement>) => void;
  onDelete: (e: React.MouseEvent<HTMLElement>) => void;
  onCheck: () => Promise<unknown>;
}) {
  const checks = useMonitorChecks(m.id);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<unknown>(null);
  const editable = canWrite && !m.readOnly;
  const reason = canWrite ? DEMO_REASON : WRITE_REASON;
  const runCheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      await onCheck();
      await checks.reload();
    } catch (e) {
      setCheckError(e);
    } finally {
      setChecking(false);
    }
  };
  const status: ApiMonitorStatus = m.paused ? 'paused' : m.status;
  // Checks arrive newest first; bars read left (older) → right (newest).
  const recent = checks.items.slice(0, BAR_CHECKS).reverse();
  const latency = recent.map((c) => c.latencyMs).filter((n): n is number => typeof n === 'number');

  return (
    <li className="grid items-center gap-3 px-4 py-3.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_120px_90px_auto]">
      <div className="flex min-w-0 items-center gap-2.5">
        <ProductMark product={m.product} size="sm" />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="truncate">{m.name}</span>
            <StatusBadge {...statusMeta[status]} dot />
          </p>
          <p className="truncate font-mono text-[11px] text-subtle" title={m.url}>
            {m.method ?? 'GET'} · {m.url}
          </p>
          {m.lastError && status !== 'up' && (
            <p className="truncate text-[11px] text-bad" title={m.lastError}>
              {m.lastError}
            </p>
          )}
          {!!checkError && <InlineError error={checkError} />}
          {m.incidentId && (
            <Link
              to={`/incidents/${encodeURIComponent(m.incidentId)}`}
              className="text-[11px] font-medium text-bad underline"
            >
              Opened {m.incidentId}
            </Link>
          )}
        </div>
      </div>
      <div>
        {checks.status === 'ready' ? (
          recent.length ? (
            <>
              <CheckBars checks={recent} label={`${m.name}: last ${recent.length} checks`} />
              <div className="mt-1 flex justify-between text-[10px] text-subtle">
                <span>{formatDateTime(new Date(recent[0].at))}</span>
                <span>Latest</span>
              </div>
            </>
          ) : (
            <p className="text-[11.5px] text-subtle">No checks yet</p>
          )
        ) : checks.status === 'loading' ? (
          <div className="h-6 animate-pulse rounded bg-sunken" aria-hidden />
        ) : (
          <p className="text-[11.5px] text-subtle">Check history unavailable</p>
        )}
      </div>
      <div className="h-8">
        {latency.length >= 2 ? (
          <Sparkline
            points={latency}
            height={32}
            stroke={status === 'up' ? '#4F46E5' : '#9A5A06'}
            fill={status === 'up' ? '#EEEEFD' : '#FCF1DC'}
            label={`Latency over the last ${latency.length} checks`}
          />
        ) : (
          <p className="text-[11px] text-subtle">Every {Math.round(m.intervalSec / 60) || 1}m</p>
        )}
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums text-ink">
          {typeof m.uptimePct === 'number' ? `${m.uptimePct}%` : '—'}
        </p>
        <p className="text-[11px] tabular-nums text-subtle">
          {typeof m.lastLatencyMs === 'number' ? `${m.lastLatencyMs}ms` : '—'}
        </p>
      </div>
      <div className="flex justify-end gap-1">
        <GuardedButton
          allowed={editable}
          reason={reason}
          size="sm"
          variant="ghost"
          disabled={checking}
          icon={<RefreshCwIcon className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />}
          aria-label={`Check ${m.name} now`}
          onClick={() => void runCheck()}
        />
        <GuardedButton
          allowed={editable}
          reason={reason}
          size="sm"
          variant="ghost"
          icon={<PencilIcon className="h-3.5 w-3.5" />}
          aria-label={`Edit ${m.name}`}
          onClick={onEdit}
        />
        <GuardedButton
          allowed={editable}
          reason={reason}
          size="sm"
          variant="ghost"
          icon={<Trash2Icon className="h-3.5 w-3.5" />}
          aria-label={`Delete ${m.name}`}
          onClick={onDelete}
        />
      </div>
    </li>
  );
}

/**
 * One bar per recorded check, coloured by the server's verdict (up, degraded =
 * slower than the monitor's threshold, down). Nothing is inferred client-side.
 */
const tickOf = (c: ApiMonitorCheck) => c.status ?? (c.ok ? 'up' : 'down');
const tickClass = { up: 'bg-ok opacity-80', degraded: 'bg-warn', down: 'bg-bad' } as const;
function CheckBars({ checks, label }: { checks: ApiMonitorCheck[]; label: string }) {
  const down = checks.filter((c) => tickOf(c) === 'down').length;
  const degraded = checks.filter((c) => tickOf(c) === 'degraded').length;
  return (
    <div
      className="flex h-6 items-stretch gap-[2px]"
      role="img"
      aria-label={`${label}: ${checks.length - down - degraded} up, ${degraded} degraded, ${down} down`}
    >
      {checks.map((c, i) => (
        <span
          key={c.id ?? `${c.at}-${i}`}
          title={`${formatDateTime(new Date(c.at))} · ${tickOf(c)}${c.httpStatus ? ` · HTTP ${c.httpStatus}` : ''}${typeof c.latencyMs === 'number' ? ` · ${c.latencyMs}ms` : ''}${c.error ? ` · ${c.error}` : ''}`}
          className={`flex-1 rounded-[2px] ${tickClass[tickOf(c)]}`}
        />
      ))}
    </div>
  );
}

function MonitorFormModal({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: ApiMonitor | null;
  onClose: () => void;
  onSubmit: (input: MonitorInput) => Promise<void>;
}) {
  const { canSeeProduct } = useAuth();
  const visible = products.filter((p) => canSeeProduct(p.id));
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [product, setProduct] = useState<ProductId | ''>(initial?.product ?? visible[0]?.id ?? '');
  const [intervalSec, setIntervalSec] = useState(initial?.intervalSec ?? 60);
  const [expected, setExpected] = useState(String(initial?.expectedStatus ?? 200));
  const [paused, setPaused] = useState(!!initial?.paused);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ids = { name: useId(), url: useId(), expected: useId() };

  const errors = {
    name: name.trim() ? null : 'Give the monitor a name.',
    url: validateHttpsUrl(url, { allowHttp: true }),
    product: product ? null : 'Pick a product.',
    expected: /^[1-5]\d\d$/.test(expected) ? null : 'Use an HTTP status code, e.g. 200.',
  };
  const invalid = Object.values(errors).some(Boolean);
  const intervals = INTERVALS.some((i) => i.value === intervalSec)
    ? INTERVALS
    : [...INTERVALS, { value: intervalSec, label: `Every ${intervalSec}s` }];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid || !product) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        url: url.trim(),
        product,
        intervalSec,
        expectedStatus: Number(expected),
        ...(initial ? { paused } : {}),
      });
      onClose();
    } catch (err) {
      // Stay open so the member can correct the input the server rejected.
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const errorText = (key: keyof typeof errors, id: string) =>
    touched && errors[key] ? (
      <p id={id} className="mt-1 text-[11.5px] text-bad">
        {errors[key]}
      </p>
    ) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? `Edit ${initial.name}` : 'New monitor'}
      description="The scheduler requests this URL on the interval and records each result. Private, link-local and metadata addresses are blocked by the server."
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" form="monitor-form" disabled={busy}>
            {busy ? 'Saving…' : initial ? 'Save monitor' : 'Create monitor'}
          </Button>
        </>
      }
    >
      <form id="monitor-form" onSubmit={(e) => void submit(e)} className="space-y-3" noValidate>
        <div>
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Checkout API"
              aria-invalid={touched && !!errors.name}
              aria-describedby={touched && errors.name ? ids.name : undefined}
              className={inputClass}
            />
          </Field>
          {errorText('name', ids.name)}
        </div>
        <div>
          <Field label="URL" hint="http:// or https://, no credentials.">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              inputMode="url"
              placeholder="https://api.example.com/health"
              aria-invalid={touched && !!errors.url}
              aria-describedby={touched && errors.url ? ids.url : undefined}
              className={inputClass}
            />
          </Field>
          {errorText('url', ids.url)}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Product">
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value as ProductId)}
              className={inputClass}
            >
              {visible.length === 0 && <option value="">No products</option>}
              {visible.map((p) => (
                <option key={p.id} value={p.id}>
                  {productById(p.id).name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Interval">
            <select
              value={intervalSec}
              onChange={(e) => setIntervalSec(Number(e.target.value))}
              className={inputClass}
            >
              {intervals.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <Field label="Expected status">
              <input
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                inputMode="numeric"
                maxLength={3}
                aria-invalid={touched && !!errors.expected}
                aria-describedby={touched && errors.expected ? ids.expected : undefined}
                className={inputClass}
              />
            </Field>
            {errorText('expected', ids.expected)}
          </div>
        </div>
        {initial && (
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input
              type="checkbox"
              checked={paused}
              onChange={(e) => setPaused(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#4F46E5]"
            />
            Paused
          </label>
        )}
        {touched && errors.product && (
          <p className="text-[11.5px] text-bad" role="alert">
            {errors.product}
          </p>
        )}
        <InlineError error={error} />
      </form>
    </Modal>
  );
}
