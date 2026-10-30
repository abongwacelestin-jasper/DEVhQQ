import { useEffect, useMemo, useRef, useState } from 'react';

export interface Peer {
  id: string;
  name: string;
  initials: string;
  color: string;
  view: string;
  /** Request the peer is looking at, if any (e.g. "GET /api/tasks"). */
  focus?: string;
  lastSeen: number;
  /** Seeded teammate rather than another open tab. */
  simulated?: boolean;
}

const CHANNEL = 'devhq.console.presence';
const HEARTBEAT_MS = 4000;
const STALE_MS = 12_000;
const COLORS = [
  'bg-[#4F46E5]',
  'bg-[#0EA5E9]',
  'bg-[#16A34A]',
  'bg-[#D97706]',
  'bg-[#DB2777]',
  'bg-[#7C3AED]',
];

const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
const colorFor = (id: string) =>
  COLORS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length];

/** Teammates shown in preview mode so presence is visible with a single tab open. */
const SEEDED: Omit<Peer, 'lastSeen'>[] = [
  {
    id: 'm11',
    name: 'Grace Liu',
    initials: 'GL',
    color: colorFor('m11'),
    view: 'Server logs',
    focus: 'GET /api/system/logs',
    simulated: true,
  },
  {
    id: 'm4',
    name: 'Daniel Mensah',
    initials: 'DM',
    color: colorFor('m4'),
    view: 'Workbench',
    focus: 'POST /api/tasks',
    simulated: true,
  },
];

/**
 * Who else has the console open. Real presence across tabs/windows of this browser via
 * BroadcastChannel; against a live server, swap the channel for the /api/system/events stream.
 */
export function usePresence(
  me: { id: string; name: string },
  view: string,
  focus?: string,
  includeSeeded = true,
): Peer[] {
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const tabId = useRef(`${me.id}:${Math.random().toString(36).slice(2, 8)}`);
  const state = useRef({ view, focus });
  state.current = { view, focus };

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANNEL);
    const announce = (type: 'here' | 'bye' = 'here') =>
      ch.postMessage({
        type,
        peer: {
          id: tabId.current,
          name: me.name,
          initials: initials(me.name),
          color: colorFor(me.id),
          view: state.current.view,
          focus: state.current.focus,
          lastSeen: Date.now(),
        },
      });
    ch.onmessage = (e: MessageEvent<{ type: 'here' | 'bye' | 'ping'; peer?: Peer }>) => {
      if (e.data.type === 'ping') return announce();
      const p = e.data.peer;
      if (!p || p.id === tabId.current) return;
      setPeers((cur) => {
        const next = { ...cur };
        if (e.data.type === 'bye') delete next[p.id];
        else next[p.id] = { ...p, lastSeen: Date.now() };
        return next;
      });
    };
    announce();
    ch.postMessage({ type: 'ping' });
    const beat = setInterval(() => {
      announce();
      setPeers((cur) =>
        Object.fromEntries(
          Object.entries(cur).filter(([, p]) => Date.now() - p.lastSeen < STALE_MS),
        ),
      );
    }, HEARTBEAT_MS);
    const bye = () => announce('bye');
    window.addEventListener('beforeunload', bye);
    return () => {
      bye();
      clearInterval(beat);
      window.removeEventListener('beforeunload', bye);
      ch.close();
    };
  }, [me.id, me.name]);

  // Re-announce immediately when this tab changes view so others update without waiting a beat.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({
      type: 'here',
      peer: {
        id: tabId.current,
        name: me.name,
        initials: initials(me.name),
        color: colorFor(me.id),
        view,
        focus,
        lastSeen: Date.now(),
      },
    });
    ch.close();
  }, [view, focus, me.id, me.name]);

  return useMemo(() => {
    const real = Object.values(peers);
    const seeded = includeSeeded
      ? SEEDED.filter((s) => s.id !== me.id).map((s) => ({ ...s, lastSeen: Date.now() }))
      : [];
    return [...real, ...seeded];
  }, [peers, includeSeeded, me.id]);
}
