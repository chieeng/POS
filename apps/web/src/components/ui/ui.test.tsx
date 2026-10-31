import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inbox } from 'lucide-react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Link } from 'react-router-dom';
import { Alert, AlertAction } from './alert';
import { Button } from './button';
import { Card } from './card';
import { Checkbox, CheckboxField } from './checkbox';
import { ConnectionPill } from './connection-pill';
import { EmptyState } from './empty-state';
import { FilterChip, FilterChips } from './filter-chips';
import { LoadMore } from './load-more';
import { Sheet, SheetContent, SheetTitle } from './sheet';
import { SkeletonList } from './skeleton';
import { StatusBadge } from './status-badge';
import { Stepper } from './stepper';
import { Switch } from './switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

function setWide(wide: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('ConnectionPill', () => {
  afterEach(() => setOnline(true));

  it('shows Online, then plain Offline (no "working locally" before the outbox)', () => {
    setOnline(true);
    render(<ConnectionPill variant="sidebar" />);
    expect(screen.getByRole('status')).toHaveTextContent('Online');
    setOnline(false);
    expect(screen.getByRole('status')).toHaveTextContent(/^Offline$/);
  });

  it('shows the changes waiting to sync, short in the top bar and long in the sidebar', () => {
    const { rerender } = render(<ConnectionPill variant="topbar" pending={3} />);
    expect(screen.getByRole('status')).toHaveTextContent('3 to sync');
    rerender(<ConnectionPill variant="sidebar" pending={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 change waiting to sync');
  });

  it('names the state for screen readers on the icon-only rail', () => {
    render(<ConnectionPill variant="rail" pending={4} />);
    expect(screen.getByRole('status')).toHaveTextContent('4 changes waiting to sync');
  });
});

describe('Button that needs internet', () => {
  afterEach(() => setOnline(true));

  it('works online, and offline is disabled with a "Needs internet" hint', async () => {
    const save = vi.fn();
    render(
      <Button needsInternet onClick={save}>
        Save
      </Button>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledTimes(1);

    setOnline(false);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAccessibleDescription(
      'Needs internet',
    );
  });

  it('turns a link styled as a button into a disabled button offline', () => {
    setOnline(false);
    render(
      <MemoryRouter>
        <Button needsInternet asChild>
          <Link to="new">Add product</Link>
        </Button>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add product' })).toBeDisabled();
  });
});

describe('Sheet', () => {
  function Demo() {
    return (
      <Sheet open>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle>Adjust stock</SheetTitle>
        </SheetContent>
      </Sheet>
    );
  }

  it('is a bottom sheet with a handle on phones', () => {
    setWide(false);
    render(<Demo />);
    const dialog = screen.getByRole('dialog', { name: 'Adjust stock' });
    expect(dialog.className).toContain('rounded-t-[32px]');
    expect(dialog.className).toContain('bg-bg');
  });

  it('is a centered dialog from tablet width up', () => {
    setWide(true);
    render(<Demo />);
    const dialog = screen.getByRole('dialog', { name: 'Adjust stock' });
    expect(dialog.className).toContain('rounded-card');
    expect(dialog.className).not.toContain('rounded-t-[32px]');
  });
});

describe('Card', () => {
  it('styles its child as the card with asChild, so a form stays a form', () => {
    render(
      <Card asChild size="panel" className="py-[18px]">
        <form aria-label="Product" />
      </Card>,
    );
    const form = screen.getByRole('form', { name: 'Product' });
    expect(form).toHaveClass('rounded-card', 'bg-surface', 'py-[18px]');
    expect(form).not.toHaveClass('py-2');
  });
});

describe('Table', () => {
  it('keeps headings and numbers on one line, so a phone scrolls instead of wrapping', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead numeric>Unit cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell numeric>2 pack</TableCell>
            <TableCell>Chips Classic</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('columnheader', { name: 'Unit cost' })).toHaveClass(
      'whitespace-nowrap',
    );
    expect(screen.getByRole('cell', { name: '2 pack' })).toHaveClass('whitespace-nowrap');
    expect(screen.getByRole('cell', { name: 'Chips Classic' })).not.toHaveClass(
      'whitespace-nowrap',
    );
  });
});

describe('Stepper', () => {
  function Demo({ min = 0, max }: { min?: number; max?: number }) {
    const [value, setValue] = useState(1);
    return <Stepper label="Pieces" value={value} onChange={setValue} min={min} max={max} />;
  }

  it('steps with the buttons and the arrow keys, within min and max', async () => {
    const user = userEvent.setup();
    render(<Demo max={2} />);
    const value = screen.getByRole('spinbutton', { name: 'Pieces' });
    await user.click(screen.getByRole('button', { name: 'More pieces' }));
    expect(value).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByRole('button', { name: 'More pieces' })).toBeDisabled();
    value.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(value).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('button', { name: 'Less pieces' })).toBeDisabled();
  });
});

describe('Switch and Checkbox', () => {
  it('toggle by click', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Switch aria-label="Owner clocks in too" />
        <CheckboxField label="Mark location as verified" />
      </>,
    );
    const toggle = screen.getByRole('switch', { name: 'Owner clocks in too' });
    await user.click(toggle);
    expect(toggle).toBeChecked();
    const box = screen.getByRole('checkbox', { name: 'Mark location as verified' });
    await user.click(screen.getByText('Mark location as verified'));
    expect(box).toBeChecked();
  });

  it('respects disabled', async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Low stock only" disabled />);
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});

describe('FilterChips', () => {
  it('marks the selected chip and clears it with the ×', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const onClick = vi.fn();
    render(
      <FilterChips label="Filters">
        <FilterChip selected count={6} onClear={onClear}>
          Low stock
        </FilterChip>
        <FilterChip onClick={onClick}>All</FilterChip>
      </FilterChips>,
    );
    const low = screen.getByRole('button', { name: /^Low stock\s*· 6, clear$/ });
    expect(low).toHaveAttribute('aria-pressed', 'true');
    await user.click(low);
    expect(onClear).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('LoadMore', () => {
  it('shows how many of the total are loaded and loads the next page', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    render(<LoadMore shown={300} total={1214} onLoadMore={onLoadMore} />);
    expect(screen.getByText('Showing 300 of 1,214')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('hides the button once everything is shown', () => {
    render(<LoadMore shown={42} total={42} onLoadMore={() => {}} />);
    expect(screen.getByText('Showing 42 of 42')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Status and empty states', () => {
  beforeEach(() => setWide(false));

  it('StatusBadge pairs words with an icon', () => {
    render(<StatusBadge tone="warn">3 left</StatusBadge>);
    const badge = screen.getByText('3 left');
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge.className).toContain('bg-warn-bg');
  });

  it('EmptyState error is announced; neutral is not', () => {
    const { rerender } = render(
      <EmptyState icon={Inbox} tone="error" title="Couldn't load products" />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load products");
    rerender(<EmptyState icon={Inbox} title="All caught up" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'All caught up' })).toBeInTheDocument();
  });

  it('SkeletonList is announced once as loading', () => {
    render(<SkeletonList rows={3} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('Alert info is a status with an optional action', () => {
    render(
      <Alert variant="info" action={<AlertAction>Retry</AlertAction>}>
        This will be sent to the Owner for approval.
      </Alert>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('This will be sent to the Owner');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
