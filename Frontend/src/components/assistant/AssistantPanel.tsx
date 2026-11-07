import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpIcon,
  CircleStopIcon,
  CpuIcon,
  ExternalLinkIcon,
  FileSearchIcon,
  HistoryIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { Segmented } from '../ui/Segmented';
import { AssistantIllustration } from './AssistantIllustration';
import { askAssistant, isStreamError, type AskScope } from './askAssistant';
import { RichText, safeHref } from '../messaging/RichText';
import { DemoBadge, Unavailable } from '../work/Unavailable';
import { errorMessage, isAbort, isUnavailable } from '../work/apiState';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  sourceKindLabel,
  sourceRoute,
  suggestedPrompts,
  type AssistantAnswer,
  type AssistantSource,
} from '../../data/assistant';
import { formatTime } from '../../utils/date';

type TurnState = 'loading' | 'streaming' | 'done' | 'error' | 'unavailable' | 'cancelled';

interface Turn {
  id: string;
  question: string;
  at: Date;
  state: TurnState;
  /** Streamed text so far, then the final answer. */
  text: string;
  result?: AssistantAnswer;
  error?: string;
}

type View = 'chat' | 'sources' | 'history';

const ASSISTANT_UNAVAILABLE = 'Assistant unavailable — configure the ML service';

/** Error codes a stream may send when the ML service isn't reachable or configured. */
const UNCONFIGURED = new Set(['integration_unconfigured', 'ml_unavailable', 'service_unavailable']);

/** Ask DevHQ — permission-aware answers from the ML service, with cited sources. */
export function AssistantPanel() {
  const { assistantOpen, setAssistantOpen } = useWorkspaceUI();
  const { selected, allowedProducts } = useProductFilter();
  const { label } = useDateRange();
  const { role } = useAuth();
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [view, setView] = useState<View>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pending = turns.find((t) => t.state === 'loading' || t.state === 'streaming');
  const lastDone = [...turns].reverse().find((t) => t.state === 'done' && t.result);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!assistantOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc cancels an answer in flight first; a second Esc closes the panel.
      if (abortRef.current) cancel();
      else setAssistantOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [assistantOpen, setAssistantOpen, cancel]);

  // Unmounting never leaves a request running.
  useEffect(() => () => abortRef.current?.abort(), []);

  const sources = useMemo(() => {
    const map = new Map<string, AssistantSource>();
    turns.forEach((t) => t.result?.sources.forEach((s) => map.set(`${s.kind}:${s.id}`, s)));
    return [...map.values()];
  }, [turns]);

  const scope: AskScope = useMemo(
    () => ({
      products: selected === 'all' ? allowedProducts.map((p) => p.id) : [selected],
      range: label,
    }),
    [selected, allowedProducts, label],
  );

  const patch = (id: string, p: Partial<Turn>) =>
    setTurns((l) => l.map((t) => (t.id === id ? { ...t, ...p } : t)));

  const ask = (raw: string) => {
    const q = raw.trim();
    if (!q || pending) return;
    const id = `t${Date.now()}`;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setTurns((l) => [...l, { id, question: q, at: new Date(), state: 'loading', text: '' }]);
    setInput('');
    setView('chat');
    askAssistant(q, scope, ctrl.signal, (text) => patch(id, { state: 'streaming', text }))
      .then((result) => patch(id, { state: 'done', text: result.answer, result }))
      .catch((e: unknown) => {
        if (isAbort(e) || ctrl.signal.aborted) return patch(id, { state: 'cancelled' });
        if (isUnavailable(e) || (isStreamError(e) && UNCONFIGURED.has(e.code)))
          return patch(id, { state: 'unavailable' });
        patch(id, { state: 'error', error: errorMessage(e, 'The assistant did not respond.') });
      })
      .finally(() => {
        if (abortRef.current === ctrl) abortRef.current = null;
      });
  };

  const scopeLabel =
    selected === 'all'
      ? `${allowedProducts.length} products`
      : allowedProducts.find((p) => p.id === selected)?.name;

  return (
    <AnimatePresence>
      {assistantOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-ink/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setAssistantOpen(false)}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Ask DevHQ"
            className="fixed inset-0 z-50 flex flex-col bg-white shadow-pop sm:inset-y-0 sm:left-auto sm:w-[400px]"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
          >
            <header className="border-b border-line px-3.5 pb-2 pt-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white">
                  <SparklesIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[13px] font-semibold text-ink">Ask DevHQ</h2>
                  <p className="truncate text-[11px] text-muted">
                    {lastDone?.result
                      ? `Answered by ${lastDone.result.model}`
                      : 'Answers from the DevHQ ML service'}
                  </p>
                </div>
                <button
                  onClick={() => setAssistantOpen(false)}
                  className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink"
                  aria-label="Close assistant"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded-full border border-line px-2 py-0.5 font-medium text-ink">
                  {scopeLabel}
                </span>
                <span className="rounded-full border border-line px-2 py-0.5 font-medium text-ink">
                  {label}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 font-semibold text-ok">
                  <ShieldCheckIcon className="h-3 w-3" /> Permission-aware · {role?.label}
                </span>
              </div>
              <Segmented
                className="mt-2"
                label="Assistant view"
                value={view}
                onChange={setView}
                options={[
                  { value: 'chat', label: 'Chat' },
                  { value: 'sources', label: `Sources ${sources.length || ''}`.trim() },
                  { value: 'history', label: 'History' },
                ]}
              />
            </header>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 scroll-thin"
              aria-live="polite"
              aria-busy={!!pending}
            >
              {view === 'sources' &&
                (sources.length === 0 ? (
                  <Empty icon={FileSearchIcon} text="Records cited in answers will collect here." />
                ) : (
                  <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                    {sources.map((s) => (
                      <li key={`${s.kind}:${s.id}`}>
                        <SourceLink source={s} onNavigate={() => setAssistantOpen(false)} wide />
                      </li>
                    ))}
                  </ul>
                ))}

              {view === 'history' &&
                (turns.length === 0 ? (
                  <Empty icon={HistoryIcon} text="Questions you ask this session appear here." />
                ) : (
                  <ul className="space-y-1.5">
                    {[...turns].reverse().map((t) => (
                      <li key={t.id}>
                        <button
                          onClick={() => ask(t.question)}
                          disabled={!!pending}
                          className="flex w-full items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-left hover:border-line-strong disabled:opacity-50"
                        >
                          <MessageSquareIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                            {t.question}
                          </span>
                          <time className="text-[11px] tabular-nums text-muted">
                            {formatTime(t.at)}
                          </time>
                        </button>
                      </li>
                    ))}
                  </ul>
                ))}

              {view === 'chat' && turns.length === 0 && (
                <div>
                  <AssistantIllustration />
                  <h3 className="mt-3 text-[13.5px] font-semibold text-ink">
                    Answers from your records only
                  </h3>
                  <p className="mt-0.5 text-[12px] text-muted">
                    Answers cite the docs, tasks and incidents they came from and only use records
                    your role can already see. The assistant never takes actions on its own.
                  </p>
                </div>
              )}

              {view === 'chat' &&
                turns.map((t) => (
                  <div key={t.id} className="mb-4">
                    <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3 py-1.5 text-[12.5px] text-white">
                      {t.question}
                    </p>
                    <TurnBody
                      turn={t}
                      onRetry={() => ask(t.question)}
                      retryDisabled={!!pending}
                      onNavigate={() => setAssistantOpen(false)}
                    />
                  </div>
                ))}
            </div>

            <div className="border-t border-line px-3 pb-3 pt-2">
              <div className="mb-2 flex gap-1.5 overflow-x-auto scroll-thin">
                {suggestedPrompts.map((q) => (
                  <button
                    key={q}
                    onClick={() => ask(q)}
                    disabled={!!pending}
                    className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink hover:border-line-strong disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(input);
                }}
                className="flex items-center gap-2 rounded-lg border border-line px-2.5 focus-within:border-accent"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about releases, blockers, workload…"
                  aria-label="Ask a question"
                  className="h-10 min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-subtle"
                />
                {pending ? (
                  <button
                    type="button"
                    onClick={cancel}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11.5px] font-medium text-ink hover:bg-sunken"
                    aria-label="Cancel answer (Esc)"
                    title="Cancel (Esc)"
                  >
                    <CircleStopIcon className="h-3.5 w-3.5" /> Cancel
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    className="rounded-md bg-ink p-1.5 text-white disabled:bg-sunken disabled:text-subtle"
                    aria-label="Send"
                  >
                    <ArrowUpIcon className="h-4 w-4" />
                  </button>
                )}
              </form>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function TurnBody({
  turn: t,
  onRetry,
  retryDisabled,
  onNavigate,
}: {
  turn: Turn;
  onRetry: () => void;
  retryDisabled: boolean;
  onNavigate: () => void;
}) {
  if (t.state === 'loading')
    return (
      <div className="mt-3 space-y-1.5" role="status" aria-label="Reading records">
        <p className="text-[11px] text-muted">Reading the records you can see…</p>
        {[80, 92, 64].map((w) => (
          <div
            key={w}
            className="h-2.5 animate-pulse rounded bg-sunken"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    );

  if (t.state === 'unavailable')
    return (
      <div className="mt-2.5 rounded-lg border border-line">
        <Unavailable
          compact
          title={ASSISTANT_UNAVAILABLE}
          detail="Set ML_SERVICE_URL and ML_SERVICE_TOKEN on the backend, then ask again."
          onRetry={retryDisabled ? undefined : onRetry}
        />
      </div>
    );

  if (t.state === 'error')
    return (
      <div
        role="alert"
        className="mt-2.5 flex items-start gap-2 rounded-md bg-bad-soft px-2.5 py-2 text-[12px] text-bad"
      >
        <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">{t.error}</span>
        <button
          onClick={onRetry}
          disabled={retryDisabled}
          className="inline-flex shrink-0 items-center gap-1 font-semibold hover:underline disabled:opacity-50"
        >
          <RotateCcwIcon className="h-3 w-3" /> Retry
        </button>
      </div>
    );

  if (t.state === 'cancelled' && !t.text)
    return (
      <p className="mt-2 flex items-center gap-2 text-[11.5px] text-muted">
        Cancelled.
        <button
          onClick={onRetry}
          disabled={retryDisabled}
          className="font-semibold text-accent hover:underline disabled:opacity-50"
        >
          Ask again
        </button>
      </p>
    );

  const r = t.result;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="mt-2.5 space-y-2.5"
    >
      <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink">
        <RichText text={t.text} />
        {t.state === 'streaming' && (
          <span
            className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-ink/60 align-middle"
            aria-hidden
          />
        )}
      </p>
      {t.state === 'cancelled' && (
        <p className="text-[11px] text-muted">Cancelled — partial answer.</p>
      )}
      {r && r.sources.length > 0 && (
        <section>
          <h4 className="mb-1 flex items-center gap-1 text-[11.5px] font-semibold text-ok">
            <FileSearchIcon className="h-3.5 w-3.5" /> Sources
          </h4>
          <ul className="flex flex-wrap gap-1">
            {r.sources.map((s) => (
              <li key={`${s.kind}:${s.id}`}>
                <SourceLink source={s} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {r && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <CpuIcon className="h-3 w-3" aria-hidden />
          <span className="font-mono">{r.model}</span>
          {r.source === 'heuristic' && (
            <span className="rounded bg-sunken px-1 font-semibold text-ink">Heuristic</span>
          )}
          {r.source === 'demo' && <DemoBadge />}
          {r.sources.length === 0 && <span>· no records cited — treat as unverified</span>}
        </p>
      )}
    </motion.div>
  );
}

function SourceLink({
  source: s,
  onNavigate,
  wide = false,
}: {
  source: AssistantSource;
  onNavigate: () => void;
  wide?: boolean;
}) {
  const kind = sourceKindLabel[s.kind] ?? s.kind;
  const route = sourceRoute(s);
  const external = !route && s.url ? safeHref(s.url) : null;
  const inner = (
    <>
      <span
        className={`shrink-0 rounded bg-sunken px-1.5 py-0.5 text-center text-[10.5px] font-semibold text-ink ${wide ? 'w-16' : ''}`}
      >
        {kind}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-accent">{s.title || s.id}</span>
      {external && <ExternalLinkIcon className="h-3 w-3 shrink-0 text-muted" aria-hidden />}
    </>
  );
  const cls = wide
    ? 'flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sunken/60'
    : 'flex max-w-[260px] items-center gap-1.5 rounded border border-line bg-white px-1.5 py-0.5 hover:border-accent/40';
  if (route)
    return (
      <Link to={route} onClick={onNavigate} className={cls}>
        {inner}
      </Link>
    );
  if (external)
    return (
      <a href={external} target="_blank" rel="noopener noreferrer" className={cls}>
        {inner}
      </a>
    );
  return <span className={cls}>{inner}</span>;
}

function Empty({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <Icon className="h-6 w-6 text-muted" />
      <p className="mt-2 text-[12.5px] text-muted">{text}</p>
    </div>
  );
}
