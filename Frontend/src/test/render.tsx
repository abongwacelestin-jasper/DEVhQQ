/**
 * Render helpers shared by component tests.
 *
 * `renderWithRouter` mounts the UI inside a MemoryRouter so components that use
 * <Link>/useNavigate work, and returns a user-event instance bound to the
 * current timer mode. Phase 2 passes the app's context providers through
 * `wrap` (Auth, Reauth, Workspace…) as hooks move onto the API.
 */
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

export interface RenderWithRouterOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  /** Optional extra providers around the UI (inside the router). */
  wrap?: (children: ReactNode) => ReactElement;
}

export function setupUser() {
  // With fake timers, user-event must advance them or every keystroke hangs.
  return userEvent.setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {});
}

export function renderWithRouter(ui: ReactElement, opts: RenderWithRouterOptions = {}) {
  const { route = '/', wrap, ...rest } = opts;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>{wrap ? wrap(children) : children}</MemoryRouter>
  );
  return { user: setupUser(), ...render(ui, { wrapper: Wrapper, ...rest }) };
}
