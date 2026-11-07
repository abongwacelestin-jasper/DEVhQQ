import { useState } from 'react';
import { toast } from 'sonner';
import { CopyIcon, KeyRoundIcon, TerminalIcon, UnplugIcon } from 'lucide-react';
import { PageHero } from '../components/ui/PageHero';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { IdeIllustration } from '../components/illustrations/IdeIllustration';
import { DataState, InlineError } from '../components/engineering/states';
import { useApiList } from '../components/engineering/data/useApi';
import { ago } from '../components/engineering/format';
import { cliTools, type ApiAccessToken } from '../components/engineering/devtoolsCopy';
import { api } from '../api/client';
import { ideOptions } from '../data/devtools';
import { formatDay } from '../utils/date';

/**
 * Editors and CLI. Editor extensions authenticate with personal access tokens
 * (`/api/tokens`, SEC lane); this page lists and revokes them. There is no
 * device-code pairing endpoint, so the page gives install instructions rather
 * than simulating a pairing flow.
 */
export function DevTools() {
  const tokens = useApiList<ApiAccessToken>('/api/tokens');
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const copy = (s: string) => {
    void navigator.clipboard?.writeText(s).then(
      () => toast.success('Copied'),
      () => toast.error('Couldn’t copy — select the text instead'),
    );
  };

  const revoke = async (t: ApiAccessToken) => {
    if (!window.confirm(`Revoke “${t.name}”? Anything using it stops working immediately.`)) return;
    setRevoking(t.id);
    setError(null);
    try {
      await api<unknown>(`/api/tokens/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
      tokens.mutate((l) => l.filter((x) => x.id !== t.id));
      toast('Token revoked');
    } catch (e) {
      setError(e);
      void tokens.reload();
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="space-y-3.5">
      <PageHero
        illustration={<IdeIllustration className="h-[84px] w-auto" />}
        title="IDE & dev tools"
        description="Work where you code. Editor extensions and the CLI sign in with a personal access token scoped to your product access — revoke any token here."
        stats={
          tokens.status === 'ready'
            ? [{ label: 'Active tokens', value: tokens.items.length }]
            : undefined
        }
      />

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Editors" meta={<span>Install the extension, then sign in with a token</span>}>
          <ul className="divide-y divide-line">
            {ideOptions.map((o) => (
              <li
                key={o.id}
                className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 md:grid-cols-[32px_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[11px] font-bold text-white"
                  style={{ background: o.color }}
                >
                  {o.short}
                </span>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-ink">{o.name}</p>
                  <p className="truncate font-mono text-[11px] text-muted">{o.install}</p>
                </div>
                <p className="hidden truncate text-[11.5px] text-muted md:block">
                  {o.features.join(' · ')}
                </p>
                <Button
                  size="sm"
                  icon={<CopyIcon className="h-3.5 w-3.5" />}
                  onClick={() => copy(o.install)}
                  aria-label={`Copy install command for ${o.name}`}
                >
                  Copy
                </Button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Access tokens">
          {tokens.status !== 'ready' ? (
            <DataState
              status={tokens.status}
              error={tokens.error}
              what="Access tokens"
              onRetry={tokens.reload}
              rows={2}
            />
          ) : tokens.items.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-[12.5px] text-muted">
              No tokens. Create one in your security settings to sign an editor in.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {tokens.items.map((t) => (
                <li key={t.id} className="flex items-start gap-2.5 px-3.5 py-2">
                  <KeyRoundIcon className="mt-0.5 h-4 w-4 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-ink">{t.name}</p>
                    <p className="text-[11px] text-muted">
                      since {formatDay(new Date(t.createdAt))}
                      {t.expiresAt && ` · expires ${formatDay(new Date(t.expiresAt))}`}
                      {` · used ${t.lastUsedAt ? ago(t.lastUsedAt) : 'never'}`}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-1">
                      {t.scopes.map((s) => (
                        <span
                          key={s}
                          className="rounded bg-sunken px-1 font-mono text-[10px] text-ink"
                        >
                          {s}
                        </span>
                      ))}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Revoke ${t.name}`}
                    title="Revoke"
                    disabled={revoking === t.id}
                    icon={<UnplugIcon className="h-3.5 w-3.5" />}
                    onClick={() => void revoke(t)}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="px-3.5 pb-2">
            <InlineError error={error} />
          </div>
        </Panel>
      </div>

      <Panel title="Command line & git hooks">
        <ul className="divide-y divide-line">
          {cliTools.map((t) => (
            <li
              key={t.id}
              className="grid grid-cols-1 items-center gap-2 px-3.5 py-2.5 md:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)] md:gap-3"
            >
              <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                <TerminalIcon className="h-3.5 w-3.5 text-muted" aria-hidden />
                {t.name}
              </p>
              <p className="text-[12px] text-muted">{t.detail}</p>
              <button
                onClick={() => copy(t.cmd)}
                aria-label={`Copy: ${t.cmd}`}
                className="flex min-w-0 items-center gap-2 rounded-md bg-[#0F1115] px-2.5 py-1.5 text-left font-mono text-[11.5px] text-[#E5E7EB]"
              >
                <span className="min-w-0 flex-1 truncate">{t.cmd}</span>
                <CopyIcon className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
