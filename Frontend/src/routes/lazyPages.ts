/**
 * Every routed page as a lazily loaded chunk, plus prefetching.
 *
 * The entry bundle holds the providers, the auth screens and the app shell; each
 * page below is its own chunk, fetched the first time its route renders, or
 * earlier: `prefetchPath()` runs when a link is hovered or focused
 * (`useLinkPrefetch`) and for the route a signed-in role lands on.
 *
 * App.tsx keeps its route tree; it imports these components instead of the page
 * modules. A new page needs an entry in `pages` and a pattern in `prefetchRoutes`.
 */
import { lazy, type ComponentType } from 'react';
import { matchPath } from 'react-router-dom';

type Loader = () => Promise<unknown>;

const RELOAD_KEY = 'devhq.chunk-reload';

/**
 * A chunk that fails to load right after a deploy is usually a file the new build
 * replaced (hashed names change). Reload once to pick up the new shell; a second
 * failure within a minute is a real outage and goes to the error UI.
 */
function reloadForNewBuild(error: unknown): never {
  const stale =
    error instanceof Error &&
    /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(
      error.message,
    );
  if (stale && typeof window !== 'undefined') {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
      if (Date.now() - last > 60_000) sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      /* storage unavailable: still reload once per page life */
    }
    if (Date.now() - last > 60_000) window.location.reload();
  }
  throw error;
}

/** One import per module: concurrent prefetches and renders share it; a failure can be retried. */
function once<M>(load: () => Promise<M>): () => Promise<M> {
  let pending: Promise<M> | null = null;
  return () =>
    (pending ??= load().catch((e: unknown) => {
      pending = null;
      throw e;
    }));
}

interface LazyPage {
  Component: ComponentType;
  preload: Loader;
}

/** A named page export as a lazy component with a shared preload. */
function page<K extends string, M extends Record<K, ComponentType>>(
  load: () => Promise<M>,
  name: K,
): LazyPage {
  const preload = once(load);
  return {
    // Only a render reloads on a stale chunk; a failed prefetch is ignored and retried later.
    Component: lazy<ComponentType>(() =>
      preload().then((m) => ({ default: m[name] }), reloadForNewBuild),
    ),
    preload,
  };
}

const pages = {
  Overview: page(() => import('../pages/Overview'), 'Overview'),
  MyWork: page(() => import('../pages/MyWork'), 'MyWork'),
  AssignedToMe: page(() => import('../pages/AssignedToMe'), 'AssignedToMe'),
  TestQueue: page(() => import('../pages/TestQueue'), 'TestQueue'),
  Messages: page(() => import('../pages/Messages'), 'Messages'),
  Docs: page(() => import('../pages/Docs'), 'Docs'),
  CodeSecurity: page(() => import('../pages/CodeSecurity'), 'CodeSecurity'),
  DevTools: page(() => import('../pages/DevTools'), 'DevTools'),
  Projects: page(() => import('../pages/Projects'), 'Projects'),
  ProjectDetail: page(() => import('../pages/ProjectDetail'), 'ProjectDetail'),
  TaskDetail: page(() => import('../pages/TaskDetail'), 'TaskDetail'),
  Assignments: page(() => import('../pages/Assignments'), 'Assignments'),
  WorkActivity: page(() => import('../pages/WorkActivity'), 'WorkActivity'),
  Workspaces: page(() => import('../pages/Workspaces'), 'Workspaces'),
  Repositories: page(() => import('../pages/Repositories'), 'Repositories'),
  RepositoryDetail: page(() => import('../pages/RepositoryDetail'), 'RepositoryDetail'),
  PullRequests: page(() => import('../pages/PullRequests'), 'PullRequests'),
  PullRequestDetail: page(() => import('../pages/PullRequestDetail'), 'PullRequestDetail'),
  Deployments: page(() => import('../pages/Deployments'), 'Deployments'),
  DeploymentDetail: page(() => import('../pages/DeploymentDetail'), 'DeploymentDetail'),
  Incidents: page(() => import('../pages/Incidents'), 'Incidents'),
  IncidentDetail: page(() => import('../pages/IncidentDetail'), 'IncidentDetail'),
  Monitors: page(() => import('../pages/Monitors'), 'Monitors'),
  Team: page(() => import('../pages/Team'), 'Team'),
  MemberDetail: page(() => import('../pages/MemberDetail'), 'MemberDetail'),
  SecurityCenter: page(() => import('../pages/SecurityCenter'), 'SecurityCenter'),
  Settings: page(() => import('../pages/Settings'), 'Settings'),
  Sessions: page(() => import('../pages/Sessions'), 'Sessions'),
  Integrations: page(() => import('../pages/Integrations'), 'Integrations'),
  IntegrationDetail: page(() => import('../pages/IntegrationDetail'), 'IntegrationDetail'),
  AuditLog: page(() => import('../pages/AuditLog'), 'AuditLog'),
  PageNotFound: page(() => import('../pages/PageNotFound'), 'PageNotFound'),
  ProductLayout: page(() => import('../pages/product/ProductLayout'), 'ProductLayout'),
  ProductOverview: page(() => import('../pages/product/ProductOverview'), 'ProductOverview'),
  ProductWork: page(() => import('../pages/product/ProductWork'), 'ProductWork'),
  ProductCode: page(() => import('../pages/product/ProductCode'), 'ProductCode'),
  ProductDeployments: page(
    () => import('../pages/product/ProductDeployments'),
    'ProductDeployments',
  ),
  ProductIncidents: page(() => import('../pages/product/ProductIncidents'), 'ProductIncidents'),
  ProductAnalytics: page(() => import('../pages/product/ProductAnalytics'), 'ProductAnalytics'),
  ProductPeople: page(() => import('../pages/product/ProductPeople'), 'ProductPeople'),
  CodeWorkspace: page(() => import('../pages/CodeWorkspace'), 'CodeWorkspace'),
  ConsoleApp: page(() => import('../pages/console/ConsoleApp'), 'ConsoleApp'),
  NdaSign: page(() => import('../pages/auth/NdaSign'), 'NdaSign'),
  CompleteProfile: page(() => import('../pages/auth/CompleteProfile'), 'CompleteProfile'),
} satisfies Record<string, LazyPage>;

export const Overview = pages.Overview.Component;
export const MyWork = pages.MyWork.Component;
export const AssignedToMe = pages.AssignedToMe.Component;
export const TestQueue = pages.TestQueue.Component;
export const Messages = pages.Messages.Component;
export const Docs = pages.Docs.Component;
export const CodeSecurity = pages.CodeSecurity.Component;
export const DevTools = pages.DevTools.Component;
export const Projects = pages.Projects.Component;
export const ProjectDetail = pages.ProjectDetail.Component;
export const TaskDetail = pages.TaskDetail.Component;
export const Assignments = pages.Assignments.Component;
export const WorkActivity = pages.WorkActivity.Component;
export const Workspaces = pages.Workspaces.Component;
export const Repositories = pages.Repositories.Component;
export const RepositoryDetail = pages.RepositoryDetail.Component;
export const PullRequests = pages.PullRequests.Component;
export const PullRequestDetail = pages.PullRequestDetail.Component;
export const Deployments = pages.Deployments.Component;
export const DeploymentDetail = pages.DeploymentDetail.Component;
export const Incidents = pages.Incidents.Component;
export const IncidentDetail = pages.IncidentDetail.Component;
export const Monitors = pages.Monitors.Component;
export const Team = pages.Team.Component;
export const MemberDetail = pages.MemberDetail.Component;
export const SecurityCenter = pages.SecurityCenter.Component;
export const Settings = pages.Settings.Component;
export const Sessions = pages.Sessions.Component;
export const Integrations = pages.Integrations.Component;
export const IntegrationDetail = pages.IntegrationDetail.Component;
export const AuditLog = pages.AuditLog.Component;
export const PageNotFound = pages.PageNotFound.Component;
export const ProductLayout = pages.ProductLayout.Component;
export const ProductOverview = pages.ProductOverview.Component;
export const ProductWork = pages.ProductWork.Component;
export const ProductCode = pages.ProductCode.Component;
export const ProductDeployments = pages.ProductDeployments.Component;
export const ProductIncidents = pages.ProductIncidents.Component;
export const ProductAnalytics = pages.ProductAnalytics.Component;
export const ProductPeople = pages.ProductPeople.Component;
export const CodeWorkspace = pages.CodeWorkspace.Component;
export const ConsoleApp = pages.ConsoleApp.Component;
export const NdaSign = pages.NdaSign.Component;
export const CompleteProfile = pages.CompleteProfile.Component;

/**
 * URL patterns → the chunks that route renders (layout first). Mirrors App.tsx;
 * auth screens other than onboarding are in the entry bundle and need no entry.
 * The IDE is left out on purpose: it is several MB, fetched only when opened.
 */
const prefetchRoutes: [pattern: string, chunks: LazyPage[]][] = [
  ['/', [pages.Overview]],
  ['/my-work', [pages.MyWork]],
  ['/inbox', [pages.AssignedToMe]],
  ['/test-queue', [pages.TestQueue]],
  ['/messages/*', [pages.Messages]],
  ['/docs/*', [pages.Docs]],
  ['/code-security', [pages.CodeSecurity]],
  ['/dev-tools', [pages.DevTools]],
  ['/projects', [pages.Projects]],
  ['/projects/:projectId', [pages.ProjectDetail]],
  ['/tasks/:taskKey', [pages.TaskDetail]],
  ['/assignments', [pages.Assignments]],
  ['/activity', [pages.WorkActivity]],
  ['/workspaces', [pages.Workspaces]],
  ['/repositories', [pages.Repositories]],
  ['/repositories/:repoSlug', [pages.RepositoryDetail]],
  ['/pull-requests', [pages.PullRequests]],
  ['/pull-requests/:prNumber', [pages.PullRequestDetail]],
  ['/deployments', [pages.Deployments]],
  ['/deployments/:deployId', [pages.DeploymentDetail]],
  ['/incidents', [pages.Incidents]],
  ['/incidents/:incidentId', [pages.IncidentDetail]],
  ['/monitors', [pages.Monitors]],
  ['/team', [pages.Team]],
  ['/team/:memberId', [pages.MemberDetail]],
  ['/security', [pages.SecurityCenter]],
  ['/settings', [pages.Settings]],
  ['/sessions', [pages.Sessions]],
  ['/integrations', [pages.Integrations]],
  ['/integrations/:integrationId', [pages.IntegrationDetail]],
  ['/audit', [pages.AuditLog]],
  ['/products/:productId', [pages.ProductLayout, pages.ProductOverview]],
  ['/products/:productId/work', [pages.ProductLayout, pages.ProductWork]],
  ['/products/:productId/code', [pages.ProductLayout, pages.ProductCode]],
  ['/products/:productId/deployments', [pages.ProductLayout, pages.ProductDeployments]],
  ['/products/:productId/incidents', [pages.ProductLayout, pages.ProductIncidents]],
  ['/products/:productId/analytics', [pages.ProductLayout, pages.ProductAnalytics]],
  ['/products/:productId/people', [pages.ProductLayout, pages.ProductPeople]],
  ['/onboarding/nda', [pages.NdaSign]],
  ['/onboarding/profile', [pages.CompleteProfile]],
];

/** The chunk loaders a pathname renders (empty for entry-bundle routes and the IDE). */
export function chunksFor(pathname: string): Loader[] {
  const path = pathname.split(/[?#]/)[0] || '/';
  const hit = prefetchRoutes.find(([pattern]) => matchPath({ path: pattern, end: true }, path));
  return hit ? hit[1].map((p) => p.preload) : [];
}

/** Starts loading a route's chunks without rendering it. Never throws. */
export function prefetchPath(pathname: string): void {
  for (const load of chunksFor(pathname)) load().catch(() => undefined);
}
