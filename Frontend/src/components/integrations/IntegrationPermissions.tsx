import { LockIcon, PencilIcon } from 'lucide-react';
import { Panel } from '../ui/Panel';

/**
 * Scopes the provider granted, exactly as the API reports them.
 *
 * Read-only: there is no endpoint to change scopes from TavetaHQ. Changing them
 * happens on the provider (re-authorize), which the next sync reflects here.
 */
export function IntegrationPermissions({ scopes, name }: { scopes: string[]; name: string }) {
  const writes = scopes.filter((s) => /(^|[:._-])(write|admin|manage)\b/i.test(s));

  return (
    <Panel
      title="Granted scopes"
      meta={
        <span className={writes.length ? 'text-warn' : 'text-ok'}>
          {writes.length
            ? `${writes.length} write scope${writes.length > 1 ? 's' : ''}`
            : 'Read-only'}
        </span>
      }
    >
      <p className="border-b border-line bg-sunken/40 px-3.5 py-2 text-[12px] text-muted">
        Least privilege: grant only what {name} needs. Scopes are changed on the provider by
        re-authorizing TavetaHQ; this list reflects what the provider reported.
      </p>
      {scopes.length === 0 ? (
        <p className="px-3.5 py-4 text-[12.5px] text-muted">
          The server didn’t report any scopes for this connection.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {scopes.map((s) => {
            const write = writes.includes(s);
            return (
              <li key={s} className="flex items-center gap-2.5 px-3.5 py-2">
                {write ? (
                  <PencilIcon className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
                ) : (
                  <LockIcon className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{s}</span>
                <span
                  className={`rounded px-1 text-[10.5px] font-medium ${write ? 'bg-warn-soft text-warn' : 'bg-sunken text-muted'}`}
                >
                  {write ? 'Write' : 'Read'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
