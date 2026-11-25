import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '@/stores/session';
import { flagText, toRecord } from './clock';
import { OwnerAttendance } from './OwnerAttendance';
import { RecentDays } from './RecentDays';
import {
  daysCsv,
  fetchDays,
  flatDeduction,
  lateCost,
  PAGE,
  peopleIn,
  personDays,
  stateOf,
  summaryCsv,
  toDayRow,
  toReview,
  totalsFor,
  type Person,
} from './report';

type Json = Record<string, unknown>;

const db = vi.hoisted(() => ({
  attendance: [] as Record<string, unknown>[],
  profiles: [] as Record<string, unknown>[],
  failing: false,
  ranges: [] as [number, number][],
  watched: [] as { filter: string | undefined; change: (change: never) => void }[],
  saved: [] as { name: string; text: string }[],
}));

// A small stand-in for PostgREST: the filters, the order and the 300-row page are real.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: 'attendance' | 'profiles') => {
      let rows = [...db[table]];
      const keys: string[] = [];
      let page: [number, number] = [0, 299];
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => ((rows = rows.filter((r) => r[key] === value)), chain),
        is: (key: string, value: unknown) => (
          (rows = rows.filter((r) => (r[key] ?? null) === value)),
          chain
        ),
        neq: (key: string, value: unknown) => (
          (rows = rows.filter((r) => r[key] !== value)),
          chain
        ),
        gte: (key: string, value: string) => (
          (rows = rows.filter((r) => String(r[key]) >= value)),
          chain
        ),
        lte: (key: string, value: string) => (
          (rows = rows.filter((r) => String(r[key]) <= value)),
          chain
        ),
        order: (key: string) => (keys.push(key), chain),
        limit: (count: number) => ((page = [0, count - 1]), chain),
        range: (from: number, to: number) => (
          db.ranges.push([from, to]),
          (page = [from, Math.min(to, from + 299)]),
          chain
        ),
        then: (resolve: (value: unknown) => unknown) => {
          rows.sort((a, b) => {
            for (const key of keys) {
              const order = String(a[key]).localeCompare(String(b[key]));
              if (order !== 0) return order;
            }
            return 0;
          });
          return Promise.resolve(
            db.failing
              ? { data: null, error: { message: 'Failed to fetch' } }
              : { data: rows.slice(page[0], page[1] + 1), error: null },
          ).then(resolve);
        },
      };
      return chain;
    },
    // attendance_first_days(): each person's first worked day, as the SQL does it.
    rpc: (fn: string) => {
      if (fn !== 'attendance_first_days' || db.failing) {
        return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      }
      const first = new Map<string, string>();
      for (const row of db.attendance) {
        if (row.kind !== 'worked') continue;
        const user = String(row.user_id);
        const day = String(row.work_date);
        if (!first.has(user) || day < first.get(user)!) first.set(user, day);
      }
      return Promise.resolve({
        data: [...first].map(([user_id, first_day]) => ({ user_id, first_day })),
        error: null,
      });
    },
  },
}));
vi.mock('@/lib/realtime', () => ({
  watchTable: (
    _table: string,
    filter: string | undefined,
    { change }: { change: (change: never) => void },
  ) => {
    db.watched.push({ filter, change });
    return () => undefined;
  },
}));
vi.mock('@/features/catalog/export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/catalog/export')>()),
  download: (name: string, text: string) => db.saved.push({ name, text }),
}));

// Monday, Nov 23, 2026, 10:00 AM at the store.
const NOW = new Date('2026-11-23T10:00:00+08:00');
const TODAY = '2026-11-23';

let id = 0;
function worked(
  user: string,
  day: string,
  timeIn: string,
  timeOut: string | null,
  extra: Json = {},
): Json {
  return {
    id: `row-${String(++id).padStart(5, '0')}`,
    user_id: user,
    user_name: user === 'two' ? 'Test Two' : user,
    work_date: day,
    kind: 'worked',
    in_at: `${day}T${timeIn}:00+08:00`,
    out_at: timeOut && `${day}T${timeOut}:00+08:00`,
    late_minutes: 0,
    day_type: timeOut ? 'whole' : null,
    day_credit: timeOut ? 1 : null,
    early_minutes: 0,
    overtime_minutes: 0,
    flags: [],
    rules: { lateRule: 'none', lateFlat: 0 },
    note: null,
    ...extra,
  };
}

const person = (extra: Partial<Person> = {}): Person => ({
  id: 'two',
  name: 'Test Two',
  active: true,
  restWeekday: 0,
  since: '2026-10-01',
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  Object.assign(db, { failing: false, ranges: [], watched: [], saved: [], attendance: [] });
  db.profiles = [
    ['two', 'Test Two', 0, true],
    ['five', 'Test Special 5', null, true],
    ['gone', 'Old Staff', null, false],
  ].map(([key, name, rest, active]) => ({
    id: key,
    display_name: name,
    role: 'sales',
    active,
    rest_weekday: rest,
    created_at: '2026-10-01T09:00:00+08:00',
  }));
  useSession.setState({
    status: 'signedIn',
    user: {
      uid: 'boss',
      email: 'o@x.co',
      displayName: 'Owner',
      role: 'owner',
      branchId: 'main',
      secondFactor: true,
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a day with or without a record', () => {
  const state = (day: string, who = person(), first: string | null = '2026-11-01') =>
    stateOf(who, day, null, TODAY, first);

  it('is absent only on a working day after attendance began', () => {
    expect(state('2026-11-21')).toBe('absent');
    expect(state('2026-11-22')).toBe('rest'); // Sunday
    expect(state(TODAY)).toBe('not_in');
    expect(state(TODAY, person({ restWeekday: 1 }))).toBe('rest');
  });

  it('is "no record", never absent, before that or for a deactivated account', () => {
    expect(state('2026-11-21', person(), '2026-11-22')).toBe('none');
    expect(state('2026-11-21', person(), null)).toBe('none');
    expect(state('2026-11-21', person({ since: '2026-11-22' }))).toBe('none');
    expect(state('2026-11-21', person({ active: false }))).toBe('none');
    expect(state('2026-11-24')).toBe('none');
  });

  it('a row wins: in today, no time out after, marks, work on a rest day', () => {
    const of = (row: Json) =>
      stateOf(person(), String(row.work_date), toDayRow(row), TODAY, '2026-11-01');
    expect(of(worked('two', TODAY, '08:00', null))).toBe('in');
    expect(of(worked('two', '2026-11-21', '08:00', null))).toBe('no_out');
    expect(of(worked('two', '2026-11-22', '08:00', '18:00'))).toBe('done');
    expect(of({ user_id: 'two', work_date: TODAY, kind: 'absent' })).toBe('absent');
  });

  it('each person starts at their own first clock-in; a mark never moves it (Q-ATT-1)', () => {
    // Test Two first clocked in Fri Nov 20; Test Special 5 is a new hire who never has; the
    // Owner marked Test Two absent on Mon Nov 16, before their first clock-in.
    db.attendance = [
      worked('two', '2026-11-20', '08:00', '18:00'),
      { ...worked('two', '2026-11-16', '08:00', null), kind: 'absent', in_at: null },
    ];
    const rows = db.attendance.map(toDayRow);
    const firstIns = new Map([['two', '2026-11-20']]);
    const five = person({ id: 'five', name: 'Test Special 5', restWeekday: null });
    const days = personDays(
      [person(), five],
      rows,
      { from: '2026-11-16', to: TODAY },
      TODAY,
      firstIns,
    );
    const of = (who: string, day: string) =>
      days.find((each) => each.person.id === who && each.day === day)?.state;
    expect(of('two', '2026-11-16')).toBe('absent'); // the mark shows on its day
    expect(of('two', '2026-11-17')).toBe('none'); // but the start stays Nov 20
    expect(of('two', '2026-11-19')).toBe('none');
    expect(of('two', '2026-11-21')).toBe('absent'); // a working day after the start
    expect(of('five', '2026-11-21')).toBe('none'); // never clocked in: never "no time in"
    expect(of('five', TODAY)).toBe('not_in');
  });

  it('keeps a deactivated person who has days in the range', () => {
    const gone = person({ id: 'gone', name: 'Old Staff', active: false });
    expect(peopleIn([person(), gone], [])).toEqual([person()]);
    const row = toDayRow(worked('gone', '2026-11-20', '08:00', '18:00'));
    expect(peopleIn([person(), gone], [row]).map((each) => each.name)).toEqual([
      'Old Staff',
      'Test Two',
    ]);
  });
});

describe('totals and CSV', () => {
  const flat = { lateRule: 'flat', lateFlat: 50.1 };
  const rows = () =>
    [
      worked('two', '2026-11-18', '08:16', '17:30', {
        late_minutes: 16,
        early_minutes: 30,
        rules: flat,
      }),
      worked('two', '2026-11-19', '13:16', '18:20', {
        late_minutes: 16,
        overtime_minutes: 20,
        day_type: 'afternoon_half',
        day_credit: 0.5,
        rules: flat,
        flags: ['location_not_read'],
      }),
      worked('two', '2026-11-20', '08:20', null, { late_minutes: 20, rules: flat }),
      worked('two', TODAY, '07:54', '11:30', {
        day_type: 'morning_half',
        day_credit: 0.5,
        flags: ['edited'],
        note: '=HYPERLINK("x"), left sick',
      }),
    ].map(toDayRow);
  const days = () =>
    personDays(
      [person()],
      rows(),
      { from: '2026-11-17', to: TODAY },
      TODAY,
      new Map([[person().id, '2026-11-18']]),
    );

  it('adds the days up; no time out counts for nothing', () => {
    expect(totalsFor(person(), days())).toEqual({
      person: person(),
      credit: 2,
      whole: 1,
      morningHalf: 1,
      afternoonHalf: 1,
      lateCount: 3,
      lateMinutes: 52,
      earlyCount: 1,
      earlyMinutes: 30,
      overtimeMinutes: 20,
      absent: 1, // Nov 21
      rest: 1, // Nov 22
      noOut: 1,
      toReview: 1, // "edited" is the Owner's own change
      flatDeductions: 100.2, // two finished late days, not the open one
      minutesToPrice: 0,
    });
  });

  it('gives minutes, not pesos, when late is priced in payroll', () => {
    const row = toDayRow(
      worked('two', '2026-11-18', '08:16', '18:00', {
        late_minutes: 16,
        rules: { lateRule: 'minutes', lateFlat: 50 },
      }),
    );
    expect(flatDeduction(row)).toBe(0);
    expect(toReview(row)).toEqual([]);
    const one = personDays(
      [person()],
      [row],
      { from: row.workDate, to: row.workDate },
      TODAY,
      new Map([[row.userId, row.workDate]]),
    );
    expect(totalsFor(person(), one)).toMatchObject({ minutesToPrice: 16, flatDeductions: 0 });
  });

  it('writes every day, leaving out "no record", safe for Excel', () => {
    const text = daysCsv(days());
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.trim().split('\r\n');
    // Heading + Nov 18..23; Nov 17 is before the first record.
    expect(lines).toHaveLength(7);
    expect(lines[1]).toBe(
      '2026-11-18,Test Two,Whole day,8:16 AM,5:30 PM,1,16,30,0,Flat amount,50.1,,',
    );
    expect(lines[3]).toBe('2026-11-20,Test Two,No time out,8:20 AM,,,20,,,Flat amount,,,');
    expect(lines[4]).toBe('2026-11-21,Test Two,Absent · no time in,,,,,,,,,,');
    expect(lines[6]).toContain(`"'=HYPERLINK(""x""), left sick"`);
  });

  it('writes one summary line per person', () => {
    const text = summaryCsv([totalsFor(person(), days())], { from: '2026-11-17', to: TODAY });
    expect(text.trim().split('\r\n')[1]).toBe(
      'Test Two,2026-11-17,2026-11-23,2,1,1,1,3,52,1,30,20,1,1,1,1,100.2,0',
    );
  });

  it('marks a time out after midnight as the next day', () => {
    const row = worked('two', '2026-11-20', '08:00', '18:00', {
      out_at: '2026-11-21T00:10:00+08:00',
    });
    const text = daysCsv(
      personDays(
        [person()],
        [toDayRow(row)],
        { from: '2026-11-20', to: '2026-11-20' },
        TODAY,
        new Map(),
      ),
    );
    expect(text).toContain('12:10 AM (next day)');
  });
});

describe('what a late day costs: one source (ATT-06)', () => {
  const day = (rule: 'none' | 'minutes' | 'flat', timeOut: string | null, late = 40) =>
    toDayRow(
      worked('two', '2026-11-21', '08:40', timeOut, {
        late_minutes: late,
        rules: { lateRule: rule, lateFlat: 50 },
      }),
    );

  it('flat: the amount once the day is closed; "expected" while still in', () => {
    expect(lateCost(day('flat', '18:00'))).toEqual({ kind: 'flat', amount: 50 });
    expect(lateCost(day('flat', null))).toEqual({ kind: 'none' }); // counts nothing yet
    expect(lateCost(day('flat', null), { open: true })).toEqual({ kind: 'flat', amount: 50 });
    expect(flatDeduction(day('flat', '18:00'))).toBe(50);
    expect(flatDeduction(day('flat', null))).toBe(0);
  });

  it('per minute: minutes for payroll to price, never pesos (no daily rates before step 14)', () => {
    expect(lateCost(day('minutes', '18:00'))).toEqual({ kind: 'minutes', minutes: 40 });
    expect(lateCost(day('minutes', null), { open: true })).toEqual({
      kind: 'minutes',
      minutes: 40,
    });
    expect(flatDeduction(day('minutes', '18:00'))).toBe(0);
  });

  it('nothing: no deduction setting, not late, or not a worked day', () => {
    expect(lateCost(day('none', '18:00'))).toEqual({ kind: 'none' });
    expect(lateCost(day('flat', '18:00', 0))).toEqual({ kind: 'none' });
    expect(lateCost(null, { open: true })).toEqual({ kind: 'none' });
    expect(
      lateCost(toDayRow({ ...worked('two', '2026-11-21', '08:00', null), kind: 'absent' }), {
        open: true,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('Summary and the CSV use the same numbers', () => {
    const days = personDays(
      [person()],
      [day('flat', '18:00')],
      { from: '2026-11-21', to: '2026-11-21' },
      TODAY,
      new Map([['two', '2026-11-01']]),
    );
    expect(totalsFor(person(), days).flatDeductions).toBe(50);
    expect(daysCsv(days).split(/\r?\n/)[1]?.split(',')).toContain('50');
  });
});

describe('the location flag', () => {
  const record = (extra: Json) =>
    toRecord({
      in_distance_m: 18,
      in_accuracy_m: 9,
      out_distance_m: 900,
      out_accuracy_m: 400,
      ...extra,
    });

  it('quotes the reading that was poor', () => {
    expect(
      flagText(
        'location_not_verified',
        record({ in_location: 'ok', out_location: 'not_verified' }),
      ),
    ).toBe('Location not verified: 900 m away, accuracy 400 m');
    expect(
      flagText(
        'location_not_verified',
        record({ in_location: 'not_verified', out_location: 'ok' }),
      ),
    ).toBe('Location not verified: 18 m away, accuracy 9 m');
  });
});

describe('loading the days', () => {
  it('reads past the 300-row page', async () => {
    db.attendance = Array.from({ length: PAGE * 2 + 5 }, () =>
      worked('two', '2026-11-20', '08:00', '18:00'),
    );
    const { data } = await fetchDays('2026-11-20', '2026-11-20');
    expect(new Set(data!.map((row) => row.id)).size).toBe(605);
    expect(db.ranges).toEqual([
      [0, 299],
      [300, 599],
      [600, 899],
    ]);
  });

  it('gives no data rather than part of it on an error', async () => {
    db.failing = true;
    expect((await fetchDays('2026-11-20', '2026-11-20')).data).toBeNull();
  });
});

function showOwner(url = '/attendance') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <OwnerAttendance />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const tile = (label: string) =>
  within(screen.getByLabelText('Today’s counts')).getByText(label).nextElementSibling;

describe('the Owner’s board, history and summary (ATT-14)', () => {
  it('counts today and follows changes', async () => {
    db.attendance = [
      worked('two', '2026-11-21', '08:00', null),
      worked('two', '2026-11-20', '08:00', '18:00'), // finished: not listed
      worked('five', TODAY, '08:16', null, { late_minutes: 16, flags: ['location_not_read'] }),
    ];
    showOwner();
    const board = within(await screen.findByRole('region', { name: 'Today’s board' }));
    const shown = board.getAllByRole('link');
    expect(shown).toHaveLength(2); // not the deactivated one
    expect(shown[0]).toHaveTextContent('Test Special 5');
    // One tag, then "+1" for the location flag (cleanup round 1).
    expect(shown[0]).toHaveTextContent('Late 16 min+1');
    expect(shown[0]).not.toHaveTextContent('Location not read');
    expect(tile('Clocked in')).toHaveTextContent('1');
    expect(tile('Late')).toHaveTextContent('1');
    expect(tile('Flagged')).toHaveTextContent('1');
    expect(tile('Not in yet')).toHaveTextContent('1');
    expect(tile('No time out')).toHaveTextContent('1');
    expect(db.watched.map((watch) => watch.filter)).toEqual([`work_date=eq.${TODAY}`]);

    db.attendance.push(worked('two', TODAY, '09:59', null));
    act(() => db.watched[0]!.change({ eventType: 'INSERT', new: {}, old: {} } as never));
    await vi.waitFor(() => expect(tile('Not in yet')).toHaveTextContent('0'));
    expect(tile('Clocked in')).toHaveTextContent('2');
  });

  it('Fix opens that person’s day', async () => {
    db.attendance = [worked('two', '2026-11-21', '08:00', null)];
    const user = showOwner();
    await user.click(await screen.findByRole('link', { name: 'Fix Test Two, Sat, Nov 21' }));
    await vi.waitFor(() => expect(screen.getByLabelText('Person')).toHaveValue('two'));
    expect(screen.getByLabelText('Day')).toHaveValue('2026-11-21');
  });

  it('a board row opens that person’s history', async () => {
    db.attendance = [
      worked('two', '2026-11-20', '08:00', '18:00', { note: 'Forgot', flags: ['edited'] }),
      worked('five', '2026-11-20', '08:00', '18:00'),
    ];
    const user = showOwner();
    await user.click(await screen.findByRole('link', { name: /Test Two/ }));
    const days = within(await screen.findByRole('list', { name: 'Days' }));
    expect(screen.getByLabelText('Person')).toHaveValue('two');
    expect(days.getAllByRole('listitem')).toHaveLength(15);
    expect(days.queryByText('Changed by the Owner: “Forgot”')).toBeNull();
    await user.click(days.getByRole('button', { name: '1 more for Fri, Nov 20' }));
    expect(days.getByText('Changed by the Owner: “Forgot”')).toBeInTheDocument();
    expect(days.getAllByText('Whole day')).toHaveLength(1);
    expect(days.getByText('No time in')).toBeInTheDocument(); // Sat Nov 21, with its red tag
    expect(days.getByText('Absent')).toBeInTheDocument();
    expect(days.getByText('Rest day')).toBeInTheDocument(); // Sun Nov 22
    expect(days.getAllByText('No record')).toHaveLength(11);
    await user.click(screen.getByRole('button', { name: 'Download this history (CSV)' }));
    expect(db.saved[0]!.name).toBe('attendance-test-two-2026-11-09-to-2026-11-23.csv');
    expect(db.saved[0]!.text).not.toContain('Test Special 5');
  });

  it('the summary downloads what it shows', async () => {
    db.attendance = [worked('two', '2026-11-20', '08:00', '18:00')];
    const user = showOwner('/attendance?tab=summary&from=2026-11-20&to=2026-11-21');
    const card = within(await screen.findByRole('region', { name: 'Test Two' }));
    expect(card.getByText('Absent').nextElementSibling).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'Summary (CSV)' }));
    expect(db.saved[0]!.text).toContain('Test Two,2026-11-20,2026-11-21,1,1,0,0,');
    await user.click(screen.getByRole('button', { name: 'Every day (CSV)' }));
    expect(db.saved[1]!.name).toBe('attendance-days-2026-11-20-to-2026-11-21.csv');
  });

  it.each([
    ['from=2026-11-22&to=2026-11-20', /first day on or before/],
    ['from=2026-11-20&to=2026-11-24', /no day after today/],
    ['from=2025-11-22&to=2026-11-23', /a year or less/],
  ])('refuses %s', async (query, message) => {
    showOwner(`/attendance?tab=summary&${query}`);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Summary (CSV)' })).toBeNull();
  });

  it('shows no totals without internet', async () => {
    db.failing = true;
    showOwner('/attendance?tab=summary');
    expect(await screen.findByText('Attendance needs internet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CSV/ })).toBeNull();
  });
});

describe('staff’s own days (ATT-15)', () => {
  it('shows 7 days, then 30, and never guesses "absent"', async () => {
    db.attendance = [
      worked('two', '2026-11-21', '08:00', null),
      worked('two', '2026-11-20', '08:16', '18:00', {
        late_minutes: 16,
        rules: { lateRule: 'flat', lateFlat: 50 },
      }),
      worked('five', '2026-11-19', '08:00', '18:00'),
    ];
    render(<RecentDays uid="two" version="" person={null} />);
    const list = within(await screen.findByRole('region', { name: 'My days' }));
    expect(list.getAllByRole('listitem')).toHaveLength(7);
    expect(list.getByText('Not in yet')).toBeInTheDocument();
    expect(list.getByText('No time out')).toBeInTheDocument();
    // Money is never folded into "+N".
    expect(list.getByText('Late 16 min · −₱50.00')).toBeInTheDocument();
    expect(list.getAllByText('Whole day')).toHaveLength(1);
    // Before the server has answered once, nothing is known: no day is called absent.
    expect(list.queryByText(/Absent/)).toBeNull();
    await userEvent.setup().click(list.getByRole('button', { name: 'Load more' }));
    expect(list.getAllByRole('listitem')).toHaveLength(30);
  });

  it('works each day out as the Owner’s board does (the Nov 24 step 11 test)', async () => {
    db.attendance = [
      worked('two', '2026-11-21', '08:00', null),
      worked('two', '2026-11-20', '08:00', '18:00'),
      // The Owner's mark: shown as Absent with its reason.
      {
        ...worked('two', '2026-11-17', '08:00', null),
        kind: 'absent',
        in_at: null,
        note: 'Did not come',
      },
    ];
    render(
      <RecentDays
        uid="two"
        version=""
        person={{ firstIn: '2026-11-20', restWeekday: 0, since: '2026-11-01' }}
      />,
    );
    const list = within(await screen.findByRole('region', { name: 'My days' }));
    const items = list.getAllByRole('listitem').map((item) => item.textContent);
    expect(items[0]).toContain('Not in yet'); // Mon Nov 23, today
    expect(items[1]).toContain('Rest day'); // Sun Nov 22, the usual rest day
    expect(items[2]).toContain('No time out'); // Sat Nov 21
    expect(items[3]).toContain('Whole day'); // Fri Nov 20
    // Before the first clock-in (Fri Nov 20): no record, never absent (Q-ATT-1, Nov 25).
    expect(items[4]).toContain('No record'); // Thu Nov 19
    expect(items[5]).toContain('No record'); // Wed Nov 18
    expect(items[4]).not.toContain('Absent');
    expect(items[6]).toContain('AbsentMarked by the Owner'); // Tue Nov 17: the Owner's mark
    expect(items[6]).not.toContain('Did not come');
    const user = userEvent.setup();
    await user.click(list.getByRole('button', { name: '1 more for Tue, Nov 17' }));
    expect(list.getByText('Reason: “Did not come”')).toBeInTheDocument();
    await user.click(list.getByRole('button', { name: 'Load more' }));
    // The mark shows on its own day, but never moves the start: earlier days stay no record.
    expect(list.getAllByRole('listitem')[7]?.textContent).toContain('No record');
  });

  it('listens only to the staff member’s own days', async () => {
    render(<RecentDays uid="two" version="" person={null} />);
    await screen.findByRole('region', { name: 'My days' });
    expect(db.watched.map((watch) => watch.filter)).toEqual(['user_id=eq.two']);
  });
});
