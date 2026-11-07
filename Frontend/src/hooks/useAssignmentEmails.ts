import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useWork } from '../contexts/WorkContext';
import { useDirectory } from '../components/team/useDirectory';
import { useNotifications } from '../components/work/useNotifications';

export type EmailKind = 'assigned' | 'unassigned';

export interface AssignmentEmail {
  id: string;
  kind: EmailKind;
  taskKey: string;
  actor: string;
  at: string;
  note?: string;
}

function readSet(key: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Assignments made to the signed-in member, derived from the task history the
 * API records. Read marks are a per-browser convenience; opening an item also
 * marks the matching server notification (`kind: 'assignment'`, link
 * `/tasks/<key>`) read so the inbox badge agrees.
 *
 * Email is a server concern: the backend has no per-member email preference
 * endpoint, only an operator-configured digest of unread notifications
 * (`MAIL_DIGEST_MINUTES`). So the UI shows no email toggle at all.
 */
export function useAssignmentEmails() {
  const { tasks, events } = useWork();
  const { session } = useAuth();
  const { memberById } = useDirectory();
  const inbox = useNotifications();
  const me = session?.memberId ?? '';
  const readKey = `devhq.inbox-read.${me}`;
  const [read, setRead] = useState<string[]>(() => readSet(readKey));

  useEffect(() => {
    setRead(readSet(readKey));
  }, [readKey]);

  useEffect(() => {
    try {
      localStorage.setItem(readKey, JSON.stringify(read));
    } catch {
      /* storage unavailable — read marks last for this page */
    }
  }, [read, readKey]);

  const emails = useMemo(() => {
    if (!me) return [];
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
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [events, tasks, me]);

  const { items: serverItems, markRead: markServerRead } = inbox;
  /** Clears server-side assignment notifications for these task keys (no-op when unavailable). */
  const syncServer = useCallback(
    (keys: string[]) => {
      const links = new Set(keys.map((k) => `/tasks/${encodeURIComponent(k)}`));
      const ids = serverItems
        .filter((n) => n.kind === 'assignment' && !n.read && links.has(n.link))
        .map((n) => n.id);
      if (ids.length) void markServerRead(ids);
    },
    [serverItems, markServerRead],
  );

  const markRead = useCallback(
    (id: string) => {
      setRead((l) => (l.includes(id) ? l : [...l, id]));
      const item = emails.find((e) => e.id === id);
      if (item) syncServer([item.taskKey]);
    },
    [emails, syncServer],
  );
  const markUnread = useCallback((id: string) => setRead((l) => l.filter((x) => x !== id)), []);
  const markAllRead = useCallback(() => {
    setRead(emails.map((e) => e.id));
    syncServer(emails.map((e) => e.taskKey));
  }, [emails, syncServer]);

  return {
    me,
    myEmail: me ? memberById(me).email : '',
    emails,
    read,
    markRead,
    markUnread,
    markAllRead,
  };
}

/** Mounted once in the app shell: announces new assignments as the task history records them. */
export function useAssignmentNotifier() {
  const { events } = useWork();
  const { session } = useAuth();
  const seen = useRef<number | null>(null);
  const me = session?.memberId ?? '';
  const mine = useMemo(
    () => events.filter((e) => e.kind === 'assignee' && !!me && e.to === me && e.actor !== me),
    [events, me],
  );

  useEffect(() => {
    if (seen.current === null) {
      seen.current = mine.length;
      return;
    }
    if (mine.length > seen.current) {
      const latest = mine[mine.length - 1];
      toast(`${latest.taskKey} assigned to you`, { description: 'See Assigned to me' });
    }
    seen.current = mine.length;
  }, [mine]);
}
