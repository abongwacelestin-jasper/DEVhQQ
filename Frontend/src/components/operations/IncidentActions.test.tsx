import { describe, expect, it, vi } from 'vitest';
import { renderHook, screen, waitFor, within, act } from '@testing-library/react';
import { renderWithRouter } from '../../test/render';
import { apiError, mockFetch } from '../../test/fetchMock';
import type { ApiIncidentAction } from '../../api/types';
import type { Member } from '../../types/team';
import { IncidentActionsView, isOverdue, type IncidentActionsViewProps } from './IncidentActions';

vi.mock('../engineering/data/events', () => ({ onServerEvents: () => () => undefined }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const member = (id: string, name: string): Member => ({
  id,
  name,
  initials: name[0],
  email: `${id}@x.io`,
  role: 'Operations',
  products: ['renewberry'],
  productionAccess: false,
  mfa: true,
  status: 'active',
  lastActive: '—',
  openTasks: 0,
  capacity: 0,
  color: '#000',
});
const owners = [member('m11', 'Grace Liu'), member('m4', 'Kofi Mensah')];

const action = (over: Partial<ApiIncidentAction> = {}): ApiIncidentAction => ({
  id: 'act-1',
  incidentId: 'INC-1',
  title: 'Roll back the CDN config',
  detail: null,
  owner: 'm4',
  due: null,
  status: 'open',
  kind: 'mitigation',
  createdBy: 'm11',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
  doneAt: null,
  ...over,
});

function setup(over: Partial<IncidentActionsViewProps> = {}) {
  const props: IncidentActionsViewProps = {
    items: [],
    loading: false,
    error: null,
    busy: new Set(),
    owners,
    nameOf: (id) => owners.find((m) => m.id === id)?.name ?? id,
    me: 'm11',
    canEdit: true,
    canDelete: true,
    today: '2026-11-07',
    onAdd: vi.fn(async () => true),
    onUpdate: vi.fn(async () => true),
    onDelete: vi.fn(async () => true),
    ...over,
  };
  return { props, ...renderWithRouter(<IncidentActionsView {...props} />) };
}

describe('isOverdue', () => {
  it('is past due and not done', () => {
    expect(isOverdue({ due: '2026-11-06', status: 'open' }, '2026-11-07')).toBe(true);
    expect(isOverdue({ due: '2026-11-07', status: 'open' }, '2026-11-07')).toBe(false);
    expect(isOverdue({ due: '2026-11-01', status: 'done' }, '2026-11-07')).toBe(false);
    expect(isOverdue({ due: null, status: 'open' }, '2026-11-07')).toBe(false);
  });
});

describe('IncidentActionsView', () => {
  it('keeps mitigation and follow-ups in separate labelled sections', () => {
    setup({
      items: [action(), action({ id: 'act-2', title: 'Write the postmortem', kind: 'follow-up' })],
    });
    const mitigation = screen.getByRole('region', { name: /Mitigation/ });
    const followUps = screen.getByRole('region', { name: /Follow-ups/ });
    expect(within(mitigation).getByText('Roll back the CDN config')).toBeInTheDocument();
    expect(within(mitigation).queryByText('Write the postmortem')).not.toBeInTheDocument();
    expect(within(followUps).getByText('Write the postmortem')).toBeInTheDocument();
  });

  it('highlights overdue steps with text, not only colour', () => {
    setup({
      items: [
        action({ due: '2026-11-05' }),
        action({ id: 'act-2', title: 'Done late', due: '2026-11-01', status: 'done' }),
      ],
    });
    expect(screen.getAllByText('Overdue')).toHaveLength(1);
  });

  it('adds a step with title, owner, due and kind; clears only after the API accepts', async () => {
    const onAdd = vi.fn(async () => false);
    const { user } = setup({ onAdd });
    const form = screen.getByRole('form', { name: 'Add a recovery step' });
    await user.type(within(form).getByLabelText('Step'), 'Purge the cache');
    await user.selectOptions(within(form).getByLabelText('Owner'), 'm4');
    await user.type(within(form).getByLabelText(/Due/), '2026-11-09');
    await user.selectOptions(within(form).getByLabelText('Kind'), 'follow-up');
    await user.click(within(form).getByRole('button', { name: 'Add step' }));
    expect(onAdd).toHaveBeenCalledWith({
      title: 'Purge the cache',
      owner: 'm4',
      due: '2026-11-09',
      kind: 'follow-up',
    });
    // Refused: what the responder typed stays.
    expect(within(form).getByLabelText('Step')).toHaveValue('Purge the cache');
    onAdd.mockResolvedValueOnce(true);
    await user.click(within(form).getByRole('button', { name: 'Add step' }));
    await waitFor(() => expect(within(form).getByLabelText('Step')).toHaveValue(''));
  });

  it('defaults the owner to the signed-in member and submits with the keyboard', async () => {
    const { user, props } = setup();
    await user.click(screen.getByLabelText('Step'));
    await user.keyboard('Page the vendor{Enter}');
    expect(props.onAdd).toHaveBeenCalledWith({
      title: 'Page the vendor',
      owner: 'm11',
      due: null,
      kind: 'mitigation',
    });
  });

  it('ticks a step done, reopens it and reassigns it', async () => {
    const { user, props, rerender } = setup({ items: [action()] });
    await user.click(screen.getByRole('checkbox', { name: /Roll back the CDN config/ }));
    expect(props.onUpdate).toHaveBeenCalledWith(
      'act-1',
      { status: 'done' },
      '“Roll back the CDN config” done',
    );
    rerender(
      <IncidentActionsView
        {...props}
        items={[action({ status: 'done', doneAt: '2026-11-07T10:00:00Z' })]}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: /Roll back the CDN config/ }));
    expect(props.onUpdate).toHaveBeenLastCalledWith(
      'act-1',
      { status: 'open' },
      'Reopened “Roll back the CDN config”',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Owner of “Roll back the CDN config”' }),
      'm11',
    );
    expect(props.onUpdate).toHaveBeenLastCalledWith(
      'act-1',
      { owner: 'm11' },
      'Reassigned to Grace Liu',
    );
  });

  it('deletes after confirmation only', async () => {
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const { user, props } = setup({ items: [action()] });
    const del = screen.getByRole('button', { name: 'Delete “Roll back the CDN config”' });
    await user.click(del);
    expect(props.onDelete).not.toHaveBeenCalled();
    await user.click(del);
    expect(props.onDelete).toHaveBeenCalledWith('act-1');
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('disables controls for roles without permission and says why', () => {
    setup({ items: [action()], canEdit: false, canDelete: false });
    const reason = 'Adding or updating steps needs Infrastructure: contribute.';
    expect(screen.getByText(reason)).toBeInTheDocument();
    for (const el of [
      screen.getByRole('checkbox', { name: /Roll back/ }),
      screen.getByRole('combobox', { name: /Owner of/ }),
      screen.getByLabelText('Step'),
      screen.getByRole('button', { name: 'Add step' }),
    ]) {
      expect(el).toBeDisabled();
      expect(el).toHaveAccessibleDescription(reason);
    }
    const del = screen.getByRole('button', { name: /Delete/ });
    expect(del).toBeDisabled();
    expect(del).toHaveAccessibleDescription('Needs Infrastructure: manage');
  });

  it('shows load errors as an alert', () => {
    setup({ error: 'Not found' });
    expect(screen.getByRole('alert')).toHaveTextContent('Not found');
  });
});

describe('useIncidentActions', () => {
  it('loads, then replaces rows only with what the server accepted', async () => {
    const { useIncidentActions } = await import('./useIncidentActions');
    const { toast } = await import('sonner');
    const onWritten = vi.fn();
    const f = mockFetch()
      .reply(200, [action()])
      .reply(200, action({ status: 'done', doneAt: '2026-11-07T10:00:00Z' }))
      .reply(403, apiError('forbidden', 'Requires contribute on Infrastructure'))
      .reply(201, action({ id: 'act-2', title: 'New' }))
      .reply(204);
    const { result } = renderHook(() => useIncidentActions('INC-1', onWritten));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(f.calls[0].url).toBe('/api/incidents/INC-1/actions');
    expect(result.current.items).toHaveLength(1);

    let ok = false;
    await act(async () => {
      ok = await result.current.update('act-1', { status: 'done' }, 'done!');
    });
    expect(ok).toBe(true);
    expect(f.calls[1]).toMatchObject({
      method: 'PATCH',
      url: '/api/incidents/INC-1/actions/act-1',
      body: { status: 'done' },
    });
    expect(result.current.items[0].status).toBe('done');
    expect(toast.success).toHaveBeenCalledWith('done!');

    await act(async () => {
      ok = await result.current.update('act-1', { owner: 'm4' }, 'never');
    });
    expect(ok).toBe(false);
    expect(toast.success).not.toHaveBeenCalledWith('never');
    expect(toast.error).toHaveBeenCalled();
    expect(result.current.items[0].owner).toBe('m4');

    await act(async () => {
      ok = await result.current.add({ title: 'New', owner: 'm4', due: null, kind: 'mitigation' });
    });
    expect(ok).toBe(true);
    expect(f.calls[3].body).toEqual({ title: 'New', owner: 'm4', due: null, kind: 'mitigation' });
    expect(result.current.items.map((a) => a.id)).toEqual(['act-1', 'act-2']);

    await act(async () => {
      ok = await result.current.remove('act-2');
    });
    expect(ok).toBe(true);
    expect(f.calls[4].method).toBe('DELETE');
    expect(result.current.items.map((a) => a.id)).toEqual(['act-1']);
    expect(onWritten).toHaveBeenCalledTimes(3);
  });
});
