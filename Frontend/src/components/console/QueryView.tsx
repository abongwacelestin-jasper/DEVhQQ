import { useState } from 'react';
import { LoaderCircleIcon, PlayIcon } from 'lucide-react';
import { useConsole, useConsoleData } from '../../contexts/ConsoleContext';
import { queryPresets } from '../../data/consoleEndpoints';
import { errorMessage } from '../../utils/consoleClient';
import { buildSnippet } from '../../utils/snippets';
import { JsonView } from './JsonView';
import { Card, CopyButton, EmptyState } from './ConsoleBits';

interface Collection {
  name: string;
  count: number;
  fields: string[];
}
interface QueryResult {
  collection: string;
  total: number;
  returned: number;
  ms: number;
  rows: Record<string, unknown>[];
}

const KEY = 'devhq.console.query';
const initial = JSON.stringify(queryPresets[0].query, null, 2);

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s =
      v === undefined || v === null
        ? ''
        : Array.isArray(v)
          ? v.join(';')
          : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}

/** Structured, allow-listed queries over the store — never evaluated, so nothing to inject. */
export function QueryView() {
  const { call, origin, session } = useConsole();
  const cols = useConsoleData<Collection[]>('/api/system/collections');
  const [text, setText] = useState(() => localStorage.getItem(KEY) ?? initial);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'table' | 'json'>('table');

  const update = (t: string) => {
    setText(t);
    localStorage.setItem(KEY, t);
  };
  const active = (() => {
    try {
      return String((JSON.parse(text) as { collection?: string }).collection ?? '');
    } catch {
      return '';
    }
  })();

  const run = async (q = text) => {
    try {
      JSON.parse(q);
    } catch (e) {
      setResult(null);
      return setError(`Invalid JSON — ${e instanceof Error ? e.message : ''}`);
    }
    setBusy(true);
    const r = await call('POST', '/api/query', q, { record: true });
    setBusy(false);
    if (r.status === 200) {
      setResult(r.body as QueryResult);
      setError(null);
    } else {
      setResult(null);
      setError(errorMessage(r));
    }
  };

  const load = (q: Record<string, unknown>) => {
    const t = JSON.stringify(q, null, 2);
    update(t);
    void run(t);
  };

  const addField = (f: string) => {
    try {
      const q = JSON.parse(text) as { fields?: string[] };
      q.fields = [...new Set([...(q.fields ?? []), f])];
      update(JSON.stringify(q, null, 2));
    } catch {
      setError('Fix the query JSON before adding fields.');
    }
  };

  const rows = result?.rows ?? [];
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const fmt = (v: unknown) =>
    v === undefined || v === null ? (
      <span className="text-subtle">—</span>
    ) : Array.isArray(v) ? (
      v.join(', ')
    ) : typeof v === 'object' ? (
      JSON.stringify(v)
    ) : (
      String(v)
    );
  const fields = cols.data?.find((c) => c.name === active)?.fields ?? [];

  return (
    <div className="mx-auto grid max-w-[1600px] gap-3 lg:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[220px_minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <aside className="grid content-start gap-3">
        <Card title="Collections">
          <div className="p-1.5">
            {(cols.data ?? []).map((c) => (
              <button
                key={c.name}
                onClick={() => load({ collection: c.name, limit: 50 })}
                aria-pressed={active === c.name}
                className={`flex h-7 w-full items-center justify-between rounded-md px-2 font-mono text-[11.5px] ${active === c.name ? 'bg-sunken text-ink' : 'text-muted hover:text-ink'}`}
              >
                {c.name} <span className="font-sans text-[11px] text-subtle">{c.count}</span>
              </button>
            ))}
          </div>
          {fields.length > 0 && (
            <div className="border-t border-line p-2.5">
              <p className="mb-1.5 text-[11px] text-subtle">Fields — click to select</p>
              <div className="flex flex-wrap gap-1">
                {fields.map((f) => (
                  <button
                    key={f}
                    onClick={() => addField(f)}
                    className="rounded border border-line px-1.5 py-px font-mono text-[10.5px] text-muted hover:border-line-strong hover:text-ink"
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card title="Presets">
          <div className="p-1.5">
            {queryPresets.map((p) => (
              <button
                key={p.label}
                onClick={() => load(p.query)}
                className="flex h-7 w-full items-center rounded-md px-2 text-[12px] text-muted hover:bg-sunken hover:text-ink"
              >
                {p.label}
              </button>
            ))}
          </div>
        </Card>
      </aside>

      <Card
        title="Query"
        className="self-start"
        actions={
          <>
            <button
              onClick={() => {
                try {
                  update(JSON.stringify(JSON.parse(text), null, 2));
                } catch {
                  setError('Invalid JSON');
                }
              }}
              className="h-7 rounded-md border border-line px-2 text-[11.5px] font-medium text-muted hover:bg-sunken hover:text-ink"
            >
              Format
            </button>
            <CopyButton
              label="cURL"
              text={buildSnippet('curl', {
                method: 'POST',
                origin,
                url: '/api/query',
                body: text,
                headers: [],
                token: session?.token ?? null,
                includeToken: false,
              })}
            />
            <button
              onClick={() => void run()}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-ink px-2.5 text-[11.5px] font-semibold text-canvas hover:opacity-90"
            >
              {busy ? (
                <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayIcon className="h-3 w-3" />
              )}{' '}
              Run
            </button>
          </>
        }
      >
        <textarea
          value={text}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void run();
            }
          }}
          spellCheck={false}
          rows={14}
          aria-label="Query JSON"
          className="scroll-thin block w-full resize-y bg-canvas p-3 font-mono text-[11.5px] leading-[1.6] outline-none"
        />
        <p className="border-t border-line px-3 py-1.5 font-mono text-[10.5px] text-subtle">
          ops: eq · ne · gt · gte · lt · lte · contains · in · exists — ⌘/Ctrl + Enter to run
        </p>
      </Card>

      <Card
        className="lg:col-span-2 2xl:col-span-1"
        title={
          result ? (
            <span>
              {result.returned}{' '}
              <span className="font-normal text-muted">
                of {result.total} rows · {result.collection} · {result.ms} ms
              </span>
            </span>
          ) : (
            'Results'
          )
        }
        actions={
          result && (
            <>
              <span className="flex rounded-md border border-line p-0.5">
                {(['table', 'json'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                    className={`h-6 rounded px-2 text-[11px] font-medium capitalize ${view === v ? 'bg-sunken text-ink' : 'text-muted'}`}
                  >
                    {v}
                  </button>
                ))}
              </span>
              <CopyButton label="CSV" text={toCsv(rows)} />
              <CopyButton label="JSON" text={JSON.stringify(rows, null, 2)} />
            </>
          )
        }
      >
        {error ? (
          <p className="whitespace-pre-wrap p-3 font-mono text-[11.5px] text-bad">{error}</p>
        ) : !result ? (
          <EmptyState>Run a query to see results. Pick a collection or preset to start.</EmptyState>
        ) : !rows.length ? (
          <EmptyState>No rows match.</EmptyState>
        ) : view === 'json' ? (
          <JsonView value={rows} className="max-h-[560px] p-3" />
        ) : (
          <div className="scroll-thin max-h-[560px] overflow-auto">
            <table className="w-full text-[11.5px]">
              <thead className="sticky top-0 bg-white text-left text-[11px] text-subtle">
                <tr className="border-b border-line">
                  {headers.map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {headers.map((h) => (
                      <td key={h} className="max-w-[260px] truncate whitespace-nowrap px-3 py-1.5">
                        {fmt(r[h])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
