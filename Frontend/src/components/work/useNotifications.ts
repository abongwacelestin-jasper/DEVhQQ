import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { errorMessage, isDemo, isUnavailable, type Availability } from './apiState';

/**
 * The signed-in member's inbox (Backend/routes/notifications.routes.ts).
 *
 *   GET  /api/notifications?before=<ntf-id>&limit=&unread=1&kind=
 *        → {items: ApiNotification[], unread: number, nextCursor?: string}
 *   POST /api/notifications/read {ids} | {all: true} → {updated, unread}
 *
 * `404`/`503` → `status: 'unavailable'`; nothing is substituted.
 */
export type NotificationKind =
  'mention' | 'assignment' | 'approval' | 'doc-comment' | 'offboarding' | 'security';

/** `publicNotification()` in Backend/domain/collab/notify.ts. */
export interface ApiNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  /** Plain-text excerpt (≤200 chars). Mentions inside it are raw `@memberId`. */
  body: string;
  /** In-app path, e.g. `/messages/general?m=msg-…` or `/tasks/RB-212`. */
  link: string;
  refId: string;
  actor: string;
  at: string;
  read: boolean;
  readAt?: string;
}

interface NotificationsResponse {
  items: ApiNotification[];
  unread: number;
  nextCursor?: string;
  source?: string;
}

interface ReadResponse {
  updated: number;
  unread: number;
}

export function useNotifications() {
  const { session } = useAuth();
  const me = session?.memberId ?? null;
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [serverUnread, setServerUnread] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [status, setStatus] = useState<Availability>('loading');
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  const reload = useCallback(async () => {
    try {
      const body = await api<NotificationsResponse>('/api/notifications');
      setItems(body.items ?? []);
      setServerUnread(typeof body.unread === 'number' ? body.unread : null);
      setNextCursor(body.nextCursor);
      setDemo(isDemo(body));
      setStatus('ready');
      setError(null);
    } catch (e) {
      if (isUnavailable(e)) setStatus('unavailable');
      else {
        setStatus('error');
        setError(errorMessage(e, "Couldn't load notifications."));
      }
    }
  }, []);

  useEffect(() => {
    if (!me) {
      setItems([]);
      setServerUnread(null);
      setStatus('loading');
      return;
    }
    setStatus('loading');
    void reload();
  }, [me, reload]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    try {
      const body = await api<NotificationsResponse>(
        `/api/notifications?before=${encodeURIComponent(nextCursor)}`,
      );
      setItems((l) => {
        const seen = new Set(l.map((n) => n.id));
        return [...l, ...(body.items ?? []).filter((n) => !seen.has(n.id))];
      });
      setNextCursor(body.nextCursor);
    } catch (e) {
      toast.error("Couldn't load older notifications", { description: errorMessage(e) });
    }
  }, [nextCursor]);

  /** Optimistic; a failed write says so and resyncs with the server. */
  const markRead = useCallback(
    async (ids: string[] | 'all') => {
      const target = ids === 'all' ? null : new Set(ids);
      const flipped = items.filter((n) => !n.read && (!target || target.has(n.id))).length;
      if (!flipped) return;
      setItems((l) => l.map((n) => (!target || target.has(n.id) ? { ...n, read: true } : n)));
      setServerUnread((u) => (u === null ? u : ids === 'all' ? 0 : Math.max(0, u - flipped)));
      try {
        const res = await api<ReadResponse>('/api/notifications/read', {
          method: 'POST',
          body: ids === 'all' ? { all: true } : { ids },
        });
        setServerUnread(res.unread);
      } catch (e) {
        toast.error('Marking as read failed', { description: errorMessage(e) });
        void reload();
      }
    },
    [items, reload],
  );

  const unread = useMemo(
    () => serverUnread ?? items.filter((n) => !n.read).length,
    [serverUnread, items],
  );

  return { items, unread, status, error, demo, reload, loadMore, hasMore: !!nextCursor, markRead };
}
