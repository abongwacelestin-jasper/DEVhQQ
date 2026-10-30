import { useState } from 'react';
import { toast } from 'sonner';
import { CopyIcon, EyeIcon, RefreshCwIcon, RotateCwIcon } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { useReauth } from '../../contexts/ReauthContext';
import type { IntegrationConfig } from '../../types/security';

export function IntegrationWebhooks({ config }: { config: IntegrationConfig }) {
  const { requestReauth } = useReauth();
  const [revealed, setRevealed] = useState(false);
  const [rotated, setRotated] = useState(config.webhook?.lastRotated ?? '');
  const [events, setEvents] = useState(config.webhook?.events ?? []);
  const hook = config.webhook;

  if (!hook)
    return (
      <p className="rounded-lg border border-line px-3.5 py-4 text-[12.5px] text-muted">
        This integration doesn’t use webhooks.
      </p>
    );

  return (
    <div className="space-y-4">
      <Panel title="Endpoint" meta={<span>HMAC-SHA256 signed</span>}>
        <div className="space-y-3 px-3.5 py-3">
          <div>
            <p className="text-[11.5px] font-medium text-ink">Payload URL</p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-sunken/60 px-2.5 py-1.5 font-mono text-[12px] text-ink">
                {hook.url}
              </code>
              <Button
                size="sm"
                icon={<CopyIcon className="h-3.5 w-3.5" />}
                onClick={() => {
                  navigator.clipboard?.writeText(hook.url);
                  toast.success('URL copied');
                }}
              >
                Copy
              </Button>
            </div>
          </div>
          <div>
            <p className="text-[11.5px] font-medium text-ink">Signing secret</p>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-sunken/60 px-2.5 py-1.5 font-mono text-[12px] text-ink">
                {revealed ? 'whsec_3f8e1c0b9a7d4e2f6a91e' : hook.secretHint}
              </code>
              <Button
                size="sm"
                icon={<EyeIcon className="h-3.5 w-3.5" />}
                onClick={() =>
                  revealed
                    ? setRevealed(false)
                    : requestReauth({
                        title: 'Reveal signing secret',
                        description: 'The secret is shown for 30 seconds, then hidden again.',
                        actionLabel: 'Verify & reveal',
                        onConfirm: () => {
                          setRevealed(true);
                          setTimeout(() => setRevealed(false), 30000);
                        },
                      })
                }
              >
                {revealed ? 'Hide' : 'Reveal'}
              </Button>
              <Button
                size="sm"
                icon={<RotateCwIcon className="h-3.5 w-3.5" />}
                onClick={() =>
                  requestReauth({
                    title: 'Rotate signing secret',
                    description:
                      'The old secret keeps working for 24 hours so the provider can be updated.',
                    actionLabel: 'Verify & rotate',
                    successMessage: 'Secret rotated',
                    onConfirm: () => setRotated('just now'),
                  })
                }
              >
                Rotate
              </Button>
            </div>
            <p className="mt-1 text-[11.5px] text-muted">
              Last rotated {rotated}. Unsigned or replayed payloads are rejected.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="Subscribed events">
        <ul className="grid gap-px bg-line sm:grid-cols-2">
          {events.map((e) => (
            <li key={e.key} className="bg-white">
              <label className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2">
                <input
                  type="checkbox"
                  checked={e.enabled}
                  onChange={() =>
                    setEvents((l) =>
                      l.map((x) => (x.key === e.key ? { ...x, enabled: !x.enabled } : x)),
                    )
                  }
                  className="h-3.5 w-3.5 accent-[#4F46E5]"
                />

                <span className="font-mono text-[12px] text-ink">{e.key}</span>
              </label>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Recent deliveries" meta={<span>Last 24h</span>}>
        <ul className="divide-y divide-line">
          {config.deliveries.map((d) => (
            <li key={d.id} className="flex items-center gap-2.5 px-3.5 py-2">
              <span
                className={`w-10 shrink-0 rounded px-1 text-center font-mono text-[11px] font-semibold ${d.status < 300 ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}
              >
                {d.status}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                {d.event}
              </span>
              {d.status >= 300 && (
                <span className="hidden text-[11.5px] text-bad sm:inline">Invalid signature</span>
              )}
              <span className="text-[11px] tabular-nums text-subtle">{d.duration}</span>
              <span className="w-14 text-right text-[11px] text-subtle">{d.when}</span>
              <button
                onClick={() => toast.success('Redelivery queued', { description: d.event })}
                className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"
                aria-label={`Redeliver ${d.event}`}
              >
                <RefreshCwIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
