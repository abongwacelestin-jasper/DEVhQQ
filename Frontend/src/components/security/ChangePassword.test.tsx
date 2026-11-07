import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../test/render';
import { apiError, mockFetch } from '../../test/fetchMock';
import { passwordRules, strengthOf } from '../../utils/passwordRules';

const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: (m: string) => toastSuccess(m) }),
}));

const refreshSessions = vi.fn(async () => []);
const log = vi.fn();
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ member: { email: 'sam@techorg.io' }, refreshSessions, log }),
}));

const { ChangePassword } = await import('./ChangePassword');

const GOOD = 'Harbour-Lantern-42!';

async function fill(
  user: ReturnType<typeof renderWithRouter>['user'],
  current: string,
  next: string,
  confirm = next,
) {
  await user.type(screen.getByLabelText('Current password'), current);
  await user.type(screen.getByLabelText('New password'), next);
  await user.type(screen.getByLabelText('Confirm new password'), confirm);
  await user.click(screen.getByRole('button', { name: 'Change password' }));
}

beforeEach(() => {
  toastSuccess.mockReset();
  refreshSessions.mockClear();
});

describe('passwordRules', () => {
  it('mirrors the server policy, including the email-name rule', () => {
    expect(strengthOf(passwordRules(GOOD, 'sam@techorg.io')).label).toBe('Strong');
    const withName = passwordRules('Samwise-Gamgee-1!', 'sam@techorg.io');
    expect(withName.find((r) => r.label.includes('email'))?.ok).toBe(false);
    expect(strengthOf(passwordRules('short', 'x@y.io')).label).toBe('Weak');
    // Local parts shorter than 3 characters are not checked (same as the server).
    expect(passwordRules('Ab-cdefgh-12!', 'ab@y.io').every((r) => r.ok)).toBe(true);
  });
});

describe('ChangePassword', () => {
  it('announces success only after the server accepts, then clears the form', async () => {
    const f = mockFetch().reply(200, { ok: true, revokedSessions: 2 });
    const { user } = renderWithRouter(<ChangePassword />);
    await fill(user, 'devhq-demo', GOOD);
    expect(await screen.findByRole('status')).toHaveTextContent('2 other sessions were signed out');
    expect(f.calls[0].url).toBe('/api/auth/password');
    expect(f.calls[0].method).toBe('POST');
    expect(f.calls[0].body).toEqual({ currentPassword: 'devhq-demo', newPassword: GOOD });
    expect(toastSuccess).toHaveBeenCalledWith('Password changed');
    expect(refreshSessions).toHaveBeenCalled();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('shows the wrong-current-password error as an alert and focuses the field', async () => {
    mockFetch().reply(
      403,
      apiError('invalid_current_password', 'Your current password is incorrect'),
    );
    const { user } = renderWithRouter(<ChangePassword />);
    await fill(user, 'wrong', GOOD);
    expect(await screen.findByRole('alert')).toHaveTextContent('current password is incorrect');
    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveFocus());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('blocks a weak or mismatched password before calling the server', async () => {
    const f = mockFetch();
    const { user } = renderWithRouter(<ChangePassword />);
    await fill(user, 'devhq-demo', 'weakpass');
    expect(screen.getByRole('alert')).toHaveTextContent('doesn’t meet every requirement');
    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), GOOD);
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), `${GOOD}x`);
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('don’t match');
    expect(f.calls).toHaveLength(0);
  });

  it('surfaces the server policy message', async () => {
    mockFetch().reply(
      422,
      apiError('weak_password', 'Do not include the name from your email address.'),
    );
    const { user } = renderWithRouter(<ChangePassword />);
    await fill(user, 'devhq-demo', GOOD);
    expect(await screen.findByRole('alert')).toHaveTextContent('Do not include the name');
  });
});
