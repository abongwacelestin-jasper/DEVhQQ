/**
 * Ask DevHQ — presentation data and the response contract.
 *
 * Answers come only from `POST /api/assistant/ask` (ML lane). There is no
 * local answer engine: when the ML service is down the panel says so.
 */

/** Starting points shown under the input. They are questions, not answers. */
export const suggestedPrompts: readonly string[] = [
  'What is blocking the next release?',
  'Who is overloaded right now?',
  'Summarize this week’s incidents',
  'Which tasks are at risk of slipping?',
];

export type AssistantSourceKind =
  'doc' | 'task' | 'incident' | 'deployment' | 'pull' | 'member' | 'monitor';

/** One cited record. `url` is optional; the UI builds the route from kind + id. */
export interface AssistantSource {
  kind: AssistantSourceKind | (string & {});
  id: string;
  title: string;
  url?: string;
}

/** `POST /api/assistant/ask` → this (and the final `done` event of the stream variant). */
export interface AssistantAnswer {
  answer: string;
  sources: AssistantSource[];
  /** Model label, e.g. `claude-sonnet-5-5`, or the heuristic's name. */
  model: string;
  source?: 'model' | 'heuristic' | 'demo';
}

const routes: Record<string, (id: string) => string> = {
  doc: (id) => `/docs/${encodeURIComponent(id)}`,
  task: (id) => `/tasks/${encodeURIComponent(id)}`,
  incident: (id) => `/incidents/${encodeURIComponent(id)}`,
  deployment: (id) => `/deployments/${encodeURIComponent(id)}`,
  pull: (id) => `/pull-requests/${encodeURIComponent(id)}`,
  member: (id) => `/team/${encodeURIComponent(id)}`,
  monitor: () => '/monitors',
};

export const sourceKindLabel: Record<string, string> = {
  doc: 'Doc',
  task: 'Task',
  incident: 'Incident',
  deployment: 'Deploy',
  pull: 'PR',
  member: 'Person',
  monitor: 'Monitor',
};

/** In-app route for a cited record, or null when the kind has no page. */
export function sourceRoute(s: AssistantSource): string | null {
  if (s.url && s.url.startsWith('/') && !s.url.startsWith('//')) return s.url;
  const r = routes[s.kind];
  return r ? r(s.id) : null;
}
