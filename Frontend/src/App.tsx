import { Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { ThemedToaster } from './components/layout/ThemedToaster';
import { JitAccessHost } from './components/jit/JitAccessHost';
import { AuthProvider } from './contexts/AuthContext';
import { ProductFilterProvider } from './contexts/ProductFilterContext';
import { WorkspaceUIProvider } from './contexts/WorkspaceUIContext';
import { ReauthProvider } from './contexts/ReauthContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { DateRangeProvider } from './contexts/DateRangeContext';
import { WorkProvider } from './contexts/WorkContext';
import { IncidentProvider } from './contexts/IncidentContext';
import { RequireAuth, StageRoute } from './components/auth/StageRoute';
import { AppShell } from './components/layout/AppShell';
import { SignIn } from './pages/auth/SignIn';
import { Verify } from './pages/auth/Verify';
import { MessagingProvider } from './contexts/MessagingContext';
import { DocsProvider } from './contexts/DocsContext';
import { OffboardingProvider } from './contexts/OffboardingContext';
import { ForgotPassword } from './pages/auth/ForgotPassword';
import { ResetPassword } from './pages/auth/ResetPassword';
import { AcceptInvite } from './pages/auth/AcceptInvite';
import {
  NdaSign,
  CompleteProfile,
  Overview,
  MyWork,
  TestQueue,
  Projects,
  ProjectDetail,
  TaskDetail,
  Assignments,
  WorkActivity,
  Workspaces,
  Repositories,
  RepositoryDetail,
  PullRequests,
  PullRequestDetail,
  Deployments,
  DeploymentDetail,
  Incidents,
  IncidentDetail,
  Monitors,
  Team,
  MemberDetail,
  SecurityCenter,
  Settings,
  Sessions,
  Integrations,
  IntegrationDetail,
  AuditLog,
  PageNotFound,
  ProductLayout,
  ProductOverview,
  ProductWork,
  ProductCode,
  ProductDeployments,
  ProductIncidents,
  ProductAnalytics,
  ProductPeople,
  Messages,
  Docs,
  CodeWorkspace,
  CodeSecurity,
  DevTools,
  AssignedToMe,
  ConsoleApp,
} from './routes/lazyPages';
import { useLikelyRoutePrefetch, useLinkPrefetch } from './routes/usePrefetch';
import { RouteFallback } from './components/layout/RouteFallback';

/** Route-chunk prefetching: link intent anywhere in the app, and where the session goes next. */
function RoutePrefetch() {
  useLinkPrefetch();
  useLikelyRoutePrefetch();
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
            <WorkspaceProvider>
              <ProductFilterProvider>
                <DateRangeProvider>
                  <WorkProvider>
                    <IncidentProvider>
                      <MessagingProvider>
                        <DocsProvider>
                          <OffboardingProvider>
                            <WorkspaceUIProvider>
                              <ReauthProvider>
                                <RoutePrefetch />
                                {/* Pages are lazy chunks. In-app routes suspend inside AppShell
                                    (its own skeleton); this boundary covers the full-screen ones. */}
                                <Suspense fallback={<RouteFallback />}>
                                  <Routes>
                                    <Route
                                      path="sign-in"
                                      element={
                                        <StageRoute stage="signed-out">
                                          <SignIn />
                                        </StageRoute>
                                      }
                                    />
                                    <Route
                                      path="forgot-password"
                                      element={
                                        <StageRoute stage="signed-out">
                                          <ForgotPassword />
                                        </StageRoute>
                                      }
                                    />
                                    <Route
                                      path="reset-password"
                                      element={
                                        <StageRoute stage="signed-out">
                                          <ResetPassword />
                                        </StageRoute>
                                      }
                                    />
                                    <Route
                                      path="accept-invite"
                                      element={
                                        <StageRoute stage="signed-out">
                                          <AcceptInvite />
                                        </StageRoute>
                                      }
                                    />
                                    <Route
                                      path="verify"
                                      element={
                                        <StageRoute stage="mfa">
                                          <Verify />
                                        </StageRoute>
                                      }
                                    />
                                    <Route
                                      path="onboarding/nda"
                                      element={
                                        <StageRoute stage="nda">
                                          <NdaSign />
                                        </StageRoute>
                                      }
                                    />
                                    <Route
                                      path="onboarding/profile"
                                      element={
                                        <StageRoute stage="profile">
                                          <CompleteProfile />
                                        </StageRoute>
                                      }
                                    />
                                    <Route
                                      path="code"
                                      element={
                                        <RequireAuth>
                                          <CodeWorkspace />
                                        </RequireAuth>
                                      }
                                    />
                                    <Route
                                      path="products/:productId/ide"
                                      element={
                                        <RequireAuth>
                                          <CodeWorkspace />
                                        </RequireAuth>
                                      }
                                    />
                                    <Route path="console/*" element={<ConsoleApp />} />

                                    <Route
                                      element={
                                        <RequireAuth>
                                          <AppShell />
                                        </RequireAuth>
                                      }
                                    >
                                      <Route index element={<Overview />} />
                                      <Route path="my-work" element={<MyWork />} />
                                      <Route path="inbox" element={<AssignedToMe />} />
                                      <Route path="test-queue" element={<TestQueue />} />
                                      <Route path="messages" element={<Messages />} />
                                      <Route path="messages/:channelId" element={<Messages />} />
                                      <Route path="docs" element={<Docs />} />
                                      <Route path="docs/:docId" element={<Docs />} />
                                      <Route path="code-security" element={<CodeSecurity />} />
                                      <Route path="dev-tools" element={<DevTools />} />
                                      <Route path="projects" element={<Projects />} />
                                      <Route
                                        path="projects/:projectId"
                                        element={<ProjectDetail />}
                                      />
                                      <Route path="tasks/:taskKey" element={<TaskDetail />} />
                                      <Route path="assignments" element={<Assignments />} />
                                      <Route path="activity" element={<WorkActivity />} />
                                      <Route path="workspaces" element={<Workspaces />} />
                                      <Route path="repositories" element={<Repositories />} />
                                      <Route
                                        path="repositories/:repoSlug"
                                        element={<RepositoryDetail />}
                                      />
                                      <Route path="pull-requests" element={<PullRequests />} />
                                      <Route
                                        path="pull-requests/:prNumber"
                                        element={<PullRequestDetail />}
                                      />
                                      <Route path="deployments" element={<Deployments />} />
                                      <Route
                                        path="deployments/:deployId"
                                        element={<DeploymentDetail />}
                                      />
                                      <Route path="incidents" element={<Incidents />} />
                                      <Route
                                        path="incidents/:incidentId"
                                        element={<IncidentDetail />}
                                      />
                                      <Route path="monitors" element={<Monitors />} />
                                      <Route path="team" element={<Team />} />
                                      <Route path="team/:memberId" element={<MemberDetail />} />
                                      <Route path="security" element={<SecurityCenter />} />
                                      <Route path="settings" element={<Settings />} />
                                      <Route path="sessions" element={<Sessions />} />
                                      <Route path="integrations" element={<Integrations />} />
                                      <Route
                                        path="integrations/:integrationId"
                                        element={<IntegrationDetail />}
                                      />
                                      <Route path="audit" element={<AuditLog />} />
                                      <Route path="products/:productId" element={<ProductLayout />}>
                                        <Route index element={<ProductOverview />} />
                                        <Route path="work" element={<ProductWork />} />
                                        <Route path="code" element={<ProductCode />} />
                                        <Route
                                          path="deployments"
                                          element={<ProductDeployments />}
                                        />
                                        <Route path="incidents" element={<ProductIncidents />} />
                                        <Route path="analytics" element={<ProductAnalytics />} />
                                        <Route path="people" element={<ProductPeople />} />
                                      </Route>
                                      <Route path="*" element={<PageNotFound />} />
                                    </Route>
                                  </Routes>
                                </Suspense>
                                <ThemedToaster />
                                <JitAccessHost />
                              </ReauthProvider>
                            </WorkspaceUIProvider>
                          </OffboardingProvider>
                        </DocsProvider>
                      </MessagingProvider>
                    </IncidentProvider>
                  </WorkProvider>
                </DateRangeProvider>
              </ProductFilterProvider>
            </WorkspaceProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
