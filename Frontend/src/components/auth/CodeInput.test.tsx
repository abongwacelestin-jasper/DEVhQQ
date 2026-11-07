import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { setupUser } from '../../test/render';
import { CodeInput } from './CodeInput';

/** Controlled harness: the component is stateless, the page owns the value. */
function Harness({
  initial = '',
  length,
  invalid,
  onValue,
}: {
  initial?: string;
  length?: number;
  invalid?: boolean;
  onValue?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CodeInput
        value={value}
        length={length}
        invalid={invalid}
        onChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const boxes = () => screen.getAllByRole('textbox');
const value = () => screen.getByTestId('value').textContent;

describe('CodeInput', () => {
  it('renders one labelled box per digit inside a named group, first box focused', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Verification code' })).toBeInTheDocument();
    expect(boxes()).toHaveLength(6);
    expect(screen.getByLabelText('Digit 1')).toHaveFocus();
    expect(screen.getByLabelText('Digit 1')).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.getByLabelText('Digit 2')).toHaveAttribute('autocomplete', 'off');
  });

  it('honours a custom length and marks every box invalid', () => {
    render(<Harness length={4} invalid />);
    expect(boxes()).toHaveLength(4);
    for (const b of boxes()) expect(b).toHaveAttribute('aria-invalid', 'true');
  });

  it('typing fills boxes left to right and advances focus', async () => {
    const user = setupUser();
    render(<Harness />);
    await user.keyboard('246810');
    expect(value()).toBe('246810');
    expect(boxes().map((b) => (b as HTMLInputElement).value)).toEqual([
      '2',
      '4',
      '6',
      '8',
      '1',
      '0',
    ]);
    expect(screen.getByLabelText('Digit 6')).toHaveFocus();
  });

  it('ignores non-digits', async () => {
    const user = setupUser();
    render(<Harness />);
    await user.keyboard('a1-b2');
    expect(value()).toBe('12');
    expect(screen.getByLabelText('Digit 3')).toHaveFocus();
  });

  it('Backspace on an empty box clears the previous digit and moves back', async () => {
    const user = setupUser();
    render(<Harness />);
    await user.keyboard('12');
    expect(screen.getByLabelText('Digit 3')).toHaveFocus();
    await user.keyboard('{Backspace}');
    expect(value()).toBe('1');
    expect(screen.getByLabelText('Digit 2')).toHaveFocus();
  });

  it('arrow keys move between boxes', async () => {
    const user = setupUser();
    render(<Harness initial="123" />);
    await user.click(screen.getByLabelText('Digit 2'));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByLabelText('Digit 3')).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByLabelText('Digit 1')).toHaveFocus();
  });

  it('pasting a code fills every box, strips separators and truncates', async () => {
    const user = setupUser();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.paste('123-456-789');
    expect(onValue).toHaveBeenLastCalledWith('123456');
    expect(value()).toBe('123456');
    expect(screen.getByLabelText('Digit 6')).toHaveFocus();
  });

  it('pasting a partial code focuses the next empty box', async () => {
    const user = setupUser();
    render(<Harness />);
    await user.paste('98');
    expect(value()).toBe('98');
    expect(screen.getByLabelText('Digit 3')).toHaveFocus();
  });

  it('pasting text with no digits changes nothing', async () => {
    const user = setupUser();
    const onValue = vi.fn();
    render(<Harness initial="1" onValue={onValue} />);
    await user.click(screen.getByLabelText('Digit 2'));
    await user.paste('abc');
    expect(value()).toBe('1');
  });

  // FINDING F-FE-6: the code is stored as a plain string, so clearing a digit in
  // the middle collapses the gap: with "123456", clearing box 2 yields "13456"
  // and every later digit shifts one box left (box 2 now shows "3"). The user
  // sees digits they did not type move under the cursor.
  it('clearing a middle digit does not shift the digits after it (F-FE-6)', () => {
    render(<Harness initial="123456" />);
    fireEvent.change(screen.getByLabelText('Digit 2'), { target: { value: '' } });
    expect((screen.getByLabelText('Digit 3') as HTMLInputElement).value).toBe('3');
  });
});
