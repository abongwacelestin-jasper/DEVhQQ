import { useState } from 'react';
import { useConsole } from '../../contexts/ConsoleContext';
import { buildSnippet, snippetKinds, type SnippetKind } from '../../utils/snippets';
import { buildUrl, methodHasBody } from '../../utils/consoleDraft';
import { Card, CopyButton } from './ConsoleBits';
import type { RequestDraft } from '../../types/console';

/** Copy the current request as cURL, HTTPie, fetch, axios, Python, Go, PowerShell, wget or raw HTTP. */
export function SnippetPanel({
  draft,
  origin: originOverride,
}: {
  draft: RequestDraft;
  origin?: string;
}) {
  const { origin: ctxOrigin, session } = useConsole();
  const origin = originOverride ?? ctxOrigin;
  const [kind, setKind] = useState<SnippetKind>(
    () => (localStorage.getItem('devhq.console.snippet') as SnippetKind) || 'curl',
  );
  const [includeToken, setIncludeToken] = useState(false);

  const code = buildSnippet(kind, {
    method: draft.method,
    origin,
    url: buildUrl(draft),
    body: methodHasBody(draft.method) ? draft.body : '',
    headers: draft.headers.filter((h) => h.on && h.key).map((h) => [h.key, h.value]),
    token: session?.token ?? null,
    includeToken,
  });
  const label = snippetKinds.find((s) => s.id === kind)!.label;

  return (
    <Card>
      <div
        className="no-scrollbar flex items-end gap-0.5 overflow-x-auto border-b border-line px-2"
        role="tablist"
        aria-label="Snippet language"
      >
        {snippetKinds.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={kind === s.id}
            onClick={() => {
              setKind(s.id);
              localStorage.setItem('devhq.console.snippet', s.id);
            }}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2 py-2 text-[11.5px] font-medium transition-colors duration-150 ${kind === s.id ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <input
            type="checkbox"
            checked={includeToken}
            onChange={(e) => setIncludeToken(e.target.checked)}
          />{' '}
          Include live token
        </label>
        <span className={`text-[11px] ${includeToken ? 'font-medium text-warn' : 'text-subtle'}`}>
          {includeToken ? 'Treat this snippet as a secret' : 'Uses $DEVHQ_TOKEN'}
        </span>
        <CopyButton text={code} label={`Copy ${label}`} className="ml-auto" />
      </div>
      <pre className="scroll-thin max-h-[300px] overflow-auto whitespace-pre p-3 font-mono text-[11.5px] leading-[1.6] text-ink">
        {code}
      </pre>
    </Card>
  );
}
