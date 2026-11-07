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
import { NdaSign } from './pages/auth/NdaSign';
import { CompleteProfile } from './pages/auth/CompleteProfile';
import { Overview } from './pages/Overview';
import { MyWork } from './pages/MyWork';
import { TestQueue } from './pages/TestQueue';
import { Projects } from './pages/Projects';
import { ProjectDetail } from './pages/ProjectDetail';
import { TaskDetail } from './pages/TaskDetail';
import { Assignments } from './pages/Assignments';
import { WorkActivity } from './pages/WorkActivity';
import { Workspaces } from './pages/Workspaces';
import { Repositories } from './pages/Repositories';
import { RepositoryDetail } from './pages/RepositoryDetail';
import { PullRequests } from './pages/PullRequests';
import { PullRequestDetail } from './pages/PullRequestDetail';
import { Deployments } from './pages/Deployments';
import { DeploymentDetail } from './pages/DeploymentDetail';
import { Incidents } from './pages/Incidents';
import { IncidentDetail } from './pages/IncidentDetail';
import { Monitors } from './pages/Monitors';
import { Team } from './pages/Team';
import { MemberDetail } from './pages/MemberDetail';
import { SecurityCenter } from './pages/SecurityCenter';
import { Settings } from './pages/Settings';
import { Sessions } from './pages/Sessions';
import { Integrations } from './pages/Integrations';
import { IntegrationDetail } from './pages/IntegrationDetail';
import { AuditLog } from './pages/AuditLog';
import { PageNotFound } from './pages/PageNotFound';
import { ProductLayout } from './pages/product/ProductLayout';
import { ProductOverview } from './pages/product/ProductOverview';
import { ProductWork } from './pages/product/ProductWork';
import { ProductCode } from './pages/product/ProductCode';
import { ProductDeployments } from './pages/product/ProductDeployments';
import { ProductIncidents } from './pages/product/ProductIncidents';
import { ProductAnalytics } from './pages/product/ProductAnalytics';
import { ProductPeople } from './pages/product/ProductPeople';
import { MessagingProvider } from './contexts/MessagingContext';
import { DocsProvider } from './contexts/DocsContext';
import { OffboardingProvider } from './contexts/OffboardingContext';
import { Messages } from './pages/Messages';
import { Docs } from './pages/Docs';
import { CodeWorkspace } from './pages/CodeWorkspace';
import { CodeSecurity } from './pages/CodeSecurity';
import { DevTools } from './pages/DevTools';
import { ForgotPassword } from './pages/auth/ForgotPassword';
import { ResetPassword } from './pages/auth/ResetPassword';
import { AcceptInvite } from './pages/auth/AcceptInvite';
import { AssignedToMe } from './pages/AssignedToMe';
import { ConsoleApp } from './pages/console/ConsoleApp';

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
                                    <Route path="projects/:projectId" element={<ProjectDetail />} />
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
                                      <Route path="deployments" element={<ProductDeployments />} />
                                      <Route path="incidents" element={<ProductIncidents />} />
                                      <Route path="analytics" element={<ProductAnalytics />} />
                                      <Route path="people" element={<ProductPeople />} />
                                    </Route>
                                    <Route path="*" element={<PageNotFound />} />
                                  </Route>
                                </Routes>
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
