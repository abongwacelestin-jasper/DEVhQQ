/**
 * Shared domain types for the API.
 * These mirror the frontend types (types/team.ts, types/work.ts, types/docs.ts)
 * so the web app can consume responses without translation.
 */

export type ProductId = 'renewberry' | 'blog' | 'mirror';
export type RoleName =
  'Owner' | 'Project manager' | 'Developer' | 'Designer' | 'Tester' | 'Operations';
export type PermissionArea =
  | 'Organization'
  | 'Product'
  | 'Project'
  | 'Repository'
  | 'Deployment'
  | 'Infrastructure'
  | 'Administration';
export type PermissionLevel = 'admin' | 'manage' | 'contribute' | 'view' | 'none';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: RoleName;
  products: ProductId[];
  status: 'active' | 'invited' | 'deactivated';
  /** scrypt hash in the format produced by security/crypto.ts → hashPassword. */
  passwordHash: string;
  /** Base32 TOTP secret, encrypted at rest in a real deployment. */
  totpSecret?: string;
  passkeys: PasskeyCredential[];
  failedLogins: number;
  lockedUntil?: number;
  /** SHA-256 of the single-use invite token. The raw token is only ever returned to the inviter. */
  inviteTokenHash?: string;
  /** Epoch ms after which the invite link stops working. */
  inviteExpiresAt?: number;
  /** Onboarding: when the member signed the NDA version in `ndaVersion` (full record in domain/collab). */
  ndaSignedAt?: string;
  ndaVersion?: string;
  /** Onboarding profile — required before a member who needs onboarding reaches the `ready` stage. */
  profile?: {
    displayName: string;
    timezone: string;
    hoursFrom: string;
    hoursTo: string;
    skills: string[];
    notify: string[];
    completedAt: string;
  };
  /** Offboarding summary; the checklist lives in domain/collab. */
  offboarding?: {
    id: string;
    status: 'pending' | 'accepted' | 'withdrawn' | 'completed';
    startedAt: string;
    completedAt?: string;
  };
}

export interface PasskeyCredential {
  /** base64url credential ID. */
  id: string;
  /** DER-encoded SubjectPublicKeyInfo (base64url), from AuthenticatorAttestationResponse.getPublicKey(). */
  publicKey: string;
  /** COSE algorithm identifier, e.g. -7 for ES256. */
  algorithm: number;
  signCount: number;
  createdAt: string;
  label: string;
}

export interface Project {
  id: string;
  product: ProductId;
  name: string;
  lead: string;
  status: 'on-track' | 'at-risk' | 'blocked' | 'planned';
}

export interface ProjectDoc {
  id: string;
  projectId: string;
  product: ProductId;
  title: string;
  kind: 'spec' | 'runbook' | 'meeting' | 'decision' | 'guide' | 'handover';
  status: 'draft' | 'in-review' | 'published';
  visibility: 'project' | 'workspace' | 'restricted';
  body: string;
  editors: string[];
  updatedBy: string;
  updatedAt: string;
}

/** The authenticated principal attached to every request after authentication. */
export interface Principal {
  memberId: string;
  role: RoleName;
  products: ProductId[];
  sessionId: string;
  /** Timestamp of the last strong (MFA/passkey) verification — used for step-up checks. */
  verifiedAt: number;
  /** Active just-in-time elevations, e.g. "production:renewberry". */
  elevations: string[];
}

export type TaskStatus = 'backlog' | 'in-progress' | 'review' | 'done';
export type Priority = 'urgent' | 'high' | 'medium' | 'low';

export interface Task {
  key: string;
  title: string;
  product: ProductId;
  projectId: string;
  type: 'feature' | 'bug' | 'design' | 'task';
  status: TaskStatus;
  priority: Priority;
  assignee: string;
  reviewer?: string;
  due: string;
  estimate: number;
  description?: string;
  /** Linked pull request, when the GitHub App matched a branch name. */
  pr?: number;
  /** Task that must finish first. */
  blockedBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type TaskEventKind =
  | 'created'
  | 'status'
  | 'assignee'
  | 'reviewer'
  | 'priority'
  | 'due'
  | 'estimate'
  | 'comment'
  | 'subtask'
  | 'time'
  | 'linked';

/** Every change to a task is recorded as an immutable event: who, what, when. */
export interface TaskEvent {
  id: string;
  taskKey: string;
  actor: string;
  at: string;
  kind: TaskEventKind;
  from?: string;
  to?: string;
  note?: string;
}

export interface Subtask {
  id: string;
  taskKey: string;
  title: string;
  done: boolean;
  doneBy?: string;
  doneAt?: string;
}

export interface TimeLog {
  id: string;
  taskKey: string;
  member: string;
  minutes: number;
  at: string;
  note?: string;
}

export interface TaskComment {
  id: string;
  taskKey: string;
  author: string;
  text: string;
  at: string;
}

export interface Deployment {
  id: string;
  product: ProductId;
  env: 'staging' | 'production';
  version: string;
  sha: string;
  status: 'running' | 'succeeded' | 'failed' | 'awaiting-approval' | 'rolled-back';
  /** CI/CD system that executes the deploy — DevHQ only records and approves. */
  provider: string;
  requestedBy: string;
  approvedBy?: string;
  createdAt: string;
}

export interface Incident {
  id: string;
  product: ProductId;
  title: string;
  severity: 'SEV1' | 'SEV2' | 'SEV3';
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  owner: string;
  /** Service or endpoint affected, e.g. "renewberry-api". */
  service: string;
  /** One line on who or what is affected — the first thing a responder needs. */
  impact: string;
  startedAt: string;
  resolvedAt?: string;
  timeline: { at: string; by: string; note: string }[];
}

export interface GeoLocation {
  city: string;
  country: string;
  countryCode: string;
  region: string;
  lat: number;
  lon: number;
  network: 'residential' | 'office' | 'datacenter' | 'vpn' | 'tor' | 'loopback' | 'unknown';
}

export interface SignInRecord {
  id: string;
  memberId: string;
  at: string;
  ip: string;
  method: 'password' | 'passkey' | 'demo';
  result: 'success' | 'failed' | 'blocked' | 'challenged';
  location: GeoLocation;
  risk: { score: number; reasons: string[] };
}

/**
 * Error carrying an HTTP status and a stable machine-readable code.
 *
 * Fields are assigned explicitly rather than declared as constructor
 * parameter properties: Node's strip-only type stripping (node
 * --experimental-strip-types) rejects parameter properties, and this server
 * runs with no build step.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
