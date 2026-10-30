import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  ArrowUpIcon,
  CircleCheckIcon,
  FileSearchIcon,
  HistoryIcon,
  LightbulbIcon,
  LockIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  SparklesIcon,
  XIcon,
  ZapIcon,
} from 'lucide-react';
import { Segmented } from '../ui/Segmented';
import { AssistantIllustration } from './AssistantIllustration';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useReauth } from '../../contexts/ReauthContext';
import { assistantAnswers, type AssistantAction, type AssistantAnswer } from '../../data/assistant';
import { formatTime } from '../../utils/date';

interface Turn {
  id: string;
  question: string;
  answer: AssistantAnswer;
  at: Date;
  ready: boolean;
}

type View = 'chat' | 'sources' | 'history';

/** Ask DevHQ — permission-aware Q&A over records. Answers are pre-written previews. */
export function AssistantPanel() {
  const { assistantOpen, setAssistantOpen } = useWorkspaceUI();
  const { selected, allowedProducts } = useProductFilter();
  const { label } = useDateRange();
  const { role, canDo } = useAuth();
  const { requestReauth } = useReauth();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [view, setView] = useState<View>('chat');
  const [done, setDone] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const pending = turns.find((t) => !t.ready);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(
      () => setTurns((l) => l.map((x) => (x.id === pending.id ? { ...x, ready: true } : x))),
      800,
    );
    return () => clearTimeout(t);
  }, [pending]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  useEffect(() => {
    if (!assistantOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAssistantOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [assistantOpen, setAssistantOpen]);

  const sources = useMemo(() => {
    const map = new Map<string, AssistantAnswer['facts'][number]['cite']>();
    turns
      .filter((t) => t.ready)
      .forEach((t) => t.answer.facts.forEach((f) => map.set(f.cite.to, f.cite)));
    return [...map.values()];
  }, [turns]);

  const ask = (q: string) => {
    if (!q.trim() || pending) return;
    const lower = q.toLowerCase();
    const match =
      assistantAnswers.find((a) => a.keywords.some((k) => lower.includes(k))) ??
      assistantAnswers[0];
    setTurns((l) => [
      ...l,
      { id: `t${Date.now()}`, question: q.trim(), answer: match, at: new Date(), ready: false },
    ]);
    setInput('');
    setView('chat');
  };

  const go = (to: string) => {
    setAssistantOpen(false);
    navigate(to);
  };

  const authorise = (a: AssistantAction) => {
    const key = a.label;
    const finish = () => {
      setDone((s) => new Set(s).add(key));
      toast.success('Authorised', { description: `${a.label} · recorded in the audit log` });
    };
    if (a.production) {
      if (!canDo('deploy:approve')) {
        toast.error('Not permitted', {
          description: `${role?.label ?? 'Your role'} can’t authorise production actions.`,
        });
        return;
      }
      requestReauth({
        title: a.label,
        description: `${a.requirement}. The assistant never runs this on its own.`,
        actionLabel: 'Verify & authorise',
        onConfirm: finish,
      });
    } else finish();
  };

  const scope =
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
                  <p className="text-[11px] text-muted">Preview · pre-written answers</p>
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
                  {scope}
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
            >
              {view === 'sources' &&
                (sources.length === 0 ? (
                  <Empty icon={FileSearchIcon} text="Records cited in answers will collect here." />
                ) : (
                  <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                    {sources.map((s) => (
                      <li key={s.to}>
                        <button
                          onClick={() => go(s.to)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sunken/60"
                        >
                          <span className="w-16 shrink-0 rounded bg-sunken px-1.5 py-0.5 text-center text-[10.5px] font-semibold text-ink">
                            {s.kind}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-accent">
                            {s.label}
                          </span>
                        </button>
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
                          className="flex w-full items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-left hover:border-line-strong"
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
                    Facts link to their source. Suggestions are labelled. Nothing runs without your
                    explicit authorisation.
                  </p>
                </div>
              )}

              {view === 'chat' &&
                turns.map((t) => (
                  <div key={t.id} className="mb-4">
                    <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3 py-1.5 text-[12.5px] text-white">
                      {t.question}
                    </p>
                    {!t.ready ? (
                      <div className="mt-3 space-y-1.5" aria-label="Reading records">
                        <p className="text-[11px] text-muted">
                          Reading tasks, pull requests, deployments…
                        </p>
                        {[80, 92, 64].map((w) => (
                          <div
                            key={w}
                            className="h-2.5 animate-pulse rounded bg-sunken"
                            style={{ width: `${w}%` }}
                          />
                        ))}
                      </div>
                    ) : (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                        className="mt-2.5 space-y-2.5"
                      >
                        <p className="text-[12.5px] font-medium leading-relaxed text-ink">
                          {t.answer.summary}
                        </p>
                        <Block icon={CircleCheckIcon} title="Verified facts" tone="text-ok">
                          <ul className="space-y-1">
                            {t.answer.facts.map((f) => (
                              <li
                                key={f.text}
                                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md bg-sunken/70 px-2.5 py-1.5 text-[12px] text-ink"
                              >
                                <span>{f.text}</span>
                                <button
                                  onClick={() => go(f.cite.to)}
                                  className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[10.5px] text-accent hover:border-accent/40"
                                >
                                  {f.cite.label}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </Block>
                        <Block
                          icon={LightbulbIcon}
                          title="Suggestions · not verified"
                          tone="text-warn"
                        >
                          <ul className="space-y-1 border-l-2 border-warn/30 pl-2.5">
                            {t.answer.suggestions.map((s) => (
                              <li key={s} className="text-[12px] text-ink">
                                {s}
                              </li>
                            ))}
                          </ul>
                        </Block>
                        {t.answer.actions.length > 0 && (
                          <Block
                            icon={ZapIcon}
                            title="Actions · need your authorisation"
                            tone="text-accent"
                          >
                            <ul className="space-y-1">
                              {t.answer.actions.map((a) => {
                                const ok = done.has(a.label);
                                return (
                                  <li
                                    key={a.label}
                                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-line px-2.5 py-1.5"
                                  >
                                    <span className="min-w-0">
                                      <span className="block truncate text-[12px] font-medium text-ink">
                                        {a.label}
                                      </span>
                                      <span className="flex items-center gap-1 text-[11px] text-muted">
                                        {a.production && <LockIcon className="h-3 w-3 text-bad" />}
                                        {a.requirement}
                                      </span>
                                    </span>
                                    <button
                                      disabled={ok}
                                      onClick={() => authorise(a)}
                                      className={`h-7 rounded-md px-2 text-[11.5px] font-semibold ${ok ? 'bg-ok-soft text-ok' : a.production ? 'bg-bad text-white hover:bg-bad/90' : 'bg-ink text-white hover:bg-ink/90'}`}
                                    >
                                      {ok ? 'Authorised' : a.production ? 'Verify' : 'Authorise'}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          </Block>
                        )}
                      </motion.div>
                    )}
                  </div>
                ))}
            </div>

            <div className="border-t border-line px-3 pb-3 pt-2">
              <div className="mb-2 flex gap-1.5 overflow-x-auto scroll-thin">
                {assistantAnswers.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => ask(a.question)}
                    disabled={!!pending}
                    className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink hover:border-line-strong disabled:opacity-50"
                  >
                    {a.question}
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
                <button
                  type="submit"
                  disabled={!input.trim() || !!pending}
                  className="rounded-md bg-ink p-1.5 text-white disabled:bg-sunken disabled:text-subtle"
                  aria-label="Send"
                >
                  <ArrowUpIcon className="h-4 w-4" />
                </button>
              </form>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Block({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className={`mb-1 flex items-center gap-1 text-[11.5px] font-semibold ${tone}`}>
        <Icon className="h-3.5 w-3.5" /> {title}
      </h4>
      {children}
    </section>
  );
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
