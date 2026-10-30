import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CircleCheckIcon, KeyRoundIcon, PlugIcon, RotateCwIcon, UnplugIcon } from 'lucide-react';
import { DetailHeader } from '../components/ui/DetailHeader';
import { Panel } from '../components/ui/Panel';
import { MetaList } from '../components/ui/MetaList';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Segmented } from '../components/ui/Segmented';
import { ProductMark } from '../components/ui/ProductMark';
import { Button } from '../components/ui/Button';
import { NotFound } from '../components/ui/NotFound';
import { IntegrationsIllustration } from '../components/illustrations/IntegrationsIllustration';
import { IntegrationPermissions } from '../components/integrations/IntegrationPermissions';
import { IntegrationWebhooks } from '../components/integrations/IntegrationWebhooks';
import { useReauth } from '../contexts/ReauthContext';
import { integrations } from '../data/team';
import { integrationConfigs } from '../data/security';
import { products } from '../data/portfolio';
import { memberById } from '../utils/status';
import type { ProductId, Tone } from '../types/portfolio';
import type { IntegrationConfig } from '../types/security';

type Tab = 'config' | 'permissions' | 'webhooks' | 'danger';

const statusMeta: Record<string, { label: string; tone: Tone }> = {
  connected: { label: 'Connected', tone: 'ok' },
  degraded: { label: 'Degraded', tone: 'warn' },
  'not-connected': { label: 'Not connected', tone: 'neutral' },
  planned: { label: 'Planned', tone: 'info' },
};

function fallbackConfig(id: string, name: string): IntegrationConfig {
  return {
    id,
    account: `${name.toLowerCase().replace(/\s/g, '-')}.techorg`,
    installedBy: 'm1',
    installed: 'May 2',
    scopes: [
      {
        key: 'read',
        label: 'Read events',
        description: 'Receive status events from the provider',
        granted: true,
        required: true,
      },
    ],
    settings: [
      {
        key: 'notify',
        label: 'Notify owners on failures',
        description: 'Alerts go to Owners and Operations',
        enabled: true,
      },
    ],
    mappings: [],
    deliveries: [],
  };
}

export function IntegrationDetail() {
  const { integrationId } = useParams();
  const navigate = useNavigate();
  const { requestReauth } = useReauth();
  const integration = integrations.find((i) => i.id === integrationId);
  const [tab, setTab] = useState<Tab>('config');
  const config = integration
    ? (integrationConfigs.find((c) => c.id === integration.id) ??
      fallbackConfig(integration.id, integration.name))
    : undefined;
  const [settings, setSettings] = useState(config?.settings ?? []);
  const [mappings, setMappings] = useState(config?.mappings ?? []);
  const [confirmName, setConfirmName] = useState('');
  const [connecting, setConnecting] = useState(false);

  if (!integration || !config)
    return <NotFound what="Integration" backTo="/integrations" backLabel="Back to integrations" />;
  const meta = statusMeta[integration.status];

  if (integration.status === 'not-connected' || integration.status === 'planned') {
    return (
      <div className="space-y-4">
        <DetailHeader
          crumbs={[{ label: 'Integrations', to: '/integrations' }, { label: integration.name }]}
          title={integration.name}
          eyebrow={integration.category}
          badges={<StatusBadge {...meta} dot />}
        />
        <div className="grid gap-4 rounded-lg border border-line p-4 md:grid-cols-[1fr_260px] md:items-center">
          <div>
            <h2 className="text-[14px] font-semibold text-ink">
              {integration.status === 'planned'
                ? 'Coming in a later phase'
                : `Connect ${integration.name}`}
            </h2>
            <p className="mt-1 text-[12.5px] text-muted">{integration.authority}</p>
            {integration.status === 'not-connected' && (
              <>
                <ol className="mt-3 space-y-1.5 text-[12.5px] text-ink">
                  {[
                    'Authorize DevHQ on the provider (read-only by default)',
                    'Choose which projects to map to DevHQ products',
                    'Verify the signed webhook with a test event',
                  ].map((s, i) => (
                    <li key={s} className="flex gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken font-mono text-[10.5px] text-muted">
                        {i + 1}
                      </span>
                      {s}
                    </li>
                  ))}
                </ol>
                <Button
                  variant="primary"
                  className="mt-4"
                  disabled={connecting}
                  icon={<PlugIcon className="h-3.5 w-3.5" />}
                  onClick={() =>
                    requestReauth({
                      title: `Connect ${integration.name}`,
                      description: 'Adding an integration is an administrative action.',
                      actionLabel: 'Verify & continue',
                      onConfirm: () => {
                        setConnecting(true);
                        toast('Redirecting to provider…', {
                          description: 'You’ll come back here after authorizing.',
                        });
                      },
                    })
                  }
                >
                  {connecting ? 'Waiting for provider…' : `Connect ${integration.name}`}
                </Button>
              </>
            )}
          </div>
          <IntegrationsIllustration className="mx-auto h-28 w-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DetailHeader
        crumbs={[{ label: 'Integrations', to: '/integrations' }, { label: integration.name }]}
        eyebrow={integration.category}
        title={integration.name}
        badges={
          <>
            <StatusBadge {...meta} dot />
            <span className="font-mono text-[12px] text-muted">{config.account}</span>
            <span className="text-[12px] text-subtle">· synced {integration.lastSync}</span>
          </>
        }
        actions={
          <Button
            icon={<RotateCwIcon className="h-3.5 w-3.5" />}
            onClick={() =>
              toast.success('Sync started', {
                description: 'Idempotent — re-running never duplicates records.',
              })
            }
          >
            Sync now
          </Button>
        }
      />

      <Segmented<Tab>
        label="Integration sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'config', label: 'Configuration' },
          {
            value: 'permissions',
            label: 'Permissions',
            count: config.scopes.filter((s) => s.granted).length,
          },
          { value: 'webhooks', label: 'Webhooks' },
          { value: 'danger', label: 'Danger zone' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_272px]">
        <div className="min-w-0">
          {tab === 'config' && (
            <div className="space-y-4">
              <Panel title="Behaviour">
                <ul className="divide-y divide-line">
                  {settings.map((s) => (
                    <li key={s.key} className="flex items-center gap-3 px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-medium text-ink">{s.label}</p>
                        <p className="text-[11.5px] text-muted">{s.description}</p>
                      </div>
                      <button
                        role="switch"
                        aria-checked={s.enabled}
                        aria-label={s.label}
                        onClick={() => {
                          setSettings((l) =>
                            l.map((x) => (x.key === s.key ? { ...x, enabled: !x.enabled } : x)),
                          );
                          toast.success('Setting saved');
                        }}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ${s.enabled ? 'bg-accent' : 'bg-line-strong'}`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${s.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              </Panel>
              {mappings.length > 0 && (
                <Panel title="Product mapping" meta={<span>{mappings.length} linked</span>}>
                  <ul className="divide-y divide-line">
                    {mappings.map((m, i) => (
                      <li key={m.external} className="flex items-center gap-2.5 px-3.5 py-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                          {m.external}
                        </span>
                        <span className="text-[11px] text-subtle">→</span>
                        <ProductMark product={m.product} size="sm" />
                        <select
                          aria-label={`Product for ${m.external}`}
                          value={m.product}
                          onChange={(e) =>
                            setMappings((l) =>
                              l.map((x, j) =>
                                j === i ? { ...x, product: e.target.value as ProductId } : x,
                              ),
                            )
                          }
                          className="h-7 rounded-md border border-line bg-white px-1.5 text-[12px]"
                        >
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
              {config.credential && (
                <Panel title="Credential" meta={<span>Encrypted at rest · Owners only</span>}>
                  <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                    <KeyRoundIcon className="h-4 w-4 text-muted" />
                    <span className="text-[12.5px] text-ink">{config.credential.label}</span>
                    <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[12px] text-muted">
                      {config.credential.hint}
                    </code>
                    <span className="text-[11.5px] text-subtle">
                      rotated {config.credential.rotated}
                    </span>
                    <Button
                      size="sm"
                      className="ml-auto"
                      onClick={() =>
                        requestReauth({
                          title: 'Replace credential',
                          description:
                            'Paste the new token on the next step. The old one is deleted immediately.',
                          actionLabel: 'Verify & continue',
                          successMessage: 'Credential replaced',
                          onConfirm: () => undefined,
                        })
                      }
                    >
                      Replace
                    </Button>
                  </div>
                </Panel>
              )}
            </div>
          )}

          {tab === 'permissions' && (
            <IntegrationPermissions scopes={config.scopes} name={integration.name} />
          )}
          {tab === 'webhooks' && <IntegrationWebhooks config={config} />}

          {tab === 'danger' && (
            <Panel title="Disconnect integration">
              <div className="space-y-3 px-3.5 py-3">
                <p className="text-[12.5px] text-muted">
                  Stops syncing and deletes stored credentials. Records already synced stay, marked
                  as from a disconnected source. Uninstall the app on the provider side too.
                </p>
                <label className="block">
                  <span className="text-[12px] text-ink">
                    Type <b className="font-mono">{integration.name}</b> to confirm
                  </span>
                  <input
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    className="mt-1 h-8 w-full max-w-xs rounded-md border border-line px-2.5 text-[12.5px] outline-none focus:border-bad"
                  />
                </label>
                <Button
                  variant="danger"
                  disabled={confirmName !== integration.name}
                  icon={<UnplugIcon className="h-3.5 w-3.5" />}
                  onClick={() =>
                    requestReauth({
                      title: `Disconnect ${integration.name}`,
                      description: 'This cannot be undone without reconnecting.',
                      actionLabel: 'Verify & disconnect',
                      successMessage: `${integration.name} disconnected`,
                      onConfirm: () => navigate('/integrations'),
                    })
                  }
                >
                  Disconnect
                </Button>
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
                  value: <span className="truncate font-mono text-[11.5px]">{config.account}</span>,
                },
                { label: 'Installed by', value: memberById(config.installedBy).name },
                { label: 'Installed', value: config.installed },
                { label: 'Last sync', value: integration.lastSync },
              ]}
            />
          </Panel>
          <Panel title="What it syncs">
            <ul className="space-y-1.5 px-3.5 py-2.5">
              {integration.syncs.map((s) => (
                <li key={s} className="flex items-center gap-2 text-[12.5px] text-ink">
                  <CircleCheckIcon className="h-3.5 w-3.5 text-ok" />
                  {s}
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-3.5 py-2.5 text-[11.5px] text-muted">
              {integration.authority}
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
