import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CircleCheckIcon, PlugIcon, UnplugIcon } from 'lucide-react';
import { DetailHeader } from '../components/ui/DetailHeader';
import { Panel } from '../components/ui/Panel';
import { MetaList } from '../components/ui/MetaList';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Segmented } from '../components/ui/Segmented';
import { NotFound } from '../components/ui/NotFound';
import { Button } from '../components/ui/Button';
import { IntegrationsIllustration } from '../components/illustrations/IntegrationsIllustration';
import { IntegrationPermissions } from '../components/integrations/IntegrationPermissions';
import { IntegrationWebhooks } from '../components/integrations/IntegrationWebhooks';
import {
  BUILT_IN_KINDS,
  integrationKinds,
  kindMeta,
  statusMeta,
  validateHttpsUrl,
} from '../components/integrations/catalogue';
import { Field, inputClass } from '../components/ui/Modal';
import {
  DataState,
  GuardedButton,
  InlineError,
  SampleDataBadge,
} from '../components/engineering/states';
import {
  useIntegrations,
  useServerLevel,
  type ConnectInput,
} from '../components/engineering/data/hooks';
import type { ApiConnectResponse, ApiIntegration } from '../components/engineering/data/types';
import { memberById } from '../utils/status';
import { formatDateTime } from '../utils/date';

type Tab = 'overview' | 'permissions' | 'webhooks' | 'danger';

const MANAGE_REASON = 'Needs Administration: manage — ask an Owner';

export function IntegrationDetail() {
  const { integrationId = '' } = useParams();
  const list = useIntegrations();
  const { atLeast } = useServerLevel();
  const canManage = atLeast('Administration', 'manage');

  if (list.status !== 'ready')
    return (
      <div className="space-y-4">
        <DetailHeader
          crumbs={[{ label: 'Integrations', to: '/integrations' }, { label: integrationId }]}
          title={kindMeta(integrationId).name}
        />
        <DataState
          status={list.status}
          error={list.error}
          what="Integrations"
          onRetry={() => void list.reload()}
        />
      </div>
    );

  const row =
    list.items.find((i) => i.id === integrationId) ??
    list.items.find((i) => i.kind === integrationId && (i.builtIn || i.status === 'available'));
  const builtIn = !!row?.builtIn || BUILT_IN_KINDS.has(row?.kind ?? integrationId);
  if (row && (builtIn || (row.status !== 'available' && row.status !== 'disconnected')))
    return (
      <Connected
        integration={row}
        canManage={canManage}
        builtIn={builtIn}
        onDisconnect={() => list.disconnect(row.id)}
      />
    );

  // No live connection: offer to connect a known kind (or one the API lists as available).
  const kind = row?.kind ?? integrationKinds.find((k) => k.kind === integrationId)?.kind;
  if (!kind)
    return <NotFound what="Integration" backTo="/integrations" backLabel="Back to integrations" />;
  return (
    <ConnectScreen
      kind={kind}
      name={row?.name}
      canManage={canManage}
      onConnect={(k, input) => list.connect(k, input)}
    />
  );
}

function ConnectScreen({
  kind,
  name,
  canManage,
  onConnect,
}: {
  kind: string;
  name?: string;
  canManage: boolean;
  onConnect: (kind: string, input: ConnectInput) => Promise<ApiConnectResponse | undefined>;
}) {
  const meta = kindMeta(kind, name);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [secret, setSecret] = useState<{ value: string; id?: string } | null>(null);
  const needsKey = kind === 'pagerduty';
  const targetError = needsKey
    ? /^[A-Za-z0-9]{32}$/.test(target)
      ? null
      : 'A PagerDuty routing key is 32 letters and digits.'
    : validateHttpsUrl(target);

  const connect = async () => {
    if (targetError) {
      setError(new Error(targetError));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input: ConnectInput = needsKey ? { routingKey: target } : { url: target };
      if (label.trim()) input.name = label.trim();
      const res = await onConnect(kind, input);
      if (res?.signingSecret) {
        // Shown once: the server never returns it again.
        setSecret({ value: res.signingSecret, id: res.id });
        toast.success(`${meta.name} connected`);
        return;
      }
      if (res?.redirectUrl) {
        if (/^https:\/\//.test(res.redirectUrl)) {
          window.location.assign(res.redirectUrl);
          return;
        }
        throw new Error('The server returned an unsafe redirect URL; refusing to follow it.');
      }
      toast.success(`${meta.name} connected`);
      if (res?.id && res.id !== kind) navigate(`/integrations/${encodeURIComponent(res.id)}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <DetailHeader
        crumbs={[{ label: 'Integrations', to: '/integrations' }, { label: meta.name }]}
        title={meta.name}
        eyebrow={meta.category}
        badges={<StatusBadge {...statusMeta['not-connected']} dot />}
      />
      <div className="grid gap-4 rounded-lg border border-line p-4 md:grid-cols-[1fr_260px] md:items-center">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">Connect {meta.name}</h2>
          {meta.description && <p className="mt-1 text-[12.5px] text-muted">{meta.description}</p>}
          {meta.authority && <p className="mt-1 text-[12.5px] text-muted">{meta.authority}</p>}
          {secret ? (
            <div className="mt-4 space-y-2 rounded-md border border-warn/40 bg-warn-soft/50 p-3">
              <p className="text-[12.5px] font-semibold text-ink">
                Signing secret — copy it now, it won’t be shown again
              </p>
              <code className="block break-all rounded bg-white px-2 py-1 font-mono text-[12px]">
                {secret.value}
              </code>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void navigator.clipboard?.writeText(secret.value)}>
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    navigate(
                      secret.id
                        ? `/integrations/${encodeURIComponent(secret.id)}`
                        : '/integrations',
                    )
                  }
                >
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="mt-4 grid max-w-md gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void connect();
              }}
            >
              <Field label="Name (optional)">
                <input
                  className={inputClass}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={meta.name}
                  disabled={!canManage}
                />
              </Field>
              <Field
                label={
                  needsKey ? 'Routing key' : kind === 'slack' ? 'Slack webhook URL' : 'Endpoint URL'
                }
                hint={needsKey ? 'From the PagerDuty Events API v2 integration' : 'https only'}
              >
                <input
                  className={`${inputClass} font-mono`}
                  value={target}
                  onChange={(e) => setTarget(e.target.value.trim())}
                  required
                  disabled={!canManage}
                  aria-invalid={!!target && !!targetError}
                  autoComplete="off"
                />
              </Field>
              <div>
                <GuardedButton
                  type="submit"
                  allowed={canManage}
                  reason={MANAGE_REASON}
                  variant="primary"
                  disabled={busy || !target}
                  icon={<PlugIcon className="h-3.5 w-3.5" />}
                >
                  {busy ? 'Connecting…' : `Connect ${meta.name}`}
                </GuardedButton>
              </div>
            </form>
          )}
          <InlineError error={error} />
        </div>
        <IntegrationsIllustration className="mx-auto h-28 w-auto" />
      </div>
    </div>
  );
}

function Connected({
  integration: i,
  canManage,
  builtIn,
  onDisconnect,
}: {
  integration: ApiIntegration;
  canManage: boolean;
  builtIn: boolean;
  onDisconnect: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const meta = kindMeta(i.kind, i.name);
  const [tab, setTab] = useState<Tab>('overview');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const name = i.name || meta.name;

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDisconnect();
      toast.success(`${name} disconnected`);
      navigate('/integrations');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <DetailHeader
        crumbs={[{ label: 'Integrations', to: '/integrations' }, { label: name }]}
        eyebrow={meta.category}
        title={name}
        badges={
          <>
            <StatusBadge {...statusMeta[i.status]} dot />
            <SampleDataBadge source={i.source} />
            {i.account && <span className="font-mono text-[12px] text-muted">{i.account}</span>}
          </>
        }
      />

      <Segmented<Tab>
        label="Integration sections"
        value={tab}
        onChange={setTab}
        options={
          builtIn
            ? [{ value: 'overview', label: 'Overview' }]
            : [
                { value: 'overview', label: 'Overview' },
                { value: 'permissions', label: 'Events', count: i.scopes?.length ?? 0 },
                { value: 'webhooks', label: 'Webhooks' },
                { value: 'danger', label: 'Danger zone' },
              ]
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_272px]">
        <div className="min-w-0">
          {tab === 'overview' && (
            <Panel title="What it syncs">
              <ul className="space-y-1.5 px-3.5 py-2.5">
                <li className="flex items-center gap-2 text-[12.5px] text-ink">
                  <CircleCheckIcon className="h-3.5 w-3.5 text-ok" aria-hidden />
                  {i.description || meta.description || 'Events from the provider.'}
                </li>
              </ul>
              {meta.authority && (
                <p className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">
                  {meta.authority}
                </p>
              )}
            </Panel>
          )}
          {tab === 'permissions' && <IntegrationPermissions scopes={i.scopes ?? []} name={name} />}
          {tab === 'webhooks' && (
            <IntegrationWebhooks
              integrationId={i.id}
              canManage={canManage}
              urlRequired={i.kind === 'webhook'}
            />
          )}
          {tab === 'danger' && (
            <Panel title="Disconnect integration">
              <div className="space-y-3 px-3.5 py-3">
                <p className="text-[12.5px] text-muted">
                  Stops syncing and deletes stored credentials. Records already synced stay, marked
                  as from a disconnected source. Uninstall the app on the provider side too.
                </p>
                <label className="block">
                  <span className="text-[12px] text-ink">
                    Type <b className="font-mono">{name}</b> to confirm
                  </span>
                  <input
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    disabled={!canManage}
                    className="mt-1 h-8 w-full max-w-xs rounded-md border border-line px-2.5 text-[12.5px] outline-none focus:border-bad disabled:bg-sunken"
                  />
                </label>
                <GuardedButton
                  allowed={canManage}
                  reason={MANAGE_REASON}
                  variant="danger"
                  disabled={confirmName !== name || busy}
                  icon={<UnplugIcon className="h-3.5 w-3.5" />}
                  onClick={() => void disconnect()}
                >
                  {busy ? 'Disconnecting…' : 'Disconnect'}
                </GuardedButton>
                <InlineError error={error} />
              </div>
            </Panel>
          )}
        </div>

        <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
          <Panel title="Connection">
            <MetaList
              items={[
                {
                  label: 'Account',
                  value: (
                    <span className="truncate font-mono text-[11.5px]">{i.account ?? '—'}</span>
                  ),
                },
                {
                  label: 'Connected by',
                  value: i.connectedBy ? (memberById(i.connectedBy)?.name ?? i.connectedBy) : '—',
                },
                {
                  label: 'Connected',
                  value: i.connectedAt ? formatDateTime(new Date(i.connectedAt)) : '—',
                },
                {
                  label: 'Last event',
                  value: i.lastEventAt ? formatDateTime(new Date(i.lastEventAt)) : '—',
                },
              ]}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
