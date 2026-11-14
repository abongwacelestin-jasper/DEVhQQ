import { useCallback, useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { CopyIcon, KeyRoundIcon, PlusIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { useReauth } from '../../contexts/ReauthContext';
import { ApiError } from '../../api/client';
import { createAccessToken, listAccessTokens, revokeAccessToken } from '../../api/auth/endpoints';
import type { ApiAccessToken } from '../../api/types';
import { tokenScopes } from '../../data/security';

const expiryOptions = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const DAY = 86_400_000;

function relative(iso?: string | null) {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function statusOf(t: ApiAccessToken): 'revoked' | 'expired' | 'expiring' | 'active' {
  if (t.revokedAt) return 'revoked';
  const left = new Date(t.expiresAt).getTime() - Date.now();
  if (left <= 0) return 'expired';
  if (left < 7 * DAY) return 'expiring';
  return 'active';
}

/** Personal access tokens (`/api/tokens`): scoped, expiring, hashed at rest and shown exactly once. */
export function ApiTokens() {
  const { requestReauth } = useReauth();
  const [params, setParams] = useSearchParams();
  const [tokens, setTokens] = useState<ApiAccessToken[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['tasks:read']);
  const [expiryDays, setExpiryDays] = useState(30);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState('');
  const nameId = useId();
  const errorId = useId();

  const load = useCallback(async () => {
    try {
      setTokens(await listAccessTokens());
      setState('ready');
    } catch (e) {
      setState(e instanceof ApiError && e.isUnavailable ? 'unavailable' : 'error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (params.get('token') === 'new') setOpen(true);
  }, [params]);

  const close = () => {
    setOpen(false);
    setCreated(null);
    setName('');
    setScopes(['tasks:read']);
    setError('');
    if (params.get('token')) setParams({});
  };

  const create = () => {
    if (!name.trim()) return setError('Give the token a name so you know where it is used.');
    if (scopes.length === 0) return setError('Choose at least one scope.');
    setError('');
    requestReauth({
      title: 'Create API token',
      description: `“${name.trim()}” with ${scopes.length} scope${scopes.length > 1 ? 's' : ''}, expiring in ${expiryDays} days.`,
      actionLabel: 'Verify & create',
      successMessage: 'Token created',
      onConfirm: async () => {
        try {
          const t = await createAccessToken({
            name: name.trim(),
            scopes,
            expiresInDays: expiryDays,
          });
          const { token, ...listed } = t;
          setTokens((l) => [listed, ...l.filter((x) => x.id !== listed.id)]);
          setCreated(token);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'The token could not be created.');
          throw e;
        }
      },
    });
  };

  const revoke = (t: ApiAccessToken) =>
    requestReauth({
      title: `Revoke “${t.name}”`,
      description: 'Anything using this token stops working immediately.',
      actionLabel: 'Verify & revoke',
      successMessage: 'Token revoked',
      onConfirm: async () => {
        await revokeAccessToken(t.id);
        await load();
      },
    });

  const copy = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      toast.success('Token copied');
    } catch {
      toast.error('Copy failed — select the token and copy it manually.');
    }
  };

  return (
    <>
      <Panel
        title="API tokens"
        action={
          <Button
            size="sm"
            variant="primary"
            icon={<PlusIcon className="h-3.5 w-3.5" />}
            onClick={() => setOpen(true)}
            disabled={state !== 'ready'}
          >
            New token
          </Button>
        }
      >
        {state === 'loading' && (
          <p className="px-3.5 py-3 text-[12px] text-muted">Loading tokens…</p>
        )}
        {state === 'unavailable' && (
          <p className="px-3.5 py-3 text-[12px] text-muted">
            Personal access tokens aren’t available on this server yet.
          </p>
        )}
        {state === 'error' && (
          <p role="alert" className="flex items-center gap-2 px-3.5 py-3 text-[12px] text-bad">
            Couldn’t load tokens.
            <button className="font-medium underline" onClick={() => void load()}>
              Retry
            </button>
          </p>
        )}
        {state === 'ready' && tokens.length === 0 && (
          <p className="px-3.5 py-3 text-[12px] text-muted">
            No tokens yet. Create one for scripts and integrations — never share your password.
          </p>
        )}
        <ul className="divide-y divide-line">
          {tokens.map((t) => {
            const status = statusOf(t);
            return (
              <li
                key={t.id}
                className={`flex flex-col gap-1.5 px-3.5 py-2.5 sm:flex-row sm:items-center ${status === 'revoked' || status === 'expired' ? 'opacity-60' : ''}`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <KeyRoundIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-ink">
                      {t.name}
                      {status === 'expiring' && (
                        <StatusBadge tone="warn" label={`Expires ${relative(t.expiresAt)}`} />
                      )}
                      {status === 'expired' && <StatusBadge tone="neutral" label="Expired" />}
                      {status === 'revoked' && <StatusBadge tone="neutral" label="Revoked" />}
                    </p>
                    <p className="truncate text-[11.5px] text-muted">
                      <span className="font-mono">{t.prefix}…</span> · {t.scopes.join(', ')} ·
                      expires {relative(t.expiresAt)} · used {relative(t.lastUsedAt)}
                    </p>
                  </div>
                </div>
                {(status === 'active' || status === 'expiring') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-end text-bad hover:text-bad sm:self-auto"
                    onClick={() => revoke(t)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
            <motion.div
              className="absolute inset-0 bg-ink/35"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={close}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={created ? 'Copy your token' : 'Create API token'}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="relative w-full max-w-md rounded-t-2xl bg-white shadow-pop sm:rounded-2xl"
            >
              <header className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-[14px] font-semibold text-ink">
                  {created ? 'Copy your token' : 'New API token'}
                </h2>
                <button
                  onClick={close}
                  className="rounded-md p-1 text-muted hover:bg-sunken"
                  aria-label="Close"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </header>
              {created ? (
                <div className="space-y-3 px-4 py-4">
                  <div className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">
                    <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    This is the only time the token is shown. TavetaHQ stores only a hash.
                  </div>
                  <div className="flex items-center gap-2">
                    <code
                      className="min-w-0 flex-1 select-all break-all rounded-md border border-line bg-sunken/60 px-2.5 py-2 font-mono text-[12px] text-ink"
                      aria-label="New token"
                    >
                      {created}
                    </code>
                    <Button
                      size="sm"
                      icon={<CopyIcon className="h-3.5 w-3.5" />}
                      onClick={() => void copy(created)}
                    >
                      Copy
                    </Button>
                  </div>
                  <Button variant="primary" className="w-full" onClick={close}>
                    Done
                  </Button>
                </div>
              ) : (
                <div className="space-y-3.5 px-4 py-4">
                  <label className="block" htmlFor={nameId}>
                    <span className="text-[12px] font-medium text-ink">Name</span>
                    <input
                      id={nameId}
                      value={name}
                      maxLength={60}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Status page sync"
                      aria-invalid={!!error && !name.trim()}
                      aria-describedby={error ? errorId : undefined}
                      className="mt-1 h-8 w-full rounded-md border border-line px-2.5 text-[12.5px] outline-none focus:border-accent"
                    />
                  </label>
                  <fieldset>
                    <legend className="text-[12px] font-medium text-ink">Scopes</legend>
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      {tokenScopes.map((s) => (
                        <label
                          key={s.key}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12px] text-ink hover:bg-sunken/60"
                        >
                          <input
                            type="checkbox"
                            checked={scopes.includes(s.key)}
                            onChange={() =>
                              setScopes((l) =>
                                l.includes(s.key) ? l.filter((x) => x !== s.key) : [...l, s.key],
                              )
                            }
                            className="h-3.5 w-3.5 accent-[#4F46E5]"
                          />
                          <span className="min-w-0 flex-1 truncate">{s.label}</span>
                          {s.write && (
                            <span className="text-[10.5px] font-medium text-warn">write</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="block">
                    <span className="text-[12px] font-medium text-ink">Expires in</span>
                    <select
                      value={expiryDays}
                      onChange={(e) => setExpiryDays(Number(e.target.value))}
                      className="mt-1 h-8 w-full rounded-md border border-line bg-white px-2 text-[12.5px]"
                    >
                      {expiryOptions.map((o) => (
                        <option key={o.days} value={o.days}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-[11px] text-subtle">
                      Tokens without an expiry are not allowed by policy.
                    </span>
                  </label>
                  <p
                    id={errorId}
                    role="alert"
                    aria-live="assertive"
                    className="text-[12px] text-bad"
                  >
                    {error}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button onClick={close}>Cancel</Button>
                    <Button variant="primary" onClick={create}>
                      Create token
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
