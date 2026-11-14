/**
 * Codespaces transports.
 *
 * - `backend`  — calls the TavetaHQ API (`/api/codespaces/*`), which proxies GitHub's REST API
 *                with the member's GitHub App user token. The browser never sees the token.
 * - `simulated` — an in-browser stand-in with the same lifecycle (create → provisioning →
 *                Available → idle Shutdown → start). Used in the preview, where no API runs.
 *
 * Both map failures to `CodespacesError` so the UI can choose between "Connect GitHub"
 * (auth) and falling back to the local sandbox (everything else).
 */
import { CodespacesError, type Codespace, type GitHubCodespaceState } from '../types/codespaces';
import { api, ApiError, isSameOrigin } from '../api/client';

export interface CodespacesTransport {
  kind: 'simulated' | 'backend';
  list(repo: string): Promise<Codespace[]>;
  get(name: string): Promise<Codespace>;
  create(repo: string, ref: string): Promise<Codespace>;
  start(name: string): Promise<Codespace>;
  stop(name: string): Promise<Codespace>;
  /** URL to open for one-click GitHub authorization. */
  authorizeUrl(): Promise<string | null>;
  /** Forwarded-port URL for the preview pane. */
  portUrl(cs: Codespace, port: number): string;
}

const TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// Backend transport
// ---------------------------------------------------------------------------

function toCodespacesError(e: unknown): CodespacesError {
  if (e instanceof DOMException && e.name === 'AbortError')
    return new CodespacesError(0, 'timeout', 'The TavetaHQ API took too long to answer');
  if (!(e instanceof ApiError))
    return new CodespacesError(0, 'network', 'Could not reach the TavetaHQ API');
  const kind =
    e.status === 0
      ? 'network'
      : e.status === 401 || e.code === 'github_auth'
        ? 'auth'
        : e.status === 429 || e.code === 'rate_limited'
          ? 'rate_limited'
          : e.status === 403
            ? 'forbidden'
            : e.status === 404
              ? 'not_found'
              : 'upstream';
  return new CodespacesError(e.status, kind, e.message);
}

/**
 * Talks to the TavetaHQ API through the shared client (same transport, error type,
 * session handling and step-up retry as the rest of the app). The session
 * cookie is same-origin only, so a configured base URL on another origin is
 * refused rather than sent credentials.
 */
export function backendTransport(baseUrl: string): CodespacesTransport {
  const base = baseUrl.replace(/\/$/, '');
  const prefix =
    base && isSameOrigin(base)
      ? new URL(base, window.location.href).pathname.replace(/\/$/, '')
      : null;
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (prefix === null)
      throw new CodespacesError(
        0,
        'forbidden',
        `Refusing to send TavetaHQ credentials to ${base || 'an empty URL'}: codespaces must be served from this origin.`,
      );
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await api<T>(`${prefix}${path}`, { method, body, signal: ctrl.signal });
    } catch (e) {
      throw toCodespacesError(e);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    kind: 'backend',
    list: (repo) => call<Codespace[]>('GET', `/api/codespaces?repo=${encodeURIComponent(repo)}`),
    get: (name) => call<Codespace>('GET', `/api/codespaces/${encodeURIComponent(name)}`),
    create: (repo, ref) => call<Codespace>('POST', '/api/codespaces', { repo, ref }),
    start: (name) => call<Codespace>('POST', `/api/codespaces/${encodeURIComponent(name)}/start`),
    stop: (name) => call<Codespace>('POST', `/api/codespaces/${encodeURIComponent(name)}/stop`),
    authorizeUrl: async () => (await call<{ url: string }>('GET', '/api/codespaces/oauth/url')).url,
    portUrl: (cs, port) => `https://${cs.name}-${port}.app.github.dev`,
  };
}

// ---------------------------------------------------------------------------
// Simulated transport
// ---------------------------------------------------------------------------

const SIM_KEY = 'devhq.codespaces.sim';
const IDLE_MS = 6 * 60_000; // sleeps after 6 minutes without a status check from an open tab

interface SimRecord extends Codespace {
  /** Epoch ms when a transitional state resolves. */
  readyAt?: number;
  lastPingAt: number;
}

function readSim(): SimRecord[] {
  try {
    return JSON.parse(sessionStorage.getItem(SIM_KEY) ?? '[]') as SimRecord[];
  } catch {
    return [];
  }
}
function writeSim(list: SimRecord[]) {
  sessionStorage.setItem(SIM_KEY, JSON.stringify(list));
}

/** Advance transitional states based on wall-clock time. */
function settle(r: SimRecord): SimRecord {
  const now = Date.now();
  if (
    (r.state === 'Provisioning' || r.state === 'Starting' || r.state === 'Queued') &&
    r.readyAt &&
    now >= r.readyAt
  ) {
    return {
      ...r,
      state: 'Available',
      readyAt: undefined,
      lastPingAt: now,
      last_used_at: new Date().toISOString(),
    };
  }
  if (r.state === 'ShuttingDown' && r.readyAt && now >= r.readyAt)
    return { ...r, state: 'Shutdown', readyAt: undefined };
  if (r.state === 'Available' && now - r.lastPingAt > IDLE_MS) return { ...r, state: 'Shutdown' };
  return r;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (repo: string) => repo.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

export function simulatedTransport(opts: { failWith?: CodespacesError } = {}): CodespacesTransport {
  const guard = async () => {
    await delay(280 + Math.random() * 240);
    if (opts.failWith) throw opts.failWith;
  };
  const update = (name: string, fn: (r: SimRecord) => SimRecord): SimRecord => {
    const list = readSim().map(settle);
    const i = list.findIndex((r) => r.name === name);
    if (i < 0) throw new CodespacesError(404, 'not_found', 'Codespace not found');
    list[i] = fn(list[i]);
    writeSim(list);
    return list[i];
  };
  const strip = ({ readyAt: _r, lastPingAt: _l, ...cs }: SimRecord): Codespace => cs;

  return {
    kind: 'simulated',
    async list(repo) {
      await guard();
      const list = readSim().map(settle);
      writeSim(list);
      return list.filter((r) => r.repository.full_name === repo).map(strip);
    },
    async get(name) {
      await guard();
      // A status check from an open tab counts as activity, like VS Code's heartbeat.
      return strip(
        update(name, (r) =>
          r.state === 'Available' ? { ...settle(r), lastPingAt: Date.now() } : settle(r),
        ),
      );
    },
    async create(repo, ref) {
      await guard();
      const name = `${slug(repo)}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const rec: SimRecord = {
        id: Date.now(),
        name,
        display_name: `${repo.split('/')[1]} · ${ref}`,
        state: 'Provisioning',
        web_url: `https://${name}.github.dev`,
        repository: { full_name: repo },
        git_status: { ref, ahead: 0, behind: 0, has_uncommitted_changes: false },
        machine: {
          name: 'basicLinux32gb',
          display_name: '2-core · 8 GB RAM · 32 GB',
          cpus: 2,
          memory_in_bytes: 8 * 1024 ** 3,
        },
        idle_timeout_minutes: IDLE_MS / 60_000,
        last_used_at: now,
        created_at: now,
        readyAt: Date.now() + 9_000,
        lastPingAt: Date.now(),
      };
      writeSim([...readSim(), rec]);
      return strip(rec);
    },
    async start(name) {
      await guard();
      return strip(
        update(name, (r) =>
          r.state === 'Shutdown' ? { ...r, state: 'Starting', readyAt: Date.now() + 4_500 } : r,
        ),
      );
    },
    async stop(name) {
      await guard();
      return strip(
        update(name, (r) => ({
          ...r,
          state: 'ShuttingDown' as GitHubCodespaceState,
          readyAt: Date.now() + 1_500,
        })),
      );
    },
    async authorizeUrl() {
      await delay(200);
      return null;
    },
    portUrl: (cs, port) => `https://${cs.name}-${port}.app.github.dev`,
  };
}

/** Wipe simulated codespaces (used by "Delete codespace"). */
export function resetSimulated(name?: string) {
  writeSim(name ? readSim().filter((r) => r.name !== name) : []);
}
