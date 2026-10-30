import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PauseIcon, PlayIcon, Trash2Icon } from 'lucide-react';
import { useConsole } from '../../contexts/ConsoleContext';
import { Card, EmptyState, Pill, StatusCode } from './ConsoleBits';
import type { ServerEvent } from '../../utils/consoleMockApi';

const KINDS: ServerEvent['kind'][] = ['request', 'auth', 'audit', 'error'];
const KIND_TONE = { request: 'muted', auth: 'info', audit: 'warn', error: 'bad' } as const;

/** Tails /api/system/events. New events slide in at the top; pause to inspect. */
export function LiveEventsView() {
  const { call } = useConsole();
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [live, setLive] = useState(true);
  const [kinds, setKinds] = useState<Set<ServerEvent['kind']>>(new Set(KINDS));
  const after = useRef(0);

  useEffect(() => {
    if (!live) return;
    let stop = false;
    const tick = async () => {
      const r = await call('GET', `/api/system/events?after=${after.current}`);
      if (stop || r.status !== 200) return;
      const next = r.body as ServerEvent[];
      if (next.length) {
        after.current = next[next.length - 1].seq;
        setEvents((e) => [...next.reverse(), ...e].slice(0, 300));
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [live, call]);

  const shown = events.filter((e) => kinds.has(e.kind));
  const toggle = (k: ServerEvent['kind']) =>
    setKinds((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="mx-auto max-w-[1300px] space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k}
            onClick={() => toggle(k)}
            aria-pressed={kinds.has(k)}
            className={`h-7 rounded-md border px-2.5 text-[12px] font-medium capitalize ${kinds.has(k) ? 'border-ink bg-white text-ink' : 'border-line text-subtle'}`}
          >
            {k}{' '}
            <span className="ml-0.5 tabular-nums text-subtle">
              {events.filter((e) => e.kind === k).length}
            </span>
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setEvents([])}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted hover:bg-sunken hover:text-ink"
          >
            <Trash2Icon className="h-3.5 w-3.5" /> Clear
          </button>
          <button
            onClick={() => setLive((l) => !l)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[12px] font-medium text-muted hover:text-ink"
          >
            {live ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}{' '}
            {live ? 'Pause' : 'Resume'}
            {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />}
          </button>
        </span>
      </div>
      <Card>
        {shown.length === 0 ? (
          <EmptyState>
            Waiting for events — send a request from the workbench to see it here.
          </EmptyState>
        ) : (
          <ul className="scroll-thin max-h-[70vh] divide-y divide-line overflow-y-auto">
            <AnimatePresence initial={false}>
              {shown.map((e) => (
                <motion.li
                  key={e.seq}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                  className="grid grid-cols-[64px_64px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-[11.5px]"
                >
                  <span className="font-mono text-subtle">
                    {new Date(e.at).toLocaleTimeString([], { hour12: false })}
                  </span>
                  <Pill tone={KIND_TONE[e.kind]}>{e.kind}</Pill>
                  <span className="truncate font-mono">
                    {e.summary}
                    {e.actor && <span className="ml-2 font-sans text-subtle">by {e.actor}</span>}
                  </span>
                  {e.status !== undefined && <StatusCode status={e.status} />}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Card>
    </div>
  );
}
