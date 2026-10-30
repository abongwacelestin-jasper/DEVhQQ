import { useState } from 'react';
import { LockIcon, PencilIcon } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { useReauth } from '../../contexts/ReauthContext';
import type { IntegrationScope } from '../../types/security';

export function IntegrationPermissions({
  scopes: initial,
  name,
}: {
  scopes: IntegrationScope[];
  name: string;
}) {
  const { requestReauth } = useReauth();
  const [scopes, setScopes] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const dirty = JSON.stringify(scopes) !== JSON.stringify(saved);
  const writeCount = scopes.filter((s) => s.granted && s.write).length;

  return (
    <Panel
      title="Permissions"
      meta={
        <span className={writeCount ? 'text-warn' : 'text-ok'}>
          {writeCount ? `${writeCount} write scope${writeCount > 1 ? 's' : ''}` : 'Read-only'}
        </span>
      }
    >
      <p className="border-b border-line bg-sunken/40 px-3.5 py-2 text-[12px] text-muted">
        Least privilege: grant only what {name} needs. Required scopes can’t be removed without
        disconnecting.
      </p>
      <ul className="divide-y divide-line">
        {scopes.map((s) => (
          <li key={s.key}>
            <label
              className={`flex items-start gap-2.5 px-3.5 py-2.5 ${s.required ? '' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                checked={s.granted}
                disabled={s.required}
                onChange={() =>
                  setScopes((l) =>
                    l.map((x) => (x.key === s.key ? { ...x, granted: !x.granted } : x)),
                  )
                }
                className="mt-0.5 h-3.5 w-3.5 accent-[#4F46E5]"
              />

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-ink">
                  {s.label}
                  {s.required && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-sunken px-1 text-[10.5px] font-medium text-muted">
                      <LockIcon className="h-2.5 w-2.5" />
                      Required
                    </span>
                  )}
                  {s.write && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-warn-soft px-1 text-[10.5px] font-medium text-warn">
                      <PencilIcon className="h-2.5 w-2.5" />
                      Write
                    </span>
                  )}
                </p>
                <p className="text-[11.5px] text-muted">{s.description}</p>
              </div>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-2 border-t border-line px-3.5 py-2.5">
        <Button size="sm" disabled={!dirty} onClick={() => setScopes(saved)}>
          Discard
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty}
          onClick={() =>
            requestReauth({
              title: 'Update integration permissions',
              description: `${name} will be asked to approve the new scopes on the provider side.`,
              actionLabel: 'Verify & save',
              successMessage: 'Permissions updated',
              onConfirm: () => setSaved(scopes),
            })
          }
        >
          Save permissions
        </Button>
      </div>
    </Panel>
  );
}
