/**
 * What a backup contains, and how a restore writes it back.
 *
 * Primary source: every collection in the persistence registry
 * (`registeredCollections()` from store/collection.ts). Rows are read and
 * restored through the Collection itself, so restored rows are persisted by
 * whatever driver is installed (Postgres in production).
 *
 * The registry only exposes names. To reach the instances we look for a
 * `getCollection(name)` export on store/collection.ts (requested from B-DATA /
 * the coordinator — see the STORAGE handoff); until it exists, modules can
 * hand their collection over with `registerBackupTable` (files.routes does).
 * Any registered name we still can't reach is reported as `uncovered` in the
 * manifest instead of being silently skipped.
 *
 * Relational source (ADR 0011): the migrated collections (members, sessions,
 * tasks, task events and comments, notifications) are tables now, read and
 * written through their repositories under their old collection names, so
 * backups taken before and after the migration restore the same way. A
 * restore removes rows children-first and writes rows parents-first, so the
 * foreign keys hold at every step.
 *
 * Legacy source: the pre-Wave-4 `db.*` Maps (store/db.ts `snapshot()`), kept
 * so nothing regresses while B-DATA converts them. Legacy tables are backed
 * up and diffed by a dry run but are only restorable once they are
 * collections.
 */

import * as collectionModule from '../store/collection.ts';
import { snapshot as legacySnapshot } from '../store/db.ts';
import { MIGRATED, relationalTables, type RelationalTable } from '../data/index.ts';

export type Table = Map<string, unknown>;

const explicit = new Map<string, Table>();

/** Lets a module put its collection (or any keyed Map) under backup/restore. */
export function registerBackupTable(name: string, table: Table) {
  explicit.set(name, table);
}

function fromRegistry(name: string): Table | undefined {
  const mod: Record<string, unknown> = { ...collectionModule };
  const getter = mod.getCollection;
  if (typeof getter !== 'function') return undefined;
  const found: unknown = getter(name);
  return found instanceof Map ? (found as Table) : undefined;
}

export function resolveTable(name: string): Table | undefined {
  return fromRegistry(name) ?? explicit.get(name);
}

export interface SnapshotBody {
  version: 2;
  id: string;
  createdAt: string;
  /** name → [key, row][] */
  collections: Record<string, [string, unknown][]>;
  /** Legacy db.* tables not (yet) collections: name → rows. */
  legacy: Record<string, unknown[]>;
  /** Registered collection names whose rows could not be reached. */
  uncovered: string[];
}

function relational(): Map<string, RelationalTable> {
  return new Map(relationalTables().map((t) => [t.name, t]));
}

/** Current rows of one table (collection or relational), or undefined if unreachable. */
async function currentRows(
  name: string,
  rel: Map<string, RelationalTable>,
): Promise<Map<string, unknown> | undefined> {
  const r = rel.get(name);
  if (r) return new Map(await r.entries());
  return resolveTable(name);
}

export async function takeSnapshot(id: string, createdAt: string): Promise<SnapshotBody> {
  const rel = relational();
  const names = new Set([
    ...collectionModule.registeredCollections(),
    ...explicit.keys(),
    ...MIGRATED,
  ]);
  const collections: SnapshotBody['collections'] = {};
  const uncovered: string[] = [];
  for (const name of [...names].sort()) {
    const t = await currentRows(name, rel);
    if (t) collections[name] = [...t.entries()];
    else uncovered.push(name);
  }
  const legacy: SnapshotBody['legacy'] = {};
  for (const [name, rows] of Object.entries(legacySnapshot()))
    if (!(name in collections)) legacy[name] = rows;
  return { version: 2, id, createdAt, collections, legacy, uncovered };
}

export interface TablePlan {
  name: string;
  restorable: boolean;
  inBackup: number;
  current: number;
  add: number;
  update: number;
  remove: number;
  unchanged: number;
}

export async function planRestore(snap: SnapshotBody): Promise<TablePlan[]> {
  const rel = relational();
  const plans: TablePlan[] = [];
  for (const [name, rows] of Object.entries(snap.collections)) {
    const t = await currentRows(name, rel);
    const wanted = new Map(rows);
    let add = 0;
    let update = 0;
    let unchanged = 0;
    for (const [k, v] of wanted) {
      if (!t?.has(k)) add++;
      else if (JSON.stringify(t.get(k)) !== JSON.stringify(v)) update++;
      else unchanged++;
    }
    const remove = t ? [...t.keys()].filter((k) => !wanted.has(k)).length : 0;
    plans.push({
      name,
      restorable: !!t,
      inBackup: wanted.size,
      current: t?.size ?? 0,
      add,
      update,
      remove,
      unchanged,
    });
  }
  const live = legacySnapshot() as Record<string, unknown[]>;
  for (const [name, rows] of Object.entries(snap.legacy)) {
    plans.push({
      name,
      restorable: false,
      inBackup: rows.length,
      current: live[name]?.length ?? 0,
      add: 0,
      update: 0,
      remove: 0,
      unchanged: 0,
    });
  }
  return plans;
}

/**
 * Writes the snapshot back. Collections go through `set`/`delete`, so the
 * persistence driver records the change; relational tables go through their
 * repositories (deletes children-first, writes parents-first).
 */
export async function applyRestore(
  snap: SnapshotBody,
  only?: string[],
): Promise<Record<string, number>> {
  const changed: Record<string, number> = {};
  const picked = (name: string) => name in snap.collections && (!only || only.includes(name));

  const rel = relationalTables().filter((t) => picked(t.name));
  const current = new Map<string, Map<string, unknown>>();
  for (const t of rel) current.set(t.name, new Map(await t.entries()));
  for (const t of [...rel].reverse()) {
    const wanted = new Map(snap.collections[t.name]);
    let n = 0;
    for (const k of current.get(t.name)!.keys())
      if (!wanted.has(k) && (await t.delete(k))) n++;
    changed[t.name] = n;
  }
  for (const t of rel) {
    const now = current.get(t.name)!;
    let n = changed[t.name] ?? 0;
    for (const [k, v] of snap.collections[t.name])
      if (JSON.stringify(now.get(k)) !== JSON.stringify(v)) {
        await t.put(k, v);
        n++;
      }
    changed[t.name] = n;
  }

  const relNames = new Set<string>(MIGRATED);
  for (const [name, rows] of Object.entries(snap.collections)) {
    if (relNames.has(name) || (only && !only.includes(name))) continue;
    const t = resolveTable(name);
    if (!t) continue;
    const wanted = new Map(rows);
    let n = 0;
    for (const k of [...t.keys()])
      if (!wanted.has(k)) {
        t.delete(k);
        n++;
      }
    for (const [k, v] of wanted)
      if (JSON.stringify(t.get(k)) !== JSON.stringify(v)) {
        t.set(k, v);
        n++;
      }
    changed[name] = n;
  }
  return changed;
}
