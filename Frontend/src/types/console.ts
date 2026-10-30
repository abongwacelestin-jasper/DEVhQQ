export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type EndpointAuth = 'public' | 'session' | 'partial';
export type ConnectionMode = 'preview' | 'live';

export interface EndpointDef {
  method: HttpMethod;
  path: string;
  summary: string;
  tag: string;
  auth: EndpointAuth;
  codes: number[];
  query?: string[];
  example?: unknown;
}

export interface KeyValue {
  key: string;
  value: string;
  on: boolean;
}

export interface RequestDraft {
  method: HttpMethod;
  path: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: string;
}

export interface ConsoleResponse {
  status: number;
  ms: number;
  size: number;
  headers: [string, string][];
  body: unknown;
  text: string;
  at: number;
}

export interface HistoryEntry {
  id: string;
  method: HttpMethod;
  url: string;
  body: string;
  status: number;
  ms: number;
  at: number;
}

export interface ConsoleMember {
  id: string;
  name: string;
  email: string;
  role: string;
  products: string[];
}

export interface ConsoleSession {
  token: string;
  member: ConsoleMember;
  method: 'password' | 'demo';
  startedAt: number;
}

export interface GeoLocation {
  city: string;
  country: string;
  countryCode: string;
  network: 'residential' | 'mobile' | 'business' | 'datacenter' | 'vpn' | 'tor' | 'private';
}

export interface SignInRow {
  id: string;
  memberId: string;
  ip: string;
  at: string;
  result: 'success' | 'challenged' | 'failed' | 'blocked';
  location: GeoLocation;
  risk: { score: number; reasons: string[] };
}

export interface AuditRow {
  seq: number;
  at: string;
  actor: string;
  action: string;
  target: string;
  sensitive: boolean;
  hash: string;
}

export interface RouteMetric {
  route: string;
  count: number;
  p50: number;
  p95: number;
  statuses: Record<string, number>;
}

export interface ConsoleMetrics {
  uptimeSec: number;
  totalRequests: number;
  statuses: Record<string, number>;
  routes: RouteMetric[];
  memoryMb: { heapUsed: number; rss: number };
  sessions: { active: number };
  audit: { entries: number; chain: 'intact' | 'broken' };
}
