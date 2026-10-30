import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronRightIcon, LinkIcon, PlayIcon, SearchIcon, TerminalSquareIcon } from 'lucide-react';
import { consoleEndpoints } from '../../data/consoleEndpoints';
import { consoleDomains, domainOf } from '../../data/consoleDomains';
import { draftFromEndpoint, buildUrl, methodHasBody } from '../../utils/consoleDraft';
import { buildSnippet } from '../../utils/snippets';
import { MethodTag } from './ConsoleBits';
import type { EndpointDef } from '../../types/console';

interface Props {
  origin: string;
  activePath?: string;
  onLoad: (ep: EndpointDef) => void;
  onRun: (ep: EndpointDef) => void;
}

/** Searchable, numbered-domain tree of every route, with hover actions per endpoint. */
export function EndpointTree({ origin, activePath, onLoad, onRun }: Props) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    return consoleDomains
      .map((d) => ({
        d,
        items: consoleEndpoints.filter(
          (e) =>
            domainOf(e).id === d.id &&
            (!term || `${e.method} ${e.path} ${e.summary}`.toLowerCase().includes(term)),
        ),
      }))
      .filter((g) => g.items.length);
  }, [q]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Clipboard unavailable');
    }
  };

  const curlFor = (ep: EndpointDef) => {
    const d = draftFromEndpoint(ep);
    return buildSnippet('curl', {
      method: d.method,
      origin,
      url: buildUrl(d),
      body: methodHasBody(d.method) ? d.body : '',
      headers: [],
      token: null,
      includeToken: false,
    });
  };

  return (
    <nav aria-label="Endpoints" className="flex min-h-0 flex-col">
      <label className="relative m-2 block">
        <span className="sr-only">Filter endpoints</span>
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter routes…"
          className="h-7 w-full rounded-md border border-line bg-white pl-7 pr-2 text-[12px] outline-none focus:border-accent"
        />
      </label>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {groups.length === 0 && (
          <p className="px-2 py-6 text-center text-[12px] text-muted">No routes match.</p>
        )}
        {groups.map(({ d, items }) => {
          const isClosed = !q && closed[d.id];
          return (
            <section key={d.id} className="mb-0.5">
              <button
                onClick={() => setClosed((c) => ({ ...c, [d.id]: !c[d.id] }))}
                aria-expanded={!isClosed}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11.5px] font-semibold text-ink hover:bg-sunken"
              >
                <ChevronRightIcon
                  className={`h-3 w-3 text-subtle transition-transform duration-150 ${isClosed ? '' : 'rotate-90'}`}
                />
                <span className="font-mono text-[10.5px] text-subtle">{d.id}.</span>
                {d.label}
                <span className="ml-auto text-[10.5px] font-normal tabular-nums text-subtle">
                  {items.length}
                </span>
              </button>
              {!isClosed && (
                <ul>
                  {items.map((ep) => {
                    const active = activePath === ep.path;
                    return (
                      <li
                        key={ep.method + ep.path}
                        className={`group relative flex items-center rounded-md ${active ? 'bg-accent-soft' : 'hover:bg-sunken/70'}`}
                      >
                        <button
                          onClick={() => onLoad(ep)}
                          title={ep.summary}
                          className="flex min-w-0 flex-1 items-center gap-1 py-1 pl-6 pr-1 text-left"
                        >
                          <MethodTag method={ep.method} />
                          <span className="truncate font-mono text-[11px] text-ink">
                            {ep.path.replace('/api', '')}
                          </span>
                        </button>
                        <span className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100">
                          <button
                            onClick={() => onRun(ep)}
                            aria-label={`Run ${ep.method} ${ep.path}`}
                            title="Run"
                            className="grid h-6 w-6 place-items-center rounded text-ok hover:bg-white"
                          >
                            <PlayIcon className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => void copy(curlFor(ep), 'cURL')}
                            aria-label="Copy cURL"
                            title="CLI snippet"
                            className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-white hover:text-ink"
                          >
                            <TerminalSquareIcon className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => void copy(origin + ep.path, 'URL')}
                            aria-label="Copy URL"
                            title="Copy URL"
                            className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-white hover:text-ink"
                          >
                            <LinkIcon className="h-3 w-3" />
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </nav>
  );
}
