import type { EndpointDef } from '../types/console';

/** Numbered domains for the console's endpoint tree. Order is the reading order of the API. */
export const consoleDomains: { id: string; label: string; match: (e: EndpointDef) => boolean }[] = [
  { id: '01', label: 'Auth', match: (e) => e.path.startsWith('/api/auth') },
  {
    id: '02',
    label: 'Tasks',
    match: (e) =>
      e.path.startsWith('/api/tasks') ||
      e.path.startsWith('/api/team') ||
      e.path.startsWith('/api/projects'),
  },
  {
    id: '03',
    label: 'Deployments',
    match: (e) => e.path.startsWith('/api/deployments') || e.path.startsWith('/api/codespaces'),
  },
  { id: '04', label: 'Incidents', match: (e) => e.path.startsWith('/api/incidents') },
  {
    id: '05',
    label: 'Security',
    match: (e) => e.path.startsWith('/api/audit') || e.path.startsWith('/api/security'),
  },
  { id: '06', label: 'Locations', match: (e) => e.path.startsWith('/api/locations') },
  { id: '07', label: 'Analytics', match: () => true }, // system, metrics, query, logs — everything else
];

export function domainOf(e: EndpointDef) {
  return consoleDomains.find((d) => d.match(e))!;
}

/** Target environments for the request workbench. */
export const consoleEnvironments = [
  { id: 'local', label: 'Local', url: 'http://localhost:8080', tone: 'ok' as const },
  { id: 'staging', label: 'Staging', url: 'https://api.staging.devhq.app', tone: 'warn' as const },
  { id: 'production', label: 'Production', url: 'https://api.devhq.app', tone: 'bad' as const },
];

export type ConsoleEnvId = (typeof consoleEnvironments)[number]['id'];
