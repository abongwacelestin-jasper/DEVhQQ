/**
 * Incident recovery steps and follow-up action items.
 *
 * Kept in their own collection (not inside the Incident row) so the incident
 * routes and the monitor scheduler stay untouched, and so a busy incident's
 * action list is not rewritten every time a timeline note is added.
 */

import { createCollection } from '../../store/collection.ts';

export const ACTION_STATUSES = ['open', 'in-progress', 'done'] as const;
export const ACTION_KINDS = ['mitigation', 'follow-up'] as const;
/** Upper bound per incident, so one incident cannot grow without limit. */
export const MAX_ACTIONS_PER_INCIDENT = 100;

export type ActionStatus = (typeof ACTION_STATUSES)[number];
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface IncidentAction {
  id: string;
  incidentId: string;
  title: string;
  detail: string | null;
  /** Member id of whoever is responsible for the step. */
  owner: string;
  /** Calendar date (`YYYY-MM-DD`), or null when there is no due date. */
  due: string | null;
  status: ActionStatus;
  kind: ActionKind;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Set when the step is marked done; cleared when it is reopened. */
  doneAt: string | null;
}

export const incidentActions = createCollection<IncidentAction>('incident_actions');

/** Actions of one incident, oldest first. */
export function actionsOf(incidentId: string): IncidentAction[] {
  return [...incidentActions.values()]
    .filter((a) => a.incidentId === incidentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Not-done action count per incident id, in one pass over the collection. */
export function openActionCounts(): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of incidentActions.values())
    if (a.status !== 'done') out.set(a.incidentId, (out.get(a.incidentId) ?? 0) + 1);
  return out;
}
