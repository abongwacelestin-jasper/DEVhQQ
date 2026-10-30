import { useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2Icon,
  GitBranchIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  SendIcon,
  Settings2Icon,
  XCircleIcon,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { useReauth } from '../../contexts/ReauthContext';
import type { GitHubInstallation } from '../../hooks/useGitHubApp';

interface Delivery {
  id: string;
  event: string;
  status: number;
  ms: number;
  at: string;
}

interface GitHubAppPanelProps {
  installation: GitHubInstallation;
  repoCount: number;
  onConfigure: () => void;
  onChange: (inst: GitHubInstallation) => void;
}

const seed: Delivery[] = [
  { id: 'd1', event: 'push', status: 200, ms: 84, at: '2m ago' },
  { id: 'd2', event: 'pull_request.opened', status: 200, ms: 112, at: '9m ago' },
  { id: 'd3', event: 'check_run.completed', status: 200, ms: 96, at: '14m ago' },
  { id: 'd4', event: 'push', status: 502, ms: 3012, at: '41m ago' },
  { id: 'd5', event: 'release.published', status: 200, ms: 140, at: '2h ago' },
];

/** Installation status, permissions at a glance, webhook delivery log and suspend control. */
export function GitHubAppPanel({
  installation,
  repoCount,
  onConfigure,
  onChange,
}: GitHubAppPanelProps) {
  const { log, canDo } = useAuth();
  const { requestReauth } = useReauth();
  const [deliveries, setDeliveries] = useState<Delivery[]>(seed);
  const [syncing, setSyncing] = useState(false);
  const admin = canDo('workspace:delete') || canDo('member:invite');
  const writes = Object.entries(installation.permissions)
    .filter(([, v]) => v === 'write')
    .map(([k]) => k.replace('_', ' '));
  const okRate = Math.round(
    (deliveries.filter((d) => d.status < 300).length / deliveries.length) * 100,
  );

  const ping = () => {
    const d: Delivery = {
      id: `d${Date.now()}`,
      event: 'ping',
      status: installation.webhook && !installation.suspended ? 200 : 410,
      ms: 60 + Math.round(Math.random() * 80),
      at: 'just now',
    };
    setDeliveries((l) => [d, ...l].slice(0, 8));
    if (d.status === 200)
      toast.success('Ping delivered', { description: `HMAC signature verified · ${d.ms}ms` });
    else
      toast.error('Ping failed', {
        description: installation.suspended ? 'The app is suspended.' : 'Webhooks are disabled.',
      });
  };

  const redeliver = (d: Delivery) => {
    setDeliveries((l) =>
      l.map((x) => (x.id === d.id ? { ...x, status: 200, ms: 101, at: 'just now' } : x)),
    );
    toast.success(`Redelivered ${d.event}`);
  };

  const sync = () => {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      toast.success('Sync complete', { description: `${repoCount} repositories up to date` });
    }, 900);
  };

  const toggleSuspend = () =>
    requestReauth({
      title: installation.suspended ? 'Resume GitHub App' : 'Suspend GitHub App',
      description: installation.suspended
        ? 'Syncing and webhooks resume immediately.'
        : 'DevHQ stops reading from GitHub until resumed. Nothing is deleted.',
      actionLabel: installation.suspended ? 'Verify & resume' : 'Verify & suspend',
      onConfirm: () => {
        onChange({ ...installation, suspended: !installation.suspended });
        log(
          installation.suspended ? 'Resumed GitHub App' : 'Suspended GitHub App',
          installation.org,
          true,
        );
      },
    });

  return (
    <section
      className="grid overflow-hidden rounded-lg border border-line bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
      aria-label="GitHub App"
    >
      <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-ink text-white">
            <GitBranchIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink">
              DevHQ GitHub App
              <span
                className={`rounded px-1.5 py-px text-[11px] font-semibold ${installation.suspended ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}
              >
                {installation.suspended ? 'Suspended' : 'Active'}
              </span>
            </h2>
            <p className="text-[12px] text-muted">
              Installed on <b className="text-ink">{installation.org}</b> ·{' '}
              {installation.access === 'all'
                ? 'all repositories'
                : `${repoCount} selected repositories`}
            </p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          <div>
            <dt className="text-muted">Write access</dt>
            <dd className="font-medium text-ink">
              {writes.length ? writes.join(', ') : 'None · read-only'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Webhooks</dt>
            <dd className="font-medium text-ink">
              {installation.webhook ? 'Signed (HMAC-SHA256)' : 'Off · polling every 15 min'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Admin rights</dt>
            <dd className="font-medium text-ink">Never requested</dd>
          </div>
          <div>
            <dt className="text-muted">Delivery success</dt>
            <dd className={`font-medium ${okRate < 90 ? 'text-warn' : 'text-ok'}`}>
              {okRate}% · last {deliveries.length}
            </dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {admin && (
            <Button
              size="sm"
              variant="primary"
              icon={<Settings2Icon className="h-3.5 w-3.5" />}
              onClick={onConfigure}
            >
              Configure
            </Button>
          )}
          <Button
            size="sm"
            icon={<RefreshCwIcon className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />}
            disabled={syncing || installation.suspended}
            onClick={sync}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
          {admin && (
            <Button
              size="sm"
              variant="ghost"
              icon={
                installation.suspended ? (
                  <PlayCircleIcon className="h-3.5 w-3.5" />
                ) : (
                  <PauseCircleIcon className="h-3.5 w-3.5" />
                )
              }
              onClick={toggleSuspend}
            >
              {installation.suspended ? 'Resume' : 'Suspend'}
            </Button>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <h3 className="text-[12.5px] font-semibold text-ink">Recent webhook deliveries</h3>
          <button
            onClick={ping}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
          >
            <SendIcon className="h-3 w-3" /> Send test ping
          </button>
        </div>
        <ul className="divide-y divide-line">
          {deliveries.map((d) => (
            <li
              key={d.id}
              className="grid grid-cols-[16px_minmax(0,1fr)_48px_60px_72px] items-center gap-2 px-4 py-1.5 text-[12px]"
            >
              {d.status < 300 ? (
                <CheckCircle2Icon className="h-3.5 w-3.5 text-ok" />
              ) : (
                <XCircleIcon className="h-3.5 w-3.5 text-bad" />
              )}
              <span className="truncate font-mono text-ink">{d.event}</span>
              <span
                className={`font-mono tabular-nums ${d.status < 300 ? 'text-muted' : 'text-bad'}`}
              >
                {d.status}
              </span>
              <span className="text-right tabular-nums text-muted">{d.ms}ms</span>
              <span className="text-right text-muted">
                {d.status >= 300 ? (
                  <button
                    onClick={() => redeliver(d)}
                    className="font-medium text-accent hover:underline"
                  >
                    Redeliver
                  </button>
                ) : (
                  d.at
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
