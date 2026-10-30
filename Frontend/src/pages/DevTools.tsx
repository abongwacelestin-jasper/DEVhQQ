import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckIcon,
  CopyIcon,
  LaptopIcon,
  LoaderCircleIcon,
  PlugZapIcon,
  TerminalIcon,
  UnplugIcon,
} from 'lucide-react';
import { PageHero } from '../components/ui/PageHero';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { IdeIllustration } from '../components/illustrations/IdeIllustration';
import { useAuth } from '../contexts/AuthContext';
import { useReauth } from '../contexts/ReauthContext';
import {
  cliTools,
  devScopes,
  ideOptions,
  seedConnections,
  type DevConnection,
  type IdeOption,
} from '../data/devtools';
import { formatDay } from '../utils/date';

type Step = 'install' | 'authorize' | 'scopes' | 'done';

export function DevTools() {
  const { log } = useAuth();
  const { requestReauth } = useReauth();
  const [conns, setConns] = useState<DevConnection[]>(seedConnections);
  const [ide, setIde] = useState<IdeOption | null>(null);
  const [step, setStep] = useState<Step>('install');
  const [scopes, setScopes] = useState<string[]>(
    devScopes.filter((s) => s.required).map((s) => s.id),
  );
  const [waiting, setWaiting] = useState(false);
  const [installed, setInstalled] = useState<Record<string, boolean>>({
    hook: false,
    cli: true,
    gh: false,
  });
  const code = 'HQ7K-29PX';

  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => {
      setWaiting(false);
      setStep('scopes');
    }, 1600);
    return () => clearTimeout(t);
  }, [waiting]);

  const start = (o: IdeOption) => {
    setIde(o);
    setStep('install');
    setScopes(devScopes.filter((s) => s.required).map((s) => s.id));
  };

  const finish = () => {
    if (!ide) return;
    requestReauth({
      title: `Connect ${ide.name}`,
      description: `Grants ${scopes.length} scopes to a device token. Expires in 90 days.`,
      actionLabel: 'Verify & connect',
      onConfirm: () => {
        setConns((l) => [
          {
            id: `dc${Date.now()}`,
            ideId: ide.id,
            device: `${navigator.platform || 'This device'} · ${ide.name}`,
            connectedAt: new Date().toISOString(),
            lastUsed: 'Just now',
            scopes,
          },
          ...l,
        ]);
        log('Connected IDE', `${ide.name} · ${scopes.join(', ')}`, true);
        setStep('done');
      },
    });
  };

  const copy = (s: string) => {
    navigator.clipboard?.writeText(s);
    toast.success('Copied');
  };

  return (
    <div className="space-y-3.5">
      <PageHero
        illustration={<IdeIllustration className="h-[84px] w-auto" />}
        title="IDE & dev tools"
        description="Work where you code. Editors connect with short-lived device tokens scoped to your product access — revoke any device here."
        stats={[
          { label: 'Connected editors', value: conns.length },
          {
            label: 'Pre-commit hook',
            value: installed.hook ? 'Installed' : 'Missing',
            tone: installed.hook ? 'ok' : 'bad',
          },
          { label: 'Token lifetime', value: '90 days' },
        ]}
      />

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Editors" meta={<span>Personal integration layer</span>}>
          <ul className="divide-y divide-line">
            {ideOptions.map((o) => {
              const c = conns.filter((x) => x.ideId === o.id);
              return (
                <li
                  key={o.id}
                  className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 md:grid-cols-[32px_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-md text-[11px] font-bold text-white"
                    style={{ background: o.color }}
                  >
                    {o.short}
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                      {o.name}
                      {c.length > 0 && (
                        <span className="rounded bg-ok-soft px-1.5 text-[10.5px] font-semibold text-ok">
                          {c.length} connected
                        </span>
                      )}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted">{o.install}</p>
                  </div>
                  <p className="hidden truncate text-[11.5px] text-muted md:block">
                    {o.features.join(' · ')}
                  </p>
                  <Button
                    size="sm"
                    variant={c.length ? 'secondary' : 'primary'}
                    icon={<PlugZapIcon className="h-3.5 w-3.5" />}
                    onClick={() => start(o)}
                  >
                    {c.length ? 'Add device' : 'Connect'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Connected devices">
          {conns.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-[12.5px] text-muted">
              No devices connected.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {conns.map((c) => {
                const o = ideOptions.find((i) => i.id === c.ideId)!;
                return (
                  <li key={c.id} className="flex items-start gap-2.5 px-3.5 py-2">
                    <LaptopIcon className="mt-0.5 h-4 w-4 text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold text-ink">{c.device}</p>
                      <p className="text-[11px] text-muted">
                        {o.name} · since {formatDay(new Date(c.connectedAt))} · used {c.lastUsed}
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-1">
                        {c.scopes.map((s) => (
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
                      aria-label="Revoke"
                      icon={<UnplugIcon className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setConns((l) => l.filter((x) => x.id !== c.id));
                        log('Revoked IDE device', c.device, true);
                        toast('Device revoked', {
                          description: 'Its token stops working immediately.',
                        });
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Command line & git hooks">
        <ul className="divide-y divide-line">
          {cliTools.map((t) => (
            <li
              key={t.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 md:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                <TerminalIcon className="h-3.5 w-3.5 text-muted" />
                {t.name}
              </p>
              <p className="hidden text-[12px] text-muted md:block">{t.detail}</p>
              <button
                onClick={() => copy(t.cmd)}
                className="col-span-2 flex min-w-0 items-center gap-2 rounded-md bg-[#0F1115] px-2.5 py-1.5 text-left font-mono text-[11.5px] text-[#E5E7EB] md:col-span-1"
              >
                <span className="min-w-0 flex-1 truncate">{t.cmd}</span>
                <CopyIcon className="h-3 w-3 shrink-0 opacity-60" />
              </button>
              <Button
                size="sm"
                variant={installed[t.id] ? 'secondary' : 'primary'}
                className="row-start-1 col-start-2 md:row-auto md:col-auto"
                icon={installed[t.id] ? <CheckIcon className="h-3.5 w-3.5 text-ok" /> : undefined}
                onClick={() => {
                  setInstalled((s) => ({ ...s, [t.id]: !s[t.id] }));
                  toast(
                    installed[t.id]
                      ? `${t.name} marked not installed`
                      : `${t.name} verified on this device`,
                  );
                }}
              >
                {installed[t.id] ? 'Installed' : 'Mark installed'}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>

      <Modal
        open={!!ide}
        onClose={() => setIde(null)}
        title={ide ? `Connect ${ide.name}` : ''}
        description="Device authorisation — your password never leaves DevHQ."
        illustration={<IdeIllustration className="h-14 w-auto" />}
        footer={
          step === 'done' ? (
            <Button variant="primary" onClick={() => setIde(null)}>
              Done
            </Button>
          ) : step === 'scopes' ? (
            <>
              <Button onClick={() => setStep('authorize')}>Back</Button>
              <Button variant="primary" onClick={finish}>
                Connect
              </Button>
            </>
          ) : step === 'install' ? (
            <Button variant="primary" onClick={() => setStep('authorize')}>
              I’ve installed it
            </Button>
          ) : null
        }
      >
        {ide && (
          <>
            <ol className="mb-3 grid grid-cols-3 gap-1.5 text-[11.5px]">
              {['Install', 'Authorize', 'Scopes'].map((s, i) => {
                const idx = ['install', 'authorize', 'scopes', 'done'].indexOf(step);
                return (
                  <li key={s} className="min-w-0">
                    <span className={`block h-1 rounded-full ${i <= idx ? 'bg-ink' : 'bg-line'}`} />
                    <span
                      className={`mt-1 block ${i === idx ? 'font-semibold text-ink' : 'text-muted'}`}
                    >
                      {i + 1}. {s}
                    </span>
                  </li>
                );
              })}
            </ol>
            {step === 'install' && (
              <div>
                <p className="text-[12.5px] text-ink">Install the DevHQ extension:</p>
                <button
                  onClick={() => copy(ide.install)}
                  className="mt-1.5 flex w-full items-center gap-2 rounded-md bg-[#0F1115] px-3 py-2 text-left font-mono text-[12px] text-[#E5E7EB]"
                >
                  <span className="flex-1">{ide.install}</span>
                  <CopyIcon className="h-3.5 w-3.5 opacity-60" />
                </button>
                <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                  {ide.features.map((x) => (
                    <li key={x} className="flex items-center gap-1.5 text-[12px] text-ink">
                      <CheckIcon className="h-3.5 w-3.5 text-ok" />
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {step === 'authorize' && (
              <div className="text-center">
                <p className="text-[12.5px] text-ink">
                  In {ide.name}, run <b>DevHQ: Sign in</b> and enter this code:
                </p>
                <p className="mx-auto mt-2 w-fit rounded-lg border-2 border-dashed border-line-strong px-4 py-2 font-mono text-[22px] font-bold tracking-[0.2em] text-ink">
                  {code}
                </p>
                <p className="mt-1 text-[11.5px] text-muted">
                  Expires in 10 minutes. Never share it.
                </p>
                <Button
                  className="mt-3"
                  variant="primary"
                  disabled={waiting}
                  icon={
                    waiting ? <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" /> : undefined
                  }
                  onClick={() => setWaiting(true)}
                >
                  {waiting ? 'Waiting for your editor…' : 'I’ve entered the code'}
                </Button>
              </div>
            )}
            {step === 'scopes' && (
              <ul className="divide-y divide-line rounded-md border border-line">
                {devScopes.map((s) => (
                  <li key={s.id}>
                    <label className="flex items-center justify-between gap-3 px-3 py-2">
                      <span>
                        <span className="block text-[12.5px] font-medium text-ink">{s.label}</span>
                        <span className="font-mono text-[11px] text-muted">
                          {s.id}
                          {s.required ? ' · required' : ''}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        disabled={s.required}
                        checked={scopes.includes(s.id)}
                        onChange={() =>
                          setScopes((l) =>
                            l.includes(s.id) ? l.filter((x) => x !== s.id) : [...l, s.id],
                          )
                        }
                        className="h-4 w-4 accent-[#0F1115]"
                      />
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {step === 'done' && (
              <div className="py-4 text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-ok-soft text-ok">
                  <CheckIcon className="h-5 w-5" />
                </span>
                <p className="mt-2 text-[13px] font-semibold text-ink">{ide.name} is connected</p>
                <p className="text-[12px] text-muted">
                  Your assigned tasks now appear in the editor sidebar.
                </p>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
