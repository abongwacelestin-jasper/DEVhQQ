import React, { useMemo, useState } from 'react';
import { threadKey } from './CommentThread';
import {
  ListTreeIcon,
  LoaderCircleIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useConsole } from '../../contexts/ConsoleContext';
import { consoleEndpoints } from '../../data/consoleEndpoints';
import { consoleEnvironments, type ConsoleEnvId } from '../../data/consoleDomains';
import { buildUrl, draftFromEndpoint, methodHasBody } from '../../utils/consoleDraft';
import { ResponseViewer } from './ResponseViewer';
import { SnippetPanel } from './SnippetPanel';
import { EndpointTree } from './EndpointTree';
import { Card, EmptyState, MethodTag, StatusCode, ago } from './ConsoleBits';
import type { EndpointDef, HttpMethod, KeyValue, RequestDraft } from '../../types/console';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
type Tab = 'params' | 'headers' | 'body' | 'auth' | 'env';
type TokenMode = 'session' | 'none' | 'custom';
const SCOPES = ['all', 'renewberry', 'blog', 'mirror'] as const;

const ENV_KEY = 'devhq.console.env';

/** Request workbench: route tree · request builder · response inspector. */
export function RequestEditor() {
  const {
    draft,
    setDraft,
    call,
    history,
    clearHistory,
    session,
    lastResponse,
    setLastResponse,
    mode,
    setBaseUrl,
  } = useConsole();
  const [tab, setTab] = useState<Tab>(methodHasBody(draft.method) ? 'body' : 'params');
  const [sending, setSending] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [tokenMode, setTokenMode] = useState<TokenMode>('session');
  const [customToken, setCustomToken] = useState('');
  const [scope, setScope] = useState<(typeof SCOPES)[number]>('all');
  const [envId, setEnvId] = useState<ConsoleEnvId>(
    () => (localStorage.getItem(ENV_KEY) as ConsoleEnvId) || 'local',
  );
  const env = consoleEnvironments.find((e) => e.id === envId) ?? consoleEnvironments[0];
  const url = buildUrl(draft);
  const set = (patch: Partial<RequestDraft>) => setDraft({ ...draft, ...patch });

  const bodyState = useMemo(() => {
    if (!draft.body.trim()) return { ok: true, text: 'Empty', line: 0 };
    try {
      JSON.parse(draft.body);
      return { ok: true, text: 'Valid JSON', line: 0 };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid JSON';
      const pos = Number(/position (\d+)/.exec(msg)?.[1] ?? -1);
      const line = pos >= 0 ? draft.body.slice(0, pos).split('\n').length : 0;
      return { ok: false, text: line ? `Line ${line}: ${msg}` : msg, line };
    }
  }, [draft.body]);

  const systemHeaders: [string, string][] = [
    ['Accept', 'application/json'],
    ...(methodHasBody(draft.method)
      ? ([['Content-Type', 'application/json']] as [string, string][])
      : []),
    ...(tokenMode !== 'none' ? ([['Authorization', 'Bearer ••••••']] as [string, string][]) : []),
    ...(scope !== 'all' ? ([['X-DevHQ-Scope', scope]] as [string, string][]) : []),
  ];

  const tokenOpt =
    tokenMode === 'session' ? undefined : tokenMode === 'none' ? null : customToken.trim() || null;

  const sendDraft = async (d: RequestDraft) => {
    if (sending) return;
    setSending(true);
    const headers = Object.fromEntries(
      d.headers.filter((h) => h.on && h.key).map((h) => [h.key, h.value]),
    );
    if (scope !== 'all') headers['X-DevHQ-Scope'] = scope;
    const res = await call(d.method, buildUrl(d), methodHasBody(d.method) ? d.body : undefined, {
      record: true,
      headers,
      token: tokenOpt,
    });
    setLastResponse(res);
    setSending(false);
  };

  const loadEp = (ep: EndpointDef) => {
    setDraft(draftFromEndpoint(ep));
    setTab(methodHasBody(ep.method) ? 'body' : 'params');
    setTreeOpen(false);
  };
  const runEp = (ep: EndpointDef) => {
    const d = draftFromEndpoint(ep);
    setDraft(d);
    setTreeOpen(false);
    void sendDraft(d);
  };

  const chooseEnv = (id: ConsoleEnvId) => {
    setEnvId(id);
    localStorage.setItem(ENV_KEY, id);
    const next = consoleEnvironments.find((e) => e.id === id)!;
    if (mode === 'live') setBaseUrl(next.url);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void sendDraft(draft);
    }
  };

  const tabs: [Tab, string, number | string][] = [
    ['params', 'Params', draft.params.filter((p) => p.on && p.key).length || ''],
    [
      'headers',
      'Headers',
      draft.headers.filter((h) => h.on && h.key).length + systemHeaders.length,
    ],
    ['body', 'Body', draft.body.trim() ? (bodyState.ok ? '•' : '!') : ''],
    ['auth', 'Auth', ''],
    ['env', 'Environment', ''],
  ];

  const sample = () => {
    const ep = consoleEndpoints.find(
      (e) =>
        e.method === draft.method &&
        new RegExp(`^${e.path.replace(/:[a-zA-Z]+/g, '[^/]+')}$`).test(draft.path),
    );
    if (ep?.example) set({ body: JSON.stringify(ep.example, null, 2) });
  };

  const activeEp = consoleEndpoints.find(
    (e) =>
      e.method === draft.method &&
      new RegExp(`^${e.path.replace(/:[a-zA-Z]+/g, '[^/]+')}$`).test(draft.path),
  );

  return (
    <div
      className="mx-auto grid max-w-[1800px] gap-3 lg:grid-cols-[232px_minmax(0,1fr)] 2xl:grid-cols-[248px_minmax(0,1fr)_minmax(0,1fr)]"
      onKeyDown={onKey}
    >
      {/* Route tree */}
      <Card className="self-start lg:sticky lg:top-0 lg:row-span-2 lg:max-h-[calc(100dvh-7rem)] 2xl:row-span-1">
        <button
          onClick={() => setTreeOpen((o) => !o)}
          aria-expanded={treeOpen}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12px] font-semibold lg:hidden"
        >
          <ListTreeIcon className="h-3.5 w-3.5 text-muted" /> Routes
          <span className="ml-auto text-[11px] font-normal text-subtle">
            {consoleEndpoints.length}
          </span>
        </button>
        <div
          className={`${treeOpen ? 'block max-h-[55vh] border-t border-line' : 'hidden'} lg:flex lg:max-h-[calc(100dvh-7rem)] lg:flex-col lg:border-0`}
        >
          <EndpointTree
            origin={env.url}
            activePath={activeEp?.path}
            onLoad={loadEp}
            onRun={runEp}
          />
        </div>
      </Card>

      {/* Request */}
      <div className="grid min-w-0 content-start gap-3">
        <Card>
          <form
            className="flex gap-1.5 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void sendDraft(draft);
            }}
          >
            <select
              value={draft.method}
              onChange={(e) => set({ method: e.target.value as HttpMethod })}
              aria-label="Method"
              className="h-9 rounded-md border border-line-strong bg-white px-2 font-mono text-[12px] font-semibold outline-none focus:border-accent"
            >
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              value={draft.path}
              onChange={(e) => set({ path: e.target.value })}
              list="console-paths"
              spellCheck={false}
              aria-label="Path"
              placeholder="/api/…"
              className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-white px-3 font-mono text-[12px] outline-none focus:border-accent"
            />
            <datalist id="console-paths">
              {consoleEndpoints.map((e) => (
                <option key={e.method + e.path} value={e.path} />
              ))}
            </datalist>
            <button className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-ink px-3.5 text-[12.5px] font-semibold text-canvas hover:opacity-90">
              {sending ? (
                <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SendIcon className="h-3.5 w-3.5" />
              )}{' '}
              Send
            </button>
          </form>
          <p className="flex items-center gap-2 truncate border-t border-line px-3 py-1.5 font-mono text-[11px] text-subtle">
            <span
              className={`shrink-0 rounded px-1 font-sans text-[10px] font-semibold ${env.tone === 'bad' ? 'bg-bad-soft text-bad' : env.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}
            >
              {env.label}
            </span>
            <span className="truncate">{(mode === 'preview' ? 'preview' : env.url) + url}</span>
          </p>
          <div
            className="no-scrollbar flex items-end gap-1 overflow-x-auto border-y border-line px-2"
            role="tablist"
          >
            {tabs.map(([id, label, n]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2 text-[12px] font-medium transition-colors duration-150 ${tab === id ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
              >
                {label}{' '}
                {n !== '' && (
                  <span
                    className={`ml-0.5 text-[10.5px] ${n === '!' ? 'font-bold text-bad' : 'text-subtle'}`}
                  >
                    {n}
                  </span>
                )}
              </button>
            ))}
            <span className="ml-auto hidden shrink-0 pb-2 text-[11px] text-subtle xl:block">
              ⌘/Ctrl + Enter
            </span>
          </div>
          <div className="p-3">
            {tab === 'params' && (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11.5px] text-subtle">
                    {activeEp?.query?.length
                      ? `Supported: ${activeEp.query.join(', ')}`
                      : 'Query parameters'}
                  </p>
                  <button
                    onClick={() => setBulk((b) => !b)}
                    className="h-6 rounded px-1.5 text-[11.5px] font-medium text-muted hover:bg-sunken hover:text-ink"
                  >
                    {bulk ? 'Key–value edit' : 'Bulk edit'}
                  </button>
                </div>
                {bulk ? (
                  <BulkEditor rows={draft.params} onChange={(params) => set({ params })} />
                ) : (
                  <KvEditor
                    rows={draft.params}
                    onChange={(params) => set({ params })}
                    noun="parameter"
                  />
                )}
              </>
            )}
            {tab === 'headers' && (
              <>
                <p className="mb-1 text-[11px] font-semibold text-subtle">Auto</p>
                <ul className="mb-3 divide-y divide-line rounded-md border border-line bg-sunken/40">
                  {systemHeaders.map(([k, v]) => (
                    <li key={k} className="flex gap-3 px-2.5 py-1 font-mono text-[11.5px]">
                      <span className="w-[38%] shrink-0 text-subtle">{k}</span>
                      <span className="truncate">{v}</span>
                    </li>
                  ))}
                </ul>
                <p className="mb-1 text-[11px] font-semibold text-subtle">
                  Custom — override any auto header
                </p>
                <KvEditor
                  rows={draft.headers}
                  onChange={(headers) => set({ headers })}
                  noun="header"
                />
              </>
            )}
            {tab === 'body' &&
              (methodHasBody(draft.method) ? (
                <>
                  <textarea
                    value={draft.body}
                    onChange={(e) => set({ body: e.target.value })}
                    spellCheck={false}
                    rows={12}
                    aria-label="JSON body"
                    aria-invalid={!bodyState.ok}
                    placeholder="{ }"
                    className={`scroll-thin w-full resize-y rounded-md border bg-canvas p-2.5 font-mono text-[11.5px] leading-[1.6] outline-none ${bodyState.ok ? 'border-line-strong focus:border-accent' : 'border-bad focus:border-bad'}`}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() =>
                        bodyState.ok &&
                        draft.body.trim() &&
                        set({ body: JSON.stringify(JSON.parse(draft.body), null, 2) })
                      }
                      disabled={!bodyState.ok}
                      className="h-7 rounded-md border border-line px-2 text-[11.5px] font-medium text-muted hover:bg-sunken hover:text-ink disabled:opacity-50"
                    >
                      Format
                    </button>
                    <button
                      onClick={sample}
                      disabled={!activeEp?.example}
                      className="h-7 rounded-md border border-line px-2 text-[11.5px] font-medium text-muted hover:bg-sunken hover:text-ink disabled:opacity-50"
                    >
                      Insert sample
                    </button>
                    <span
                      className={`ml-auto truncate text-[11px] ${bodyState.ok ? 'text-ok' : 'font-medium text-bad'}`}
                    >
                      {bodyState.text}
                    </span>
                  </div>
                </>
              ) : (
                <EmptyState>{draft.method} requests don’t send a body.</EmptyState>
              ))}
            {tab === 'auth' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <fieldset>
                  <legend className="mb-1 text-[11.5px] font-semibold">Bearer token</legend>
                  {(
                    [
                      ['session', `Current session (${session?.member.name.split(' ')[0]})`],
                      ['none', 'No auth'],
                      ['custom', 'Custom token'],
                    ] as [TokenMode, string][]
                  ).map(([v, l]) => (
                    <label key={v} className="flex items-center gap-2 py-0.5 text-[12px]">
                      <input
                        type="radio"
                        name="token-mode"
                        checked={tokenMode === v}
                        onChange={() => setTokenMode(v)}
                      />{' '}
                      {l}
                    </label>
                  ))}
                  {tokenMode === 'custom' && (
                    <input
                      value={customToken}
                      onChange={(e) => setCustomToken(e.target.value)}
                      placeholder="pv.m4.verified.…"
                      spellCheck={false}
                      aria-label="Custom token"
                      className="mt-1 h-8 w-full rounded-md border border-line-strong bg-white px-2 font-mono text-[11.5px] outline-none focus:border-accent"
                    />
                  )}
                  {tokenMode === 'session' && (
                    <p className="mt-1 truncate font-mono text-[11px] text-subtle">
                      {session?.token.slice(0, 14)}…{session?.token.slice(-6)}
                    </p>
                  )}
                </fieldset>
                <fieldset>
                  <legend className="mb-1 text-[11.5px] font-semibold">Product scope</legend>
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as (typeof SCOPES)[number])}
                    aria-label="Product scope"
                    className="h-8 w-full rounded-md border border-line-strong bg-white px-2 text-[12px] outline-none focus:border-accent"
                  >
                    {SCOPES.map((s) => (
                      <option key={s} value={s}>
                        {s === 'all' ? 'All products I can see' : s}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-subtle">
                    Sent as <code className="font-mono">X-DevHQ-Scope</code>. The server still
                    enforces your role’s access.
                  </p>
                </fieldset>
              </div>
            )}
            {tab === 'env' && (
              <div className="grid gap-1.5 sm:grid-cols-3">
                {consoleEnvironments.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => chooseEnv(e.id)}
                    aria-pressed={envId === e.id}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors duration-150 ${envId === e.id ? 'border-ink bg-sunken/50' : 'border-line hover:border-line-strong'}`}
                  >
                    <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${e.tone === 'bad' ? 'bg-bad' : e.tone === 'warn' ? 'bg-warn' : 'bg-ok'}`}
                      />
                      {e.label}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10.5px] text-subtle">
                      {e.url}
                    </span>
                  </button>
                ))}
                <p className="text-[11px] text-subtle sm:col-span-3">
                  {mode === 'preview'
                    ? 'Preview server answers every request; the environment sets the host used in copied snippets.'
                    : 'Switching changes where requests are sent. Production calls are audited.'}
                </p>
              </div>
            )}
          </div>
        </Card>
        <SnippetPanel draft={draft} origin={env.url} />
      </div>

      {/* Response */}
      <div className="grid min-w-0 content-start gap-3 lg:col-start-2 2xl:col-start-auto">
        <ResponseViewer
          response={lastResponse}
          sending={sending}
          thread={threadKey(draft.method, draft.path)}
          me={session ? { id: session.member.id, name: session.member.name } : undefined}
        />
        <Card
          title="History"
          actions={
            history.length > 0 && (
              <button
                onClick={clearHistory}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-muted hover:bg-sunken hover:text-ink"
              >
                <Trash2Icon className="h-3.5 w-3.5" /> Clear
              </button>
            )
          }
        >
          {history.length ? (
            <ul className="scroll-thin max-h-[240px] divide-y divide-line overflow-y-auto">
              {history.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => {
                      const [path, qs] = h.url.split('?');
                      setDraft({
                        method: h.method,
                        path,
                        params: qs
                          ? qs.split('&').map((p) => {
                              const [k, v = ''] = p.split('=');
                              return {
                                key: decodeURIComponent(k),
                                value: decodeURIComponent(v),
                                on: true,
                              };
                            })
                          : [],
                        headers: [],
                        body: h.body,
                      });
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] hover:bg-sunken/50"
                  >
                    <MethodTag method={h.method} />
                    <span className="min-w-0 flex-1 truncate font-mono">{h.url}</span>
                    <StatusCode status={h.status} />
                    <span className="w-14 shrink-0 text-right font-mono text-[10.5px] text-subtle">
                      {h.ms} ms
                    </span>
                    <span className="hidden w-14 shrink-0 text-right text-[10.5px] text-subtle sm:block">
                      {ago(h.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Requests you send are kept here for quick replay.</EmptyState>
          )}
        </Card>
      </div>
    </div>
  );
}

function KvEditor({
  rows,
  onChange,
  noun,
}: {
  rows: KeyValue[];
  onChange: (r: KeyValue[]) => void;
  noun: string;
}) {
  const update = (i: number, patch: Partial<KeyValue>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={r.on}
            onChange={(e) => update(i, { on: e.target.checked })}
            aria-label={`Enable ${noun}`}
          />
          <input
            value={r.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder="key"
            spellCheck={false}
            className="h-8 w-[38%] min-w-0 rounded-md border border-line-strong bg-white px-2 font-mono text-[11.5px] outline-none focus:border-accent"
          />
          <input
            value={r.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder="value"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-white px-2 font-mono text-[11.5px] outline-none focus:border-accent"
          />
          <button
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            aria-label={`Remove ${noun}`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-subtle hover:bg-sunken hover:text-ink"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...rows, { key: '', value: '', on: true }])}
        className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-muted hover:bg-sunken hover:text-ink"
      >
        <PlusIcon className="h-3.5 w-3.5" /> Add {noun}
      </button>
    </div>
  );
}

/** `key: value` per line; prefix a line with `#` to disable it. */
function BulkEditor({ rows, onChange }: { rows: KeyValue[]; onChange: (r: KeyValue[]) => void }) {
  const [text, setText] = useState(() =>
    rows.map((r) => `${r.on ? '' : '#'}${r.key}: ${r.value}`).join('\n'),
  );
  const commit = (t: string) => {
    setText(t);
    onChange(
      t
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const on = !l.startsWith('#');
          const [k, ...v] = l.replace(/^#\s*/, '').split(':');
          return { key: k.trim(), value: v.join(':').trim(), on };
        }),
    );
  };
  return (
    <>
      <textarea
        value={text}
        onChange={(e) => commit(e.target.value)}
        rows={6}
        spellCheck={false}
        aria-label="Bulk edit parameters"
        placeholder={'status: in-progress\n#limit: 20'}
        className="scroll-thin w-full resize-y rounded-md border border-line-strong bg-canvas p-2.5 font-mono text-[11.5px] leading-[1.6] outline-none focus:border-accent"
      />
      <p className="mt-1 text-[11px] text-subtle">
        One <code className="font-mono">key: value</code> per line. Start a line with{' '}
        <code className="font-mono">#</code> to turn it off.
      </p>
    </>
  );
}
