import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckIcon, GitBranchIcon as GithubIcon, LockIcon, ShieldCheckIcon } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ProductMark } from '../ui/ProductMark';
import { ConnectRepoIllustration } from './ConnectRepoIllustration';
import { useAuth } from '../../contexts/AuthContext';
import { useReauth } from '../../contexts/ReauthContext';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import {
  availableRepos,
  githubPermissions,
  type GitHubInstallation,
} from '../../hooks/useGitHubApp';
import type { ProductId } from '../../types/portfolio';

interface GitHubAppModalProps {
  open: boolean;
  onClose: () => void;
  installation: GitHubInstallation;
  connected: string[];
  onSave: (
    inst: GitHubInstallation,
    add: { name: string; product: ProductId; language: string }[],
  ) => void;
}

const steps = ['Organisation', 'Repositories', 'Permissions', 'Products', 'Review'];
const webhookEvents = [
  'push',
  'pull_request',
  'pull_request_review',
  'check_run',
  'release',
  'deployment_status',
];
const defaultEvents = ['push', 'pull_request', 'check_run', 'release'];

/** Five-step GitHub App configuration: target org, repo access, permission review, product mapping, MFA-confirmed save. */
export function GitHubAppModal({
  open,
  onClose,
  installation,
  connected,
  onSave,
}: GitHubAppModalProps) {
  const { log } = useAuth();
  const { requestReauth } = useReauth();
  const { allowedProducts } = useProductFilter();
  const [step, setStep] = useState(0);
  const [inst, setInst] = useState(installation);
  const [picked, setPicked] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, ProductId>>({});

  useEffect(() => {
    if (open) {
      setStep(0);
      setInst(installation);
      setPicked([]);
      setMapping(
        Object.fromEntries(
          availableRepos.map((r) => [
            r.name,
            r.suggested ?? allowedProducts[0]?.id ?? 'renewberry',
          ]),
        ),
      );
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = availableRepos.filter((r) => !connected.includes(r.name));
  const writes = Object.entries(inst.permissions).filter(([, v]) => v === 'write');

  const save = () =>
    requestReauth({
      title: 'Save GitHub App configuration',
      description: `${picked.length} new repositor${picked.length === 1 ? 'y' : 'ies'}${writes.length ? ` · ${writes.length} write permission(s)` : ' · read-only'}`,
      actionLabel: 'Verify & save',
      onConfirm: () => {
        onSave(
          inst,
          picked.map((n) => ({
            name: n,
            product: mapping[n],
            language: availableRepos.find((r) => r.name === n)?.language ?? 'Unknown',
          })),
        );
        log(
          'Configured GitHub App',
          `${inst.org} · ${picked.length} repos added · ${writes.length ? writes.map(([k]) => k).join(', ') + ' write' : 'read-only'}`,
          true,
        );
        toast.success('GitHub App updated', {
          description: picked.length
            ? 'Initial sync started — commits appear within a minute.'
            : 'Permissions saved.',
        });
        onClose();
      },
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Configure GitHub App"
      description="DevHQ reads from GitHub. GitHub stays authoritative for code, reviews and branch rules."
      illustration={<ConnectRepoIllustration />}
      size="lg"
      footer={
        <>
          {step > 0 && <Button onClick={() => setStep((s) => s - 1)}>Back</Button>}
          {step < steps.length - 1 ? (
            <Button
              variant="primary"
              onClick={() => setStep((s) => (s === 1 && picked.length === 0 ? 2 : s + 1))}
            >
              Continue
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<ShieldCheckIcon className="h-3.5 w-3.5" />}
              onClick={save}
            >
              Save with MFA
            </Button>
          )}
        </>
      }
    >
      <ol className="mb-3 grid grid-cols-5 gap-1.5" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s} className="min-w-0">
            <span className={`block h-1 rounded-full ${i <= step ? 'bg-ink' : 'bg-line'}`} />
            <span
              className={`mt-1 block truncate text-[11px] ${i === step ? 'font-semibold text-ink' : 'text-muted'}`}
            >
              {s}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-2">
          {['techorg', 'techorg-labs'].map((org) => (
            <label
              key={org}
              className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 ${inst.org === org ? 'border-ink bg-sunken/50' : 'border-line hover:border-line-strong'}`}
            >
              <input
                type="radio"
                name="org"
                checked={inst.org === org}
                onChange={() => setInst({ ...inst, org })}
                className="accent-[#0F1115]"
              />
              <GithubIcon className="h-5 w-5 text-ink" />
              <span className="flex-1">
                <span className="block text-[12.5px] font-semibold text-ink">{org}</span>
                <span className="text-[11.5px] text-muted">
                  {org === 'techorg'
                    ? 'Installed · 4 repositories granted'
                    : 'Not installed · you are an owner'}
                </span>
              </span>
              {org === 'techorg' && (
                <span className="rounded bg-ok-soft px-1.5 text-[11px] font-semibold text-ok">
                  Installed
                </span>
              )}
            </label>
          ))}
          <label className="flex items-center justify-between rounded-md border border-line px-3 py-2">
            <span>
              <span className="block text-[12.5px] font-medium text-ink">Signed webhooks</span>
              <span className="text-[11.5px] text-muted">
                Push, PR and check events, verified with HMAC-SHA256
              </span>
            </span>
            <input
              type="checkbox"
              checked={inst.webhook}
              onChange={(e) => setInst({ ...inst, webhook: e.target.checked })}
              className="h-4 w-4 accent-[#0F1115]"
            />
          </label>
          {inst.webhook && (
            <fieldset className="rounded-md border border-line px-3 py-2">
              <legend className="px-1 text-[11.5px] font-semibold text-ink">
                Subscribe to events
              </legend>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {webhookEvents.map((ev) => {
                  const list = inst.events ?? defaultEvents;
                  const on = list.includes(ev);
                  return (
                    <label
                      key={ev}
                      className="flex items-center gap-1.5 font-mono text-[11.5px] text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setInst({
                            ...inst,
                            events: on ? list.filter((x) => x !== ev) : [...list, ev],
                          })
                        }
                        className="h-3.5 w-3.5 accent-[#0F1115]"
                      />
                      {ev}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      )}

      {step === 1 && (
        <div>
          <div className="mb-2 flex gap-2">
            {(['selected', 'all'] as const).map((a) => (
              <button
                key={a}
                onClick={() => {
                  setInst({ ...inst, access: a });
                  if (a === 'all') setPicked(candidates.map((r) => r.name));
                }}
                className={`flex-1 rounded-md border px-3 py-2 text-left ${inst.access === a ? 'border-ink bg-sunken/50' : 'border-line'}`}
              >
                <span className="block text-[12.5px] font-semibold text-ink">
                  {a === 'selected' ? 'Only selected repositories' : 'All repositories'}
                </span>
                <span className="text-[11.5px] text-muted">
                  {a === 'selected'
                    ? 'Recommended — least privilege'
                    : 'Includes future repositories'}
                </span>
              </button>
            ))}
          </div>
          {candidates.length === 0 ? (
            <p className="rounded-md bg-sunken px-3 py-3 text-[12.5px] text-muted">
              Every repository in {inst.org} is already connected.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {candidates.map((r) => {
                const on = picked.includes(r.name) || inst.access === 'all';
                return (
                  <li key={r.name}>
                    <label className="flex items-center gap-3 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={inst.access === 'all'}
                        onChange={() =>
                          setPicked((l) =>
                            l.includes(r.name) ? l.filter((x) => x !== r.name) : [...l, r.name],
                          )
                        }
                        className="h-4 w-4 accent-[#0F1115]"
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                        {r.name}
                      </span>
                      <span className="text-[11.5px] text-muted">{r.language}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {step === 2 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {githubPermissions.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-ink">{p.label}</span>
                <span className="text-[11.5px] text-muted">{p.hint}</span>
              </span>
              {p.id === 'administration' ? (
                <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted">
                  <LockIcon className="h-3 w-3" /> Not requested
                </span>
              ) : (
                <select
                  value={inst.permissions[p.id]}
                  disabled={!p.allowWrite}
                  onChange={(e) =>
                    setInst({
                      ...inst,
                      permissions: {
                        ...inst.permissions,
                        [p.id]: e.target.value as 'read' | 'write',
                      },
                    })
                  }
                  className="h-7 rounded-md border border-line px-1.5 text-[12px]"
                >
                  <option value="read">Read</option>
                  {p.allowWrite && <option value="write">Read & write</option>}
                </select>
              )}
            </li>
          ))}
          {writes.length > 0 && (
            <li className="bg-warn-soft/60 px-3 py-2 text-[11.5px] font-medium text-warn">
              Write access lets DevHQ change GitHub on your behalf. Every write is audited and needs
              the user’s own permission too.
            </li>
          )}
        </ul>
      )}

      {step === 3 && (
        <div>
          {picked.length === 0 ? (
            <p className="rounded-md bg-sunken px-3 py-3 text-[12.5px] text-muted">
              No new repositories selected — nothing to map.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {picked.map((n) => (
                <li key={n} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                    {n}
                  </span>
                  <ProductMark product={mapping[n]} size="sm" />
                  <select
                    value={mapping[n]}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [n]: e.target.value as ProductId }))
                    }
                    aria-label={`Product for ${n}`}
                    className="h-7 rounded-md border border-line px-1.5 text-[12px]"
                  >
                    {allowedProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11.5px] text-muted">
            Only members with access to the product will see the repository.
          </p>
        </div>
      )}

      {step === 4 && (
        <dl className="divide-y divide-line rounded-md border border-line text-[12.5px]">
          {[
            ['Organisation', inst.org],
            [
              'Repository access',
              inst.access === 'all'
                ? 'All repositories'
                : `${connected.length + picked.length} selected`,
            ],
            ['New repositories', picked.length ? picked.join(', ') : 'None'],
            [
              'Write permissions',
              writes.length ? writes.map(([k]) => k).join(', ') : 'None — read-only',
            ],
            [
              'Webhooks',
              inst.webhook
                ? `Signed · ${(inst.events ?? defaultEvents).length} events`
                : 'Disabled — data syncs every 15 min',
            ],
          ].map(([k, val]) => (
            <div key={k} className="flex items-start justify-between gap-4 px-3 py-2">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-medium text-ink">{val}</dd>
            </div>
          ))}
          <div className="flex items-center gap-1.5 px-3 py-2 text-[11.5px] text-ok">
            <CheckIcon className="h-3.5 w-3.5" /> Credentials stored encrypted; only Owners can view
            them.
          </div>
        </dl>
      )}
    </Modal>
  );
}
