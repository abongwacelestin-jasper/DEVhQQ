import { pathParamDefaults, queryHints } from '../data/consoleEndpoints';
import type { EndpointDef, RequestDraft } from '../types/console';

/** Turns an endpoint definition into an editable request with sample params and body. */
export function draftFromEndpoint(ep: EndpointDef): RequestDraft {
  return {
    method: ep.method,
    path: ep.path.replace(/:([a-zA-Z]+)/g, (_m, k: string) => pathParamDefaults[k] ?? k),
    params: (queryHints[ep.path] ?? []).map(([key, value]) => ({ key, value, on: value !== '' })),
    headers: [],
    body: ep.example ? JSON.stringify(ep.example, null, 2) : '',
  };
}

export function buildUrl(d: RequestDraft): string {
  const qs = d.params
    .filter((p) => p.on && p.key)
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&');
  return d.path + (qs ? (d.path.includes('?') ? '&' : '?') + qs : '');
}

export const methodHasBody = (m: string) => m !== 'GET' && m !== 'DELETE';
