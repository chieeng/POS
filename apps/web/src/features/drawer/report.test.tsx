import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawerReportPage } from './DrawerReportPage';
import {
  countedLater,
  drawerCsv,
  earlierCount,
  expectedFrom,
  movements,
  reopenDrawer,
  type DrawerEntryRecord,
  type DrawerEvent,
  type DrawerRecord,
  type DrawerSales,
} from './report';

const state = vi.hoisted(() => ({
  record: null as unknown,
  entries: [] as unknown[],
  events: [] as unknown[],
  latestId: 'd1',
  sales: null as unknown,
  salesError: false,
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
  useDrawerEvents: () => ({ data: state.events, loading: false, error: false }),
  useLatestDrawer: () => ({ data: [{ id: state.latestId }], loading: false, error: false }),
  useDrawerSales: () => ({
    data: state.sales ? [state.sales] : [],
    loading: false,
    error: state.salesError,
  }),
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
  state.events = [];
  state.latestId = 'd1';
  state.sales = NO_SALES;
  state.salesError = false;
  vi.mocked(reopenDrawer).mockClear();
});

const NO_SALES: DrawerSales = {
  count: 0,
  total: 0,
  discounts: 0,
  methods: [],
  salespeople: [],
  flaggedCount: 0,
  flagged: [],
};

/** The step 9 selling test: ₱1,000 opening, ₱318 in cash sales, ₱90 GCash, ₱20 Maya. */
const SALES: DrawerSales = {
  count: 6,
  total: 428,
  discounts: 0,
  methods: [
    { method: 'cash', count: 5, amount: 318 },
    { method: 'gcash', count: 1, amount: 90 },
    { method: 'maya', count: 1, amount: 20 },
  ],
  salespeople: [
    { name: 'Test Two', count: 5, total: 383 },
    { name: 'Test Special 5', count: 1, total: 45 },
  ],
  flaggedCount: 1,
  flagged: [
    {
      id: 's6',
      receiptNo: 'TT-20261107-KY96-9',
      salesperson: 'Test Two',
      madeAt: new Date('2026-11-07T20:15:00+08:00'),
      syncedAt: new Date('2026-11-08T08:02:00+08:00'),
      total: 45,
      flags: ['late'],
      madeOffline: true,
    },
  ],
};

const OPEN: DrawerRecord = {
  ...CLOSED,
  businessDate: '2026-11-08',
  status: 'open',
  openingCash: 1000,
  prefillCash: null,
  prefillDifference: null,
  openingReason: null,
  closedByName: null,
  closedAt: null,
  countedCash: null,
  expectedCash: null,
  overShort: null,
  closingNote: null,
};

describe('the drawer’s sales (SHIFT-04, POS-14)', () => {
  it('counts cash sales in the expected cash', () => {
    expect(expectedFrom(OPEN, [], 318)).toEqual({
      cashIn: 0,
      cashOut: 0,
      cashSales: 318,
      expected: 1318,
    });
  });

  it('shows sales by method and salesperson, and the late sale to check', () => {
    state.record = OPEN;
    state.entries = [];
    state.sales = SALES;
    renderReport();
    expect(screen.getAllByText('₱1,318.00').length).toBe(2);
    expect(screen.getByText('Opening + cash sales + cash in − cash out')).toBeInTheDocument();
    expect(screen.getByText('Not in the drawer: GCash ₱90.00 · Maya ₱20.00')).toBeInTheDocument();
    const sales = within(screen.getByRole('region', { name: 'Sales' }));
    for (const [label, value] of [
      ['6 sales', '₱428.00'],
      ['Cash · 5 sales', '₱318.00'],
      ['GCash · 1 sale', '₱90.00'],
      ['Maya · 1 sale', '₱20.00'],
      ['Test Two · 5 sales', '₱383.00'],
      ['Test Special 5 · 1 sale', '₱45.00'],
    ]) {
      expect(sales.getByText(label!).nextSibling).toHaveTextContent(value!);
    }
    expect(sales.getByRole('heading', { name: 'Sales to check · 1' })).toBeInTheDocument();
    expect(sales.getByText('TT-20261107-KY96-9')).toBeInTheDocument();
    expect(sales.getByText('Late: made on an earlier day')).toBeInTheDocument();
    expect(
      sales.getByText(/Test Two · made Nov 7, 8:15 PM offline, reached the store Nov 8, 8:02 AM/),
    ).toBeInTheDocument();
  });

  it('shows no expected figure for an open drawer until its sales load', () => {
    state.record = OPEN;
    state.entries = [];
    state.sales = null;
    state.salesError = true;
    renderReport();
    expect(screen.getAllByText('Needs internet').length).toBeGreaterThan(0);
    expect(screen.getByText('The sales could not be loaded.')).toBeInTheDocument();
    // Not the opening cash alone, which would look like a shortage of every cash sale.
    expect(screen.getByText('Expected so far').nextSibling).toHaveTextContent('Needs internet');
  });

  it('a closed drawer keeps the server’s expected cash', () => {
    state.sales = null;
    renderReport();
    expect(screen.getAllByText('₱1,950.00').length).toBeGreaterThan(0);
  });

  it('shows the discounts given, and lists them in the CSV (POS-03)', () => {
    state.record = OPEN;
    state.entries = [];
    state.sales = { ...SALES, discounts: 13.5 };
    renderReport();
    const sales = within(screen.getByRole('region', { name: 'Sales' }));
    expect(sales.getByText('Discounts given').nextSibling).toHaveTextContent('−₱13.50');
    expect(drawerCsv(OPEN, [], [], { ...SALES, discounts: 13.5 })).toContain(
      '2026-11-08,,Discounts given,Preset discounts and deals,,13.50',
    );
    expect(drawerCsv(OPEN, [], [], SALES)).not.toContain('Discounts given');
  });

  it('puts the sales in the CSV', () => {
    const csv = drawerCsv(OPEN, [], [], SALES);
    expect(csv).toContain('2026-11-08,,Sales,6 sales,,428.00');
    expect(csv).toContain('2026-11-08,,Cash sales,In the drawer,,318.00');
    expect(csv).toContain('2026-11-08,,GCash,Not in the drawer,,90.00');
    expect(csv).toContain('2026-11-08,,Maya,Not in the drawer,,20.00');
    expect(csv).toContain('2026-11-08,,Sold by Test Two,5 sales,,383.00');
    expect(csv).toContain(
      '2026-11-08,,Check TT-20261107-KY96-9,Test Two · Late: made on an earlier day,,45.00',
    );
    expect(csv).toContain('2026-11-08,,Expected,So far,,1318.00');
  });
});

describe('the day in order (SHIFT-04)', () => {
  it('lists opening, cash in and out, and closing, with signed amounts', () => {
    expect(
      movements(CLOSED, ENTRIES).map((move) => [move.type, move.note, move.by, move.amount]),
    ).toEqual([
      ['Opened', 'Ice before opening', 'Jun', 1800],
      ['Cash out', 'Expense · Ice, 2 sacks', 'Jun', -350],
      ['Cash in', 'Change fund', 'Liza', 500],
      ['Closed', 'Short ₱20.00 · One coin under the tray', 'Maricel', 1930],
    ]);
    expect(expectedFrom(CLOSED, ENTRIES)).toEqual({
      cashIn: 500,
      cashOut: 350,
      cashSales: 0,
      expected: 1950,
    });
  });

  it('says when a drawer was counted the next morning (Nov 13)', () => {
    const late = { ...CLOSED, closedAt: new Date('2026-11-02T07:40:00+08:00') };
    expect(movements(late, []).at(-1)).toMatchObject({
      type: 'Closed',
      note: 'Short ₱20.00 · Counted the next morning (Nov 2) · One coin under the tray',
    });
    expect(countedLater('2026-11-01', new Date('2026-11-01T20:06:00+08:00'))).toBeNull();
  });

  it('marks a drawer nobody counted', () => {
    const notCounted = { ...CLOSED, status: 'not_counted' as const, countedCash: null };
    expect(movements(notCounted, [])[1]).toMatchObject({ type: 'Not counted', amount: null });
  });

  it('downloads as CSV for Excel', () => {
    const csv = drawerCsv(CLOSED, ENTRIES);
    expect(csv.startsWith('﻿Date,Time,Type,Reason / note,By,Amount\r\n')).toBe(true);
    expect(csv).toContain('2026-11-01,10:30 AM,Cash out,"Expense · Ice, 2 sacks",Jun,-350.00');
    expect(csv).toContain(
      '2026-11-01,8:06 PM,Closed,Short ₱20.00 · One coin under the tray,Maricel,1930.00',
    );
    expect(csv).toMatch(
      /2026-11-01,,Expected,,,1950\.00\r\n2026-11-01,,Counted,,,1930\.00\r\n2026-11-01,,Over\/short,Short,,-20\.00\r\n$/,
    );
  });

  it('ends a drawer nobody counted with "Not counted"', () => {
    const notCounted = {
      ...CLOSED,
      status: 'not_counted' as const,
      countedCash: null,
      overShort: null,
      closedByName: null,
    };
    // The By column stays empty: the closing name only opened the next drawer.
    expect(drawerCsv({ ...notCounted, closedByName: 'Test Special 5' }, ENTRIES)).toContain(
      "8:06 PM,Not counted,Closed when Test Special 5 opened Nov 1's drawer,,\r\n",
    );
    expect(drawerCsv(notCounted, ENTRIES)).toMatch(
      /Expected,,,1950\.00\r\n2026-11-01,,Counted,Not counted,,\r\n2026-11-01,,Over\/short,Not counted,,\r\n$/,
    );
  });
});

describe('a drawer that was reopened (SHIFT-04)', () => {
  const REOPENED: DrawerRecord = {
    ...CLOSED,
    status: 'not_counted',
    closedByName: 'Jun',
    closedAt: new Date('2026-11-02T07:50:00+08:00'),
    countedCash: null,
    overShort: null,
    closingNote: null,
  };
  const EVENTS: DrawerEvent[] = [
    {
      id: 'c1',
      kind: 'closed',
      at: new Date('2026-11-01T19:33:00+08:00'),
      by: 'Maricel',
      counted: 1140,
      overShort: -10,
      note: null,
    },
    {
      id: 'r1',
      kind: 'reopened',
      at: new Date('2026-11-01T19:55:00+08:00'),
      by: 'Rosario',
      counted: null,
      overShort: null,
      note: 'test reopen',
    },
  ];

  it('keeps the set-aside count and the reopen with its reason, in time order', () => {
    expect(movements(REOPENED, [], EVENTS).map((m) => [m.type, m.note, m.by, m.amount])).toEqual([
      ['Opened', 'Ice before opening', 'Jun', 1800],
      ['Closed', 'Short ₱10.00', 'Maricel', 1140],
      ['Reopened', 'Reason: test reopen', 'Rosario', null],
      // Jun only opened Nov 2's drawer; nobody counted this one (reviewer, Nov 13).
      ['Not counted', "Closed when Jun opened Nov 2's drawer", '', null],
    ]);
    const csv = drawerCsv(REOPENED, [], EVENTS);
    expect(csv).toContain('2026-11-01,7:33 PM,Closed,Short ₱10.00,Maricel,1140.00');
    expect(csv).toContain('2026-11-01,7:55 PM,Reopened,Reason: test reopen,Rosario,');
  });

  it('lists a recount after the first close, and does not repeat the closing', () => {
    const recount: DrawerEvent = {
      ...EVENTS[0]!,
      id: 'c2',
      at: new Date('2026-11-01T20:10:00+08:00'),
      counted: 1150,
      overShort: 0,
    };
    const closed = { ...REOPENED, status: 'closed' as const, countedCash: 1150, overShort: 0 };
    expect(
      movements(closed, [], [...EVENTS, recount]).map((m) => [m.type, m.note, m.amount]),
    ).toEqual([
      ['Opened', 'Ice before opening', 1800],
      ['Closed', 'Short ₱10.00', 1140],
      ['Reopened', 'Reason: test reopen', null],
      ['Closed', 'Exact', 1150],
    ]);
  });

  it('keeps the earlier result in the headline, the banner and the CSV', () => {
    state.record = REOPENED;
    state.entries = [];
    state.events = EVENTS;
    renderReport();
    expect(screen.getByText('Earlier count before the reopen: short ₱10.00')).toBeInTheDocument();
    expect(
      screen.getByText(
        /again after it was reopened\. Earlier count before the reopen: short ₱10\.00\./,
      ),
    ).toBeInTheDocument();
    expect(drawerCsv(REOPENED, [], EVENTS)).toContain(
      '2026-11-01,,Over/short,Not counted · Earlier count before the reopen: short ₱10.00,,\r\n',
    );
  });

  it('reads the last count’s result: over, exact, and nothing without a count', () => {
    const first = EVENTS[0]!;
    expect(earlierCount(REOPENED, [{ ...first, overShort: 25 }])).toBe(
      'Earlier count before the reopen: over ₱25.00',
    );
    expect(earlierCount(REOPENED, [{ ...first, overShort: 0 }])).toBe(
      'Earlier count before the reopen: exact',
    );
    expect(
      earlierCount(REOPENED, [
        { ...first, overShort: -10 },
        { ...first, id: 'c2', overShort: 5 },
      ]),
    ).toBe('Earlier count before the reopen: over ₱5.00');
    expect(earlierCount(REOPENED, [])).toBeNull();
    expect(earlierCount(CLOSED, EVENTS)).toBeNull();
  });

  it('shows the rows, and doesn’t say the drawer was never counted', () => {
    state.record = REOPENED;
    state.entries = [];
    state.events = EVENTS;
    renderReport();
    expect(screen.getByText('Reason: test reopen')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '₱1,140.00' })).toBeInTheDocument();
    expect(screen.getByText('Not counted again after the reopen')).toBeInTheDocument();
    expect(screen.getByText(/Nobody counted this drawer again/)).toBeInTheDocument();
    expect(screen.queryByText('Never counted')).toBeNull();
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
