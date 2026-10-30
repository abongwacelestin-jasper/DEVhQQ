import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useWork } from '../contexts/WorkContext';
import { currentUserId, members } from '../data/team';
import { nowISO } from '../utils/date';

export type EmailMode = 'instant' | 'daily' | 'off';
export type EmailKind = 'assigned' | 'unassigned' | 'test';

export interface EmailPrefs {
  mode: EmailMode;
  onAssign: boolean;
  onUnassign: boolean;
  onDue: boolean;
}

export interface AssignmentEmail {
  id: string;
  kind: EmailKind;
  taskKey: string;
  actor: string;
  at: string;
  note?: string;
}

const PREFS = 'devhq.email-prefs';
const defaultPrefs: EmailPrefs = { mode: 'instant', onAssign: true, onUnassign: true, onDue: true };

function readPrefs(): EmailPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? 'null');
    return v && typeof v === 'object' && ['instant', 'daily', 'off'].includes(v.mode)
      ? { ...defaultPrefs, ...v }
      : defaultPrefs;
  } catch {
    return defaultPrefs;
  }
}

function readSet(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Assignment notifications for the signed-in member, derived from the task history, plus simulated email delivery. */
export function useAssignmentEmails() {
  const { tasks, events } = useWork();
  const me = currentUserId;
  const myEmail = members.find((m) => m.id === me)?.email ?? 'you@techorg.io';
  const readKey = `devhq.inbox-read.${me}`;
  const [prefs, setPrefsState] = useState<EmailPrefs>(readPrefs);
  const [read, setRead] = useState<string[]>(() => readSet(readKey));
  const [tests, setTests] = useState<AssignmentEmail[]>([]);

  useEffect(() => {
    localStorage.setItem(readKey, JSON.stringify(read));
  }, [read, readKey]);

  const setPrefs = useCallback((p: EmailPrefs) => {
    setPrefsState(p);
    localStorage.setItem(PREFS, JSON.stringify(p));
  }, []);

  const emails = useMemo(() => {
    const out: AssignmentEmail[] = [];
    const viaEvent = new Set<string>();
    events.forEach((e) => {
      if (e.kind !== 'assignee') return;
      if (e.to === me && e.actor !== me) {
        out.push({
          id: e.id,
          kind: 'assigned',
          taskKey: e.taskKey,
          actor: e.actor,
          at: e.at,
          note: e.note,
        });
        viaEvent.add(e.taskKey);
      } else if (e.from === me && e.to !== me && e.actor !== me) {
        out.push({
          id: e.id,
          kind: 'unassigned',
          taskKey: e.taskKey,
          actor: e.actor,
          at: e.at,
          note: e.note,
        });
      }
    });
    tasks.forEach((t) => {
      if (
        t.assignee === me &&
        t.createdBy &&
        t.createdBy !== me &&
        t.createdAt &&
        !viaEvent.has(t.key)
      ) {
        out.push({
          id: `new-${t.key}`,
          kind: 'assigned',
          taskKey: t.key,
          actor: t.createdBy,
          at: t.createdAt,
        });
      }
    });
    return [...out, ...tests].sort((a, b) => b.at.localeCompare(a.at));
  }, [events, tasks, tests, me]);

  const markRead = useCallback(
    (id: string) => setRead((l) => (l.includes(id) ? l : [...l, id])),
    [],
  );
  const markUnread = useCallback((id: string) => setRead((l) => l.filter((x) => x !== id)), []);
  const markAllRead = useCallback(() => setRead(emails.map((e) => e.id)), [emails]);

  const sendTest = useCallback(() => {
    const t = tasks.find((x) => x.assignee === me) ?? tasks[0];
    setTests((l) => [
      {
        id: `test${Date.now()}`,
        kind: 'test',
        taskKey: t.key,
        actor: me,
        at: nowISO(),
        note: 'Test email from your notification settings',
      },
      ...l,
    ]);
    toast.success('Test email sent', { description: `Delivered to ${myEmail}` });
  }, [tasks, me, myEmail]);

  const willEmail = (e: AssignmentEmail) =>
    prefs.mode !== 'off' &&
    (e.kind === 'test' || (e.kind === 'assigned' ? prefs.onAssign : prefs.onUnassign));

  return {
    emails,
    prefs,
    setPrefs,
    read,
    markRead,
    markUnread,
    markAllRead,
    sendTest,
    myEmail,
    willEmail,
  };
}

/** Mounted once in the app shell: announces new assignment emails as they're "sent". */
export function useAssignmentNotifier() {
  const { events } = useWork();
  const seen = useRef<number | null>(null);
  const me = currentUserId;
  const mine = events.filter((e) => e.kind === 'assignee' && e.to === me && e.actor !== me);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = mine.length;
      return;
    }
    if (mine.length > seen.current) {
      const latest = mine[mine.length - 1];
      const prefs = readPrefs();
      const email = members.find((m) => m.id === me)?.email;
      if (prefs.mode === 'instant' && prefs.onAssign)
        toast(`${latest.taskKey} assigned to you`, { description: `Email sent to ${email}` });
      else
        toast(`${latest.taskKey} assigned to you`, {
          description:
            prefs.mode === 'daily'
              ? 'Included in tomorrow’s digest'
              : 'Email notifications are off',
        });
    }
    seen.current = mine.length;
  }, [mine.length]); // eslint-disable-line react-hooks/exhaustive-deps
}
