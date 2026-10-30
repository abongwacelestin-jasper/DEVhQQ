import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronRightIcon, FingerprintIcon, Trash2Icon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { securityPillars } from '../../data/securityFramework';
import { memberById } from '../../utils/status';
import {
  describeWebAuthnError,
  listPasskeys,
  passkeySupported,
  registerPasskey,
  removePasskey,
} from '../../utils/webauthn';
import type { ControlStatus, StoredPasskey } from '../../types/securityFramework';

const statusMeta: Record<ControlStatus, { label: string; cls: string; weight: number }> = {
  enforced: { label: 'Enforced', cls: 'bg-ok-soft text-ok', weight: 1 },
  partial: { label: 'Partial', cls: 'bg-warn-soft text-warn', weight: 0.5 },
  planned: { label: 'Planned', cls: 'bg-sunken text-muted', weight: 0 },
};

/** Defense-in-depth coverage across the six pillars, with drill-down to each control. */
export function SecurityFramework() {
  const { session, log } = useAuth();
  const [open, setOpen] = useState<string | null>('identity');
  const [passkeys, setPasskeys] = useState<StoredPasskey[]>(listPasskeys);
  const [busy, setBusy] = useState(false);

  const all = securityPillars.flatMap((p) => p.controls);
  const coverage = Math.round(
    (all.reduce((n, c) => n + statusMeta[c.status].weight, 0) / all.length) * 100,
  );

  const addPasskey = async () => {
    if (!session) return;
    const m = memberById(session.memberId);
    setBusy(true);
    try {
      const pk = await registerPasskey({ id: m.id, name: m.name, email: m.email });
      setPasskeys(listPasskeys());
      log('Registered passkey', pk.label, true);
      toast.success('Passkey registered', {
        description: 'Use it to sign in and approve sensitive actions.',
      });
    } catch (e) {
      toast.error('Couldn’t register passkey', { description: describeWebAuthnError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="framework-title"
      className="overflow-hidden rounded-lg border border-line bg-white"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 id="framework-title" className="text-[13px] font-semibold text-ink">
            Defense-in-depth coverage
          </h2>
          <p className="text-[12px] text-muted">
            Assume breach: contain blast radius, detect fast, recover fast. Each control links to
            where it’s implemented.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-1 w-28 overflow-hidden rounded-full bg-sunken">
            <span className="block h-full rounded-full bg-ok" style={{ width: `${coverage}%` }} />
          </span>
          <span className="text-[12px] font-semibold tabular-nums text-ink">{coverage}%</span>
        </div>
      </header>

      <ul className="divide-y divide-line">
        {securityPillars.map((p) => {
          const enforced = p.controls.filter((c) => c.status === 'enforced').length;
          const isOpen = open === p.id;
          return (
            <li key={p.id}>
              <button
                onClick={() => setOpen(isOpen ? null : p.id)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-100 hover:bg-sunken/40"
              >
                <ChevronRightIcon
                  className={`h-3.5 w-3.5 shrink-0 text-subtle transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">
                    {p.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">{p.summary}</span>
                </span>
                <span
                  className="flex shrink-0 gap-0.5"
                  aria-label={`${enforced} of ${p.controls.length} enforced`}
                >
                  {p.controls.map((c) => (
                    <span
                      key={c.id}
                      className={`h-2.5 w-1.5 rounded-sm ${c.status === 'enforced' ? 'bg-ok' : c.status === 'partial' ? 'bg-warn' : 'bg-line-strong'}`}
                    />
                  ))}
                </span>
                <span className="w-10 shrink-0 text-right text-[11.5px] tabular-nums text-muted">
                  {enforced}/{p.controls.length}
                </span>
              </button>
              {isOpen && (
                <ul className="border-t border-line bg-sunken/30">
                  {p.controls.map((c) => (
                    <li
                      key={c.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-2 pl-10 pr-4 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)_72px]"
                    >
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-ink">
                          {c.to ? (
                            <Link to={c.to} className="hover:underline">
                              {c.title}
                            </Link>
                          ) : (
                            c.title
                          )}
                        </p>
                        <p className="text-[11.5px] leading-relaxed text-muted">{c.detail}</p>
                        {c.action === 'register-passkey' && (
                          <div className="mt-1.5 space-y-1">
                            {passkeys.map((pk) => (
                              <p
                                key={pk.id}
                                className="flex items-center gap-1.5 text-[11.5px] text-ink"
                              >
                                <FingerprintIcon className="h-3.5 w-3.5 text-ok" /> {pk.label}
                                <span className="text-subtle">
                                  · added {new Date(pk.createdAt).toLocaleDateString()}
                                </span>
                                <button
                                  onClick={() => {
                                    removePasskey(pk.id);
                                    setPasskeys(listPasskeys());
                                    log('Removed passkey', pk.label, true);
                                  }}
                                  aria-label={`Remove ${pk.label}`}
                                  className="rounded p-0.5 text-subtle hover:text-bad"
                                >
                                  <Trash2Icon className="h-3 w-3" />
                                </button>
                              </p>
                            ))}
                            <button
                              onClick={addPasskey}
                              disabled={busy || !passkeySupported()}
                              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[12px] font-medium text-ink transition-colors duration-150 hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <FingerprintIcon className="h-3.5 w-3.5" />{' '}
                              {busy
                                ? 'Waiting for authenticator…'
                                : passkeySupported()
                                  ? 'Register a passkey on this device'
                                  : 'Passkeys not supported here'}
                            </button>
                          </div>
                        )}
                      </div>
                      <code
                        className="hidden truncate self-start pt-0.5 font-mono text-[11px] text-subtle md:block"
                        title={c.evidence}
                      >
                        {c.evidence}
                      </code>
                      <span
                        className={`h-fit w-fit justify-self-end rounded px-1.5 py-px text-[10.5px] font-semibold ${statusMeta[c.status].cls}`}
                      >
                        {statusMeta[c.status].label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
