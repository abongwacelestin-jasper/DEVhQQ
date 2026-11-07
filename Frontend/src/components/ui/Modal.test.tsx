import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { setupUser } from '../../test/render';
import { Field, Modal, inputClass } from './Modal';

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Invite">
        body
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });

  it('is a labelled modal dialog with description, body and footer', () => {
    render(
      <Modal open onClose={() => {}} title="Invite member" description="They get a link" footer={<button>Send</button>}>
        <p>Body text</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Invite member' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Invite member' })).toBeInTheDocument();
    expect(screen.getByText('They get a link')).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('closes on Escape and on the close button', async () => {
    const user = setupUser();
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="T">
        x
      </Modal>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes when the backdrop is clicked but not when the panel is', async () => {
    const user = setupUser();
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="T">
        <span>inside</span>
      </Modal>,
    );
    await user.click(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = screen.getByRole('dialog').previousElementSibling as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks page scroll while open and restores it on close', async () => {
    document.body.style.overflow = 'auto';
    function Toggle() {
      const [open, setOpen] = useState(true);
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="T">
          x
        </Modal>
      );
    }
    const user = setupUser();
    render(<Toggle />);
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('auto');
    // The exit animation may or may not have finished by now; either way it must go.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    document.body.style.overflow = '';
  });

  it('moves focus to the first field shortly after opening', () => {
    vi.useFakeTimers();
    render(
      <Modal open onClose={() => {}} title="T">
        <input aria-label="Email" />
      </Modal>,
    );
    expect(screen.getByLabelText('Email')).not.toHaveFocus();
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('stops listening for Escape once closed', async () => {
    const user = setupUser();
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="T">
        x
      </Modal>,
    );
    rerender(
      <Modal open={false} onClose={onClose} title="T">
        x
      </Modal>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Field', () => {
  it('labels its control and shows a hint', () => {
    render(
      <Field label="Email" hint="Work address">
        <input className={inputClass} />
      </Field>,
    );
    expect(screen.getByLabelText(/^Email/)).toHaveClass('h-8');
    expect(screen.getByText('Work address')).toBeInTheDocument();
  });
});
