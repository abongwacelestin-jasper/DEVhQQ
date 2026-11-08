/**
 * The relational data layer's entry point (ADR 0011).
 *
 *   import { repos } from '../data/index.ts';
 *   const m = await repos.members.get(id);
 *
 * `repos` is one mutable holder: in-memory implementations by default (tests,
 * smoke, local development without DATABASE_URL); db/boot.ts swaps in the
 * PostgreSQL implementations with `installRepositories(pgRepositories(…))`
 * before the server accepts traffic. Always read `repos.x` at call time;
 * never keep a reference to a repository across a boot.
 *
 * Collections migrated here are no longer `Collection`s: nothing about them
 * is hydrated or held in process memory, so any number of replicas can serve
 * them. Everything else still goes through store/collection.ts.
 */

import type { DocumentMirror } from './common.ts';
import { noMirror } from './common.ts';
import { MemoryMembersRepo, PgMembersRepo, type MembersRepo, type TxPool } from './members.ts';
import {
  MemoryNotificationsRepo,
  PgNotificationsRepo,
  type NotificationsRepo,
} from './notifications.ts';
import { MemorySessionStore, PgSessionStore, type SessionStore } from './sessions.ts';
import {
  MemoryTaskCommentsRepo,
  MemoryTaskEventsRepo,
  MemoryTaskStore,
  MemoryTasksRepo,
  PgTaskCommentsRepo,
  PgTaskEventsRepo,
  PgTasksRepo,
  type TaskCommentsRepo,
  type TaskEventsRepo,
  type TasksRepo,
} from './tasks.ts';

export interface Repositories {
  members: MembersRepo;
  sessions: SessionStore;
  tasks: TasksRepo;
  taskEvents: TaskEventsRepo;
  taskComments: TaskCommentsRepo;
  notifications: NotificationsRepo;
}

export function memoryRepositories(): Repositories {
  const taskStore = new MemoryTaskStore();
  return {
    members: new MemoryMembersRepo(),
    sessions: new MemorySessionStore(),
    tasks: new MemoryTasksRepo(taskStore),
    taskEvents: new MemoryTaskEventsRepo(taskStore),
    taskComments: new MemoryTaskCommentsRepo(taskStore),
    notifications: new MemoryNotificationsRepo(),
  };
}

export function pgRepositories(pool: TxPool, mirror: DocumentMirror = noMirror): Repositories {
  return {
    members: new PgMembersRepo(pool, mirror),
    sessions: new PgSessionStore(pool, mirror),
    tasks: new PgTasksRepo(pool, mirror),
    taskEvents: new PgTaskEventsRepo(pool, mirror),
    taskComments: new PgTaskCommentsRepo(pool, mirror),
    notifications: new PgNotificationsRepo(pool, mirror),
  };
}

export const repos: Repositories = memoryRepositories();

export function installRepositories(next: Repositories) {
  Object.assign(repos, next);
}

/**
 * Collection names of the migrated data. They are the names the rows had in
 * the JSONB `documents` table, in foreign-key order (parents first), and the
 * names backups use, so existing backups restore unchanged.
 */
export const MIGRATED = [
  'members',
  'sessions',
  'tasks',
  'taskEvents',
  'taskComments',
  'collab_notifications',
] as const;
export type MigratedCollection = (typeof MIGRATED)[number];

/** Row-level access to one migrated collection, for backups and restores. */
export interface RelationalTable {
  name: MigratedCollection;
  entries(): Promise<[string, unknown][]>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}

/** The migrated collections as tables, parents first. */
export function relationalTables(): RelationalTable[] {
  const r = repos;
  return [
    {
      name: 'members',
      entries: async () => (await r.members.list()).map((m) => [m.id, m]),
      put: (_k, v) => r.members.put(v as Parameters<MembersRepo['put']>[0]),
      delete: (k) => r.members.delete(k),
    },
    {
      name: 'sessions',
      entries: async () => (await r.sessions.listAll(1_000_000_000)).map((s) => [s.id, s]),
      put: (_k, v) => r.sessions.put(v as Parameters<SessionStore['put']>[0]),
      delete: (k) => r.sessions.delete(k),
    },
    {
      name: 'tasks',
      entries: async () => (await r.tasks.list()).map((t) => [t.key, t]),
      put: (_k, v) => r.tasks.put(v as Parameters<TasksRepo['put']>[0]),
      delete: (k) => r.tasks.delete(k),
    },
    {
      name: 'taskEvents',
      entries: async () => (await r.taskEvents.list()).map((e) => [e.id, e]),
      put: (_k, v) => r.taskEvents.put(v as Parameters<TaskEventsRepo['put']>[0]),
      delete: (k) => r.taskEvents.delete(k),
    },
    {
      name: 'taskComments',
      entries: async () => (await r.taskComments.list()).map((c) => [c.id, c]),
      put: (_k, v) => r.taskComments.put(v as Parameters<TaskCommentsRepo['put']>[0]),
      delete: (k) => r.taskComments.delete(k),
    },
    {
      name: 'collab_notifications',
      entries: async () => (await r.notifications.list()).map((n) => [n.id, n]),
      put: (_k, v) => r.notifications.put(v as Parameters<NotificationsRepo['put']>[0]),
      delete: (k) => r.notifications.delete(k),
    },
  ];
}
