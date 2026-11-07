/**
 * Response shapes for the DevHQ API.
 *
 * These mirror `Backend/types.ts` and the route handlers — the browser and the
 * server must agree on names, so this file is deliberately dumb: types only,
 * no defaults, no fixtures.
 */

export type ApiRole =
  'Owner' | 'Project manager' | 'Developer' | 'Designer' | 'Tester' | 'Operations';
export type ApiProduct = 'renewberry' | 'blog' | 'mirror';
export type ApiMemberStatus = 'active' | 'invited' | 'deactivated';

/** Areas the server authorizes against. Distinct from the web app's page areas. */
export type ApiArea =
  | 'Organization'
  | 'Product'
  | 'Project'
  | 'Repository'
  | 'Deployment'
  | 'Infrastructure'
  | 'Administration';
export type ApiLevel = 'none' | 'view' | 'contribute' | 'manage' | 'admin';

/** Public projection of a member — never contains hashes, secrets or key material. */
export interface ApiMember {
  id: string;
  name: string;
  email: string;
  role: ApiRole;
  products: ApiProduct[];
  status: ApiMemberStatus;
  mfa?: boolean;
  passkeys?: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

/** Where a request appears to come from (server-side offline geo table). */
export interface ApiGeo {
  city: string;
  country: string;
  countryCode: string;
  region: string;
  network: 'residential' | 'office' | 'datacenter' | 'vpn' | 'tor' | 'loopback' | 'unknown';
}

/** One server session, as `GET /api/auth/session` and `/api/locations/sessions` list them. */
export interface ApiSessionView {
  /** First 8 characters of the session id — enough to revoke, never enough to use. */
  id: string;
  memberId: string;
  current: boolean;
  stage: 'password' | 'verified';
  method: 'password' | 'passkey';
  client: string;
  ip: string;
  location: ApiGeo;
  createdAt: string;
  lastSeenAt: string;
  stepUpRequired: boolean;
}

/** GET /api/auth/session */
export interface SessionResponse {
  member: ApiMember;
  stepUpRequired: boolean;
  elevations: string[];
  sessions?: ApiSessionView[];
  location?: ApiGeo;
}

/** GET /api/auth/pending — password step only, before the second factor */
export interface PendingResponse {
  member: ApiMember;
  methods: string[];
  /** The member has no second factor yet and must enroll one to finish signing in. */
  enrollRequired?: boolean;
}

/**
 * POST /api/auth/sign-in. Browser sessions are cookie-only: any `token` the
 * server might still include is ignored, never stored.
 */
export interface SignInResponse {
  next?: 'totp' | 'passkey' | 'enroll';
  methods?: string[];
  enrollRequired?: boolean;
  risk?: { reasons: string[] };
}

/** POST /api/auth/demo and POST /api/auth/mfa/totp */
export interface AuthenticatedResponse {
  ok: boolean;
  member?: ApiMember;
}

/** POST /api/auth/step-up */
export interface StepUpResponse {
  ok: boolean;
  verifiedFor?: string;
}

/** POST /api/auth/webauthn/options and /api/auth/passkeys/options (all binary fields base64url). */
export interface WebAuthnOptions {
  challengeId: string;
  publicKey: {
    challenge: string;
    rpId: string;
    rp: { id: string; name: string };
    timeout: number;
    userVerification: 'required' | 'preferred' | 'discouraged';
    pubKeyCredParams: { type: 'public-key'; alg: number }[];
    attestation: 'none' | 'indirect' | 'direct' | 'enterprise';
    allowCredentials?: { type: 'public-key'; id: string }[];
  };
}

export interface PasskeyRegistrationOptions extends WebAuthnOptions {
  user: { id: string; name: string; displayName: string };
  excludeCredentials: { type: 'public-key'; id: string }[];
}

/** A registered passkey (POST /api/auth/passkeys, GET /api/auth/passkeys). */
export interface ApiPasskey {
  id: string;
  label: string;
  createdAt: string;
}

/** GET /api/onboarding — the server is the authority for the NDA and profile stages. */
export interface OnboardingState {
  stage: 'nda' | 'profile' | 'ready';
  nda?: { version: string; signedName: string; signedAt: string } | null;
  profile?: OnboardingProfile | null;
}

export interface OnboardingProfile {
  displayName: string;
  timezone: string;
  hoursFrom: string;
  hoursTo: string;
  skills: string[];
  notify: string[];
}

/** GET /api/tokens — personal access tokens; the secret itself is never listed. */
export interface ApiAccessToken {
  id: string;
  name: string;
  /** Leading characters of the secret, for recognition only. */
  prefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

/** POST /api/tokens — the only response that ever carries the secret. */
export interface CreatedAccessToken extends ApiAccessToken {
  token: string;
}

/** POST /api/auth/totp/enroll */
export interface TotpEnrollment {
  otpauthUri: string;
  secret: string;
  /** When the server discards an unconfirmed enrollment (sign-in enrollment only). */
  expiresAt?: string;
}

/** GET /api/locations/sign-ins */
export interface ApiSignIn {
  id: string;
  memberId: string;
  at: string;
  ip: string;
  method: 'password' | 'passkey' | 'demo';
  result: 'success' | 'failed' | 'blocked' | 'challenged';
  location: ApiGeo;
  risk: { score: number; reasons: string[] };
}

/** GET /api/me/capabilities */
export interface Capabilities {
  role: ApiRole;
  products: ApiProduct[];
  matrix: Record<ApiArea, ApiLevel>;
  levels: ApiLevel[];
  verifiedAt: number;
  elevations: string[];
}

/** GET /api/products */
export interface ApiProductSummary {
  id: ApiProduct;
  code: string;
  name: string;
  projects: number;
  openTasks: number;
  lateTasks: number;
  members: number;
}

/** GET /api/scope */
export interface ApiProject {
  id: string;
  product: ApiProduct;
  name: string;
  lead: string;
  status: 'on-track' | 'at-risk' | 'blocked' | 'planned';
}

export interface ScopeResponse {
  products: ApiProductSummary[];
  projects: ApiProject[];
}

/** GET /api/tasks */
export interface ApiTask {
  key: string;
  title: string;
  product: ApiProduct;
  projectId: string;
  type: 'feature' | 'bug' | 'design' | 'task';
  status: 'backlog' | 'in-progress' | 'review' | 'done';
  priority: 'urgent' | 'high' | 'medium' | 'low';
  assignee: string;
  reviewer?: string;
  /** ISO date, YYYY-MM-DD. */
  due: string;
  estimate: number;
  description?: string;
  pr?: number;
  blockedBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  comments: number;
  overdue: boolean;
}

export interface TaskListResponse {
  total: number;
  limit: number;
  offset: number;
  items: ApiTask[];
}

export interface ApiTaskEvent {
  id: string;
  taskKey: string;
  actor: string;
  at: string;
  kind:
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
  from?: string;
  to?: string;
  note?: string;
}

export interface ApiTaskComment {
  id: string;
  taskKey: string;
  author: string;
  text: string;
  at: string;
}

export interface ApiSubtask {
  id: string;
  taskKey: string;
  title: string;
  done: boolean;
  doneBy?: string;
  doneAt?: string;
}

export interface ApiTimeLog {
  id: string;
  taskKey: string;
  member: string;
  minutes: number;
  at: string;
  note?: string;
}

/** GET /api/tasks/_activity */
export interface TaskActivityResponse {
  events: ApiTaskEvent[];
  comments: ApiTaskComment[];
  subtasks: ApiSubtask[];
  timeLogs: ApiTimeLog[];
}

/** GET /api/docs — metadata only, without the markdown body. */
export interface ApiDoc {
  id: string;
  projectId: string;
  product: ApiProduct;
  title: string;
  kind: 'spec' | 'runbook' | 'meeting' | 'decision' | 'guide' | 'handover';
  status: 'draft' | 'in-review' | 'published';
  visibility: 'project' | 'workspace' | 'restricted';
  editors: string[];
  updatedBy: string;
  updatedAt: string;
}

/** GET /api/docs/:docId */
export interface ApiDocDetail extends ApiDoc {
  body: string;
}

/** GET /api/deployments */
export interface ApiDeployment {
  id: string;
  product: ApiProduct;
  env: 'staging' | 'production';
  version: string;
  sha: string;
  status: 'running' | 'succeeded' | 'failed' | 'awaiting-approval' | 'rolled-back';
  provider: string;
  requestedBy: string;
  approvedBy?: string;
  createdAt: string;
}

/** GET /api/incidents */
export interface ApiIncident {
  id: string;
  product: ApiProduct;
  title: string;
  severity: 'SEV1' | 'SEV2' | 'SEV3';
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  owner: string;
  service: string;
  impact: string;
  startedAt: string;
  resolvedAt?: string;
  timeline: { at: string; by: string; note: string }[];
  /** Not-done recovery steps and follow-ups (list endpoint only). */
  openActions?: number;
}

/** GET /api/incidents/:id/actions — a recovery step or follow-up action item. */
export interface ApiIncidentAction {
  id: string;
  incidentId: string;
  title: string;
  detail: string | null;
  owner: string;
  /** `YYYY-MM-DD`, or null. */
  due: string | null;
  status: 'open' | 'in-progress' | 'done';
  kind: 'mitigation' | 'follow-up';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
}

/** GET /api/team/roles — role × area permission matrix, owned by the server. */
export type ApiPermissionMatrix = Record<ApiArea, Record<ApiRole, ApiLevel>>;

export type ApiGrantStatus = 'pending' | 'active' | 'expired' | 'revoked' | 'denied';

/** GET /api/access/grants — just-in-time production access. */
export interface ApiGrant {
  id: string;
  memberId: string;
  /** e.g. "production:renewberry" */
  scope: string;
  reason: string;
  requestedAt: number;
  durationMs: number;
  status: ApiGrantStatus;
  approvedBy?: string;
  expiresAt?: number;
}

/** GET /api/audit */
export interface ApiAuditEntry {
  seq: number;
  at: string;
  actor: string;
  action: string;
  target: string;
  sensitive: boolean;
  requestId?: string;
}

/** GET /api/auth/demo-accounts (public, non-production only) */
export interface DemoAccountsResponse {
  enabled: boolean;
  password?: string;
  mfaCode?: string;
  accounts: {
    key: string;
    label: string;
    memberId: string;
    name: string;
    email: string;
    role: ApiRole;
  }[];
}
