/** Presentational primitives: StatusBadge, ProgressBar, Avatar, StatCard, Panel. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render';
import { members } from '../../data/team';
import type { Tone } from '../../types/portfolio';
import { StatusBadge } from './StatusBadge';
import { ProgressBar } from './ProgressBar';
import { Avatar } from './Avatar';
import { StatCard, StatStrip } from './StatCard';
import { Panel } from './Panel';

describe('StatusBadge', () => {
  it.each([
    ['ok', 'text-ok'],
    ['warn', 'text-warn'],
    ['bad', 'text-bad'],
    ['neutral', 'text-muted'],
    ['info', 'text-info'],
    ['accent', 'text-accent-ink'],
  ] as [Tone, string][])('tone %s → %s', (tone, cls) => {
    render(<StatusBadge tone={tone} label="Status" />);
    expect(screen.getByText('Status')).toHaveClass(cls);
  });

  it('renders a decorative dot only when asked', () => {
    const { container, rerender } = render(<StatusBadge tone="ok" label="Live" />);
    expect(container.querySelector('[aria-hidden]')).toBeNull();
    rerender(<StatusBadge tone="ok" label="Live" dot />);
    expect(container.querySelector('[aria-hidden]')).toHaveClass('bg-ok');
  });
});

describe('ProgressBar', () => {
  it.each([
    [42.4, '42', '42.4%'],
    [-5, '0', '0%'],
    [180, '100', '100%'],
  ])('value %d → aria-valuenow %s and width %s', (value, now, width) => {
    render(<ProgressBar value={value} label="Sprint" />);
    const bar = screen.getByRole('progressbar', { name: 'Sprint' });
    expect(bar).toHaveAttribute('aria-valuenow', now);
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe(width);
  });
});

describe('Avatar', () => {
  it("shows the member's initials, colour and an accessible name", () => {
    const m = members[0];
    render(<Avatar id={m.id} size="lg" ring />);
    const el = screen.getByTitle(m.name);
    expect(el).toHaveTextContent(m.initials);
    expect(el).toHaveClass('h-10', 'ring-2');
    expect(el.style.backgroundColor).not.toBe('');
    expect(screen.getByText(m.name)).toHaveClass('sr-only');
  });
});

describe('StatCard', () => {
  it('renders label, value and note without a link by default', () => {
    render(
      <StatStrip>
        <StatCard label="Open" value={12} note="3 overdue" tone="bad" />
      </StatStrip>,
    );
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('12')).toHaveClass('text-bad');
    expect(screen.getByText('3 overdue')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('becomes a link when given a destination', () => {
    renderWithRouter(<StatCard label="Open" value={12} to="/tasks?status=open" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/tasks?status=open');
    expect(screen.getByText('12')).toHaveClass('text-ink');
  });
});

describe('Panel', () => {
  it('is a section headed by its title with optional meta, action and filter rows', () => {
    render(
      <Panel title="Deploys" meta={<span>3 today</span>} action={<button>New</button>} filter={<input aria-label="f" />}>
        <p>rows</p>
      </Panel>,
    );
    expect(screen.getByRole('heading', { name: 'Deploys' })).toBeInTheDocument();
    expect(screen.getByText('3 today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
    expect(screen.getByLabelText('f')).toBeInTheDocument();
    expect(screen.getByText('rows')).toBeInTheDocument();
  });

  it('omits the meta and filter rows when not given', () => {
    const { container } = render(<Panel title="Plain">x</Panel>);
    expect(container.querySelectorAll('section > div')).toHaveLength(1);
    expect(container.querySelector('header > div')).toBeNull();
  });
});
