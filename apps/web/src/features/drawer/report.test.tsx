import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawerReportPage } from './DrawerReportPage';
import {
  drawerCsv,
  expectedFrom,
  movements,
  reopenDrawer,
  type DrawerEntryRecord,
  type DrawerRecord,
} from './report';

const state = vi.hoisted(() => ({
  record: null as unknown,
  entries: [] as unknown[],
  latestId: 'd1',
}));

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('./report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./report')>()),
  useDrawerDay: () => ({
    data: state.record ? [state.record] : [],
    loading: false,
    error: false,
  }),
  useDrawerEntries: () => ({ data: state.entries, loading: false, error: false }),
  useLatestDrawer: () => ({ data: [{ id: state.latestId }], loading: false, error: false }),
  reopenDrawer: vi.fn(() => Promise.resolve()),
}));

const CLOSED: DrawerRecord = {
  id: 'd1',
  businessDate: '2026-11-01',
  status: 'closed',
  openedByName: 'Jun',
  openedAt: new Date('2026-11-01T07:52:00+08:00'),
  openingCash: 1800,
  prefillCash: 2000,
  prefillDifference: -200,
  openingReason: 'Ice before opening',
  closedByName: 'Maricel',
  closedAt: new Date('2026-11-01T20:06:00+08:00'),
  countedCash: 1930,
  expectedCash: 1950,
  overShort: -20,
  closingNote: 'One coin under the tray',
};

const ENTRIES: DrawerEntryRecord[] = [
  {
    id: 'e1',
    type: 'cash_out',
    amount: 350,
    reason: 'expense',
    note: 'Ice, 2 sacks',
    userName: 'Jun',
    createdAt: new Date('2026-11-01T10:30:00+08:00'),
  },
  {
    id: 'e2',
    type: 'cash_in',
    amount: 500,
    reason: 'change_fund',
    note: null,
    userName: 'Liza',
    createdAt: new Date('2026-11-01T11:00:00+08:00'),
  },
];

function renderReport() {
  render(
    <MemoryRouter initialEntries={['/drawer/report?date=2026-11-01']}>
      <DrawerReportPage />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  state.record = CLOSED;
  state.entries = ENTRIES;
  state.latestId = 'd1';
  vi.mocked(reopenDrawer).mockClear();
});

describe('the day in order (SHIFT-04)', () => {
  it('lists opening, cash in and out, and closing, with signed amounts', () => {
    expect(
      movements(CLOSED, ENTRIES).map((move) => [move.type, move.note, move.by, move.amount]),
    ).toEqual([
      ['Opened', 'Ice before opening', 'Jun', 1800],
      ['Cash out', 'Expense · Ice, 2 sacks', 'Jun', -350],
      ['Cash in', 'Change fund', 'Liza', 500],
      ['Closed', 'One coin under the tray', 'Maricel', 1930],
    ]);
    expect(expectedFrom(CLOSED, ENTRIES)).toEqual({ cashIn: 500, cashOut: 350, expected: 1950 });
  });

  it('marks a drawer nobody counted', () => {
    const notCounted = { ...CLOSED, status: 'not_counted' as const, countedCash: null };
    expect(movements(notCounted, [])[1]).toMatchObject({ type: 'Not counted', amount: null });
  });

  it('downloads as CSV for Excel', () => {
    const csv = drawerCsv(CLOSED, ENTRIES);
    expect(csv.startsWith('﻿Date,Time,Type,Reason / note,By,Amount\r\n')).toBe(true);
    expect(csv).toContain('2026-11-01,10:30 AM,Cash out,"Expense · Ice, 2 sacks",Jun,-350.00');
    expect(csv).toContain('2026-11-01,8:06 PM,Closed,One coin under the tray,Maricel,1930.00');
  });
});

describe('the Owner’s drawer report', () => {
  it('shows the opening difference, expected, counted and the exact shortage', () => {
    renderReport();
    expect(screen.getByRole('heading', { name: 'Drawer · Nov 1' })).toBeInTheDocument();
    expect(screen.getByText('₱200.00 less than the last count · reason given')).toBeInTheDocument();
    expect(screen.getAllByText('₱1,950.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Short')).toBeInTheDocument();
    expect(screen.getByText('−₱20.00')).toBeInTheDocument();
    expect(screen.getByText('Why the opening differed: Ice before opening')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '−₱350.00' })).toBeInTheDocument();
  });

  it('reopens the latest drawer with a reason', async () => {
    const user = renderReport();
    await user.click(screen.getByRole('button', { name: 'Reopen this drawer' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Reopen drawer' }));
    expect(dialog.getByText('Give a reason.')).toBeInTheDocument();
    await user.type(dialog.getByLabelText('Reason'), 'A late sale to ring up');
    await user.click(dialog.getByRole('button', { name: 'Reopen drawer' }));
    expect(reopenDrawer).toHaveBeenCalledWith('d1', 'A late sale to ring up');
  });

  it('offers no reopen for an older drawer, or one still open', () => {
    state.latestId = 'd2';
    renderReport();
    expect(screen.queryByRole('button', { name: 'Reopen this drawer' })).toBeNull();
  });

  it('says when no drawer was opened that day', () => {
    state.record = null;
    renderReport();
    expect(screen.getByText('No drawer was opened on this day.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled();
  });
});
