import { useState } from 'react';
import { consoleEndpoints, statusCodes } from '../../data/consoleEndpoints';
import { Card, MethodTag, StatusCode } from './ConsoleBits';

/** What each response code means in this API, and which routes can return it. */
export function StatusCodesView() {
  const [open, setOpen] = useState<number | null>(null);
  const groups = [
    ['Success', statusCodes.filter((c) => c.code < 300)],
    ['Client errors', statusCodes.filter((c) => c.code >= 400 && c.code < 500)],
    ['Server errors', statusCodes.filter((c) => c.code >= 500)],
  ] as const;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        {groups.map(([label, codes]) => (
          <div key={label}>
            <p className="border-b border-line bg-sunken/40 px-3 py-1.5 text-[11px] font-semibold text-subtle">
              {label}
            </p>
            <ul className="divide-y divide-line">
              {codes.map((c) => {
                const routes = consoleEndpoints.filter((e) => e.codes.includes(c.code));
                const isOpen = open === c.code;
                return (
                  <li key={c.code}>
                    <button
                      onClick={() => setOpen(isOpen ? null : c.code)}
                      aria-expanded={isOpen}
                      className="grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-start gap-3 px-3 py-2 text-left hover:bg-sunken/40 sm:grid-cols-[52px_170px_minmax(0,1fr)_auto]"
                    >
                      <StatusCode status={c.code} />
                      <span className="text-[12.5px] font-medium">{c.name}</span>
                      <span className="col-span-3 text-[12px] text-muted sm:col-span-1">
                        {c.meaning}
                      </span>
                      <span className="hidden text-[11px] tabular-nums text-subtle sm:block">
                        {routes.length} routes
                      </span>
                    </button>
                    {isOpen && routes.length > 0 && (
                      <ul className="grid gap-x-4 gap-y-0.5 bg-sunken/30 px-3 py-2 sm:grid-cols-2">
                        {routes.map((r) => (
                          <li
                            key={r.method + r.path}
                            className="flex min-w-0 items-center text-[11.5px]"
                          >
                            <MethodTag method={r.method} />
                            <span className="truncate font-mono">{r.path}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Card>
      <Card title="Error shape" className="self-start">
        <div className="space-y-2 p-3 text-[12px] text-muted">
          <p>
            Every error uses one envelope, so clients can branch on{' '}
            <code className="font-mono text-ink">error.code</code> rather than the message.
          </p>
          <pre className="overflow-x-auto rounded-md bg-sunken p-2.5 font-mono text-[11px] text-ink">{`{
  "error": {
    "code": "validation_failed",
    "message": "Unknown field(s): colour",
    "requestId": "8f1c…"
  }
}`}</pre>
          <p>
            Include the <code className="font-mono text-ink">x-request-id</code> header when
            reporting a problem — server logs are keyed by it.
          </p>
        </div>
      </Card>
    </div>
  );
}
