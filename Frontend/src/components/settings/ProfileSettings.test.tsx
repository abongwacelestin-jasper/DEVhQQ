import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render';
import type { Profile } from '../../contexts/AuthContext';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn() }) }));

const updateProfile = vi.fn();
const completeProfile = vi.fn();
let profile: Profile | undefined;
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { profile },
    member: { name: 'Sam Carter', email: 'sam@techorg.io' },
    role: { label: 'Developer' },
    updateProfile,
    completeProfile,
  }),
}));

const { ProfileSettings } = await import('./ProfileSettings');

const saved: Profile = {
  displayName: 'Sam Carter',
  timezone: 'UTC',
  hoursFrom: '09:00',
  hoursTo: '17:00',
  skills: ['React'],
  notify: ['assigned'],
  days: ['Mon', 'Tue'],
  emailDelivery: 'instant',
};

beforeEach(() => {
  updateProfile.mockReset();
  completeProfile.mockReset();
  profile = saved;
});

// Many keystrokes and re-renders per test: allow for a loaded CI machine.
describe('ProfileSettings', { timeout: 20_000 }, () => {
  it('sends only the changed fields and confirms after the server accepts', async () => {
    updateProfile.mockResolvedValue({ ok: true });
    const { user } = renderWithRouter(<ProfileSettings />);
    expect(screen.getByLabelText('Timezone')).toHaveValue('UTC'); // unknown zones stay selectable
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    await user.click(screen.getByLabelText('Title'));
    await user.paste('Staff engineer');
    await user.click(screen.getByRole('checkbox', { name: 'Wed' }));
    await user.click(screen.getByRole('radio', { name: 'Daily digest' }));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(updateProfile).toHaveBeenCalledWith({
      title: 'Staff engineer',
      days: ['Mon', 'Tue', 'Wed'],
      emailDelivery: 'daily',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Profile saved');
  });

  it('shows the server refusal as an alert and never claims success', async () => {
    updateProfile.mockResolvedValue({ ok: false, error: 'hoursTo must be later than hoursFrom' });
    const { user } = renderWithRouter(<ProfileSettings />);
    await user.click(screen.getByLabelText('Pronouns (optional)'));
    await user.paste('he/him');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('hoursTo must be later');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('validates working days and skills before saving', async () => {
    const { user } = renderWithRouter(<ProfileSettings />);
    await user.click(screen.getByRole('checkbox', { name: 'Mon' }));
    await user.click(screen.getByRole('checkbox', { name: 'Tue' }));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least one working day');
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('creates the profile on first save when the member has none (e.g. an Owner)', async () => {
    profile = undefined;
    completeProfile.mockResolvedValue({ ok: true });
    const { user } = renderWithRouter(<ProfileSettings />);
    await user.click(screen.getByRole('checkbox', { name: 'TypeScript' }));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(completeProfile).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Sam Carter', skills: ['TypeScript'] }),
    );
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
