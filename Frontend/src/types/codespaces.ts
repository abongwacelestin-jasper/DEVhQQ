/** Subset of GitHub's Codespace resource that the workspace uses. */
export type GitHubCodespaceState =
  | 'Unknown'
  | 'Created'
  | 'Queued'
  | 'Provisioning'
  | 'Available'
  | 'Awaiting'
  | 'Unavailable'
  | 'Deleted'
  | 'Moved'
  | 'Shutdown'
  | 'Archived'
  | 'Starting'
  | 'ShuttingDown'
  | 'Failed'
  | 'Exporting'
  | 'Updating'
  | 'Rebuilding';

export interface Codespace {
  id: number;
  name: string;
  display_name?: string;
  state: GitHubCodespaceState;
  web_url: string;
  repository: { full_name: string };
  git_status?: { ref: string; ahead: number; behind: number; has_uncommitted_changes: boolean };
  machine?: { name: string; display_name: string; cpus: number; memory_in_bytes: number };
  idle_timeout_minutes?: number;
  last_used_at: string;
  created_at: string;
}

/** Lifecycle the workspace UI moves through. */
export type CodespacePhase =
  | 'checking' // GET /user/codespaces in flight
  | 'not-found' // nothing for this repo — about to create
  | 'provisioning' // POST /repos/{owner}/{repo}/codespaces, waiting for Available
  | 'starting' // POST /user/codespaces/{name}/start, waiting for Available
  | 'available' // web_url ready, iframe mounted
  | 'sleeping' // idle timeout put it to Shutdown — offer "Wake up"
  | 'auth-required' // GitHub rejected the token
  | 'failed'; // unrecoverable — caller falls back to the sandbox

export type CodespacesTransportKind = 'simulated' | 'backend';

/** Thrown by transports so the hook can tell auth failures from everything else. */
export class CodespacesError extends Error {
  constructor(
    public status: number,
    public code:
      'auth' | 'forbidden' | 'rate_limited' | 'not_found' | 'network' | 'timeout' | 'upstream',
    message: string,
  ) {
    super(message);
  }
}
