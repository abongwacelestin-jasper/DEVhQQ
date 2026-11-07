/** Interactive primitives: Button, SearchInput, Segmented, UnderlineTabs, MultiSelect. */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { setupUser } from '../../test/render';
import { Button } from './Button';
import { SearchInput } from './SearchInput';
import { Segmented } from './Segmented';
import { UnderlineTabs } from './UnderlineTabs';
import { MultiSelect } from './MultiSelect';

describe('Button', () => {
  it('passes native props through and fires onClick', async () => {
    const user = setupUser();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} type="submit" aria-describedby="hint" icon={<svg data-testid="icon" />}>
        Save
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toHaveAttribute('type', 'submit');
    expect(b).toHaveAttribute('aria-describedby', 'hint');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    await user.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', async () => {
    const user = setupUser();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each([
    ['primary', 'bg-ink'],
    ['secondary', 'border-line'],
    ['danger', 'bg-bad'],
    ['ghost', 'text-muted'],
  ] as const)('variant %s applies its style', (variant, cls) => {
    render(<Button variant={variant}>x</Button>);
    expect(screen.getByRole('button')).toHaveClass(cls);
  });

  it('size and className are applied', () => {
    render(
      <Button size="sm" className="extra">
        x
      </Button>,
    );
    expect(screen.getByRole('button')).toHaveClass('h-7', 'extra');
  });
});

describe('SearchInput', () => {
  function Controlled({ onChange }: { onChange?: (v: string) => void }) {
    const [v, setV] = useState('');
    return (
      <SearchInput
        value={v}
        onChange={(next) => {
          setV(next);
          onChange?.(next);
        }}
        placeholder="Filter tasks"
        label="Filter tasks"
      />
    );
  }

  it('is a labelled search box that reports every keystroke', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const box = screen.getByRole('searchbox', { name: 'Filter tasks' });
    expect(box).toHaveAttribute('placeholder', 'Filter tasks');
    await user.type(box, 'RB-2');
    expect(onChange).toHaveBeenLastCalledWith('RB-2');
    expect(box).toHaveValue('RB-2');
  });

  it('shows a clear button only when there is a value, and clearing empties it', async () => {
    const user = setupUser();
    render(<Controlled />);
    expect(screen.queryByRole('button', { name: 'Clear filter' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'x');
    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear filter' })).not.toBeInTheDocument();
  });
});

type View = 'list' | 'board' | 'calendar';
const views: { value: View; label: string; count?: number }[] = [
  { value: 'list', label: 'List', count: 3 },
  { value: 'board', label: 'Board' },
  { value: 'calendar', label: 'Calendar', count: 0 },
];

describe('Segmented', () => {
  it('is a named tablist with exactly one selected tab and counts', () => {
    render(<Segmented options={views} value="board" onChange={() => {}} label="View" />);
    expect(screen.getByRole('tablist', { name: 'View' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs[0]).toHaveTextContent('List3');
    expect(tabs[2]).toHaveTextContent('Calendar0');
  });

  it('reports the chosen value', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(<Segmented options={views} value="list" onChange={onChange} label="View" />);
    await user.click(screen.getByRole('tab', { name: /Calendar/ }));
    expect(onChange).toHaveBeenCalledWith('calendar');
  });
});

describe('UnderlineTabs', () => {
  it('marks the active tab, shows counts and trailing content', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(
      <UnderlineTabs
        options={[
          { value: 'open', label: 'Open', count: 4 },
          { value: 'blocked', label: 'Blocked', count: 2, tone: 'warn' },
          { value: 'done', label: 'Done' },
        ]}
        value="open"
        onChange={onChange}
        label="Task state"
        trailing={<span>trail</span>}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Task state' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Open/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Done/ })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('2')).toHaveClass('text-warn');
    expect(screen.getByText('4')).toHaveClass('bg-ink');
    expect(screen.getByText('trail')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Blocked/ }));
    expect(onChange).toHaveBeenCalledWith('blocked');
  });
});

describe('MultiSelect', () => {
  type P = 'urgent' | 'high' | 'low';
  const options = [
    { value: 'urgent' as P, label: 'Urgent', count: 2, dot: 'bg-bad' },
    { value: 'high' as P, label: 'High' },
    { value: 'low' as P, label: 'Low' },
  ];

  function Controlled({ initial = [] as P[] }) {
    const [v, setV] = useState<P[]>(initial);
    return (
      <>
        <MultiSelect label="Priority" options={options} value={v} onChange={setV} />
        <button>outside</button>
        <output data-testid="picked">{v.join(',')}</output>
      </>
    );
  }
  const picked = () => screen.getByTestId('picked').textContent;
  const trigger = () => screen.getByRole('button', { name: /^Priority/ });

  it('opens a multi-select listbox from a collapsed trigger', async () => {
    const user = setupUser();
    render(<Controlled />);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('toggles options and summarises the selection on the trigger', async () => {
    const user = setupUser();
    render(<Controlled />);
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: /Urgent/ }));
    expect(picked()).toBe('urgent');
    expect(trigger()).toHaveTextContent('PriorityUrgent');
    expect(screen.getByRole('option', { name: /Urgent/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: /Low/ }));
    expect(picked()).toBe('urgent,low');
    expect(trigger()).toHaveTextContent('Priority2');
    await user.click(screen.getByRole('option', { name: /Urgent/ }));
    expect(picked()).toBe('low');
  });

  it('clears all selections from the menu', async () => {
    const user = setupUser();
    render(<Controlled initial={['high', 'low']} />);
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Clear priority' }));
    expect(picked()).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear priority' })).not.toBeInTheDocument();
  });

  it('closes on Escape and on a click outside', async () => {
    const user = setupUser();
    render(<Controlled />);
    await user.click(trigger());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await user.click(trigger());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'outside' }));
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });
});
