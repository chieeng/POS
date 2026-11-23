import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionUser } from '@/stores/session';
import { AttendancePage } from './AttendancePage';
import { clockText, manilaDay, refusalText, toToday } from './clock';
import { describeFixError } from './fixes';

type Json = Record<string, unknown>;

const server = vi.hoisted(() => ({
  today: null as Json | null,
  calls: [] as { fn: string; args: Json }[],
  error: null as { message: string; details?: string } | null,
  queued: [] as Json[],
  outbox: [] as Json[],
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    // The Owner's staff list (profiles), and no attendance days: one chain, any filters.
    from: (table: string) => {
      const chain = {
        select: () => chain,
        neq: () => chain,
        eq: () => chain,
        is: () => chain,
        gte: () => chain,
        lte: () => chain,
        limit: () => chain,
        range: () => chain,
        order: () => chain,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data:
              table !== 'profiles'
                ? []
                : [
                    {
                      id: 'u2',
                      display_name: 'Test Two',
                      role: 'sales',
                      active: true,
                      rest_weekday: null,
                    },
                    {
                      id: 'u5',
                      display_name: 'Test Special 5',
                      role: 'special_sales',
                      active: true,
                      rest_weekday: 0,
                    },
                  ],
            error: null,
          }).then(resolve),
      };
      return chain;
    },
    rpc: (fn: string, args: Json) => {
      server.calls.push({ fn, args });
      if (fn === 'attendance_today') return Promise.resolve({ data: server.today, error: null });
      if (server.error) return Promise.resolve({ data: null, error: server.error });
      return Promise.resolve({ data: {}, error: null });
    },
  },
}));
vi.mock('@/lib/realtime', () => ({ watchTable: () => () => undefined }));
vi.mock('@/lib/outbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/outbox')>()),
  watchOutboxClock: (_uid: string, onChange: (items: unknown[]) => void) => {
    onChange(server.outbox);
    return () => undefined;
  },
  addToOutbox: (item: Json) => {
    server.queued.push(item);
    return Promise.resolve();
  },
}));

const day = manilaDay(new Date());
const RULES = {
  latestIn: 480,
  ownTime: false,
  afternoonStart: 780,
  graceMinutes: 15,
  afternoonLine: 720,
  morningOutLine: 900,
  earliestOut: 1080,
};
const todayWith = (record: Json | null, extra: Json = {}): Json => ({
  today: day,
  canClock: true,
  record,
  rules: RULES,
  storeLocationSet: true,
  ...extra,
});
const RECORD = {
  work_date: day,
  in_at: `${day}T07:54:00+08:00`,
  out_at: null,
  start_type: 'morning',
  late_minutes: 0,
  day_type: null,
  early_minutes: 0,
  overtime_minutes: 0,
  flags: [],
  in_distance_m: 18,
};

function signInAs(role: SessionUser['role']) {
  useSession.setState({
    status: 'signedIn',
    user: {
      uid: 'u2',
      email: 'u@x.co',
      displayName: 'Test Two',
      role,
      branchId: 'main',
      secondFactor: role === 'owner',
    },
  });
}

function renderPage() {
  render(
    <MemoryRouter>
      <AttendancePage />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

const calls = (fn: string) => server.calls.filter((call) => call.fn === fn);

let geo: 'ok' | 'denied' = 'ok';
beforeEach(() => {
  server.today = todayWith(null);
  server.calls = [];
  server.error = null;
  server.queued = [];
  server.outbox = [];
  geo = 'ok';
  localStorage.clear();
  signInAs('sales');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (
        ok: (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void,
        fail: (e: { code: number; PERMISSION_DENIED: number; TIMEOUT: number }) => void,
      ) =>
        geo === 'ok'
          ? ok({ coords: { latitude: 14.5862, longitude: 121.176, accuracy: 12 } })
          : fail({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 }),
    },
  });
});
afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('the day’s rules', () => {
  it('reads minutes after midnight as clock times', () => {
    expect(clockText(480)).toBe('8:00 AM');
    expect(clockText(720)).toBe('12:00 PM');
    expect(clockText(1080)).toBe('6:00 PM');
  });

  it('reads the server’s answer', () => {
    expect(toToday(todayWith(RECORD)).record).toMatchObject({
      lateMinutes: 0,
      startType: 'morning',
      inDistanceM: 18,
    });
  });
});

describe('My attendance (ATT-01)', () => {
  it('shows today’s times and clocks in with the location', async () => {
    const user = renderPage();
    const rules = within(await screen.findByRole('region', { name: 'Today’s times' }));
    expect(rules.getByText(/in by 8:00 AM, 15-minute grace/)).toBeInTheDocument();
    expect(rules.getByText(/in from 12:00 PM, by 1:00 PM/)).toBeInTheDocument();
    expect(
      rules.getByText(/from 6:00 PM \(before 3:00 PM is a morning half day\)/),
    ).toBeInTheDocument();
    server.today = todayWith(RECORD);
    await user.click(screen.getByRole('button', { name: 'Clock in' }));
    expect(calls('clock_in')[0]?.args).toMatchObject({
      p: { deviceAt: null, lat: 14.5862, lng: 121.176, accuracy: 12 },
    });
    expect(await screen.findByText('Time in recorded.')).toBeInTheDocument();
    expect(await screen.findByText('On time')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clock out' })).toBeInTheDocument();
  });

  it('away from the store: says how far', async () => {
    server.error = { message: 'outside_radius', details: '340' };
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Clock in' }));
    expect(
      await screen.findByText(
        /You’re 340 m from the store. Clock-in and clock-out work only at the store./,
      ),
    ).toBeInTheDocument();
  });

  it('no location: still clocks in, and says the Owner will check', async () => {
    geo = 'denied';
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Clock in' }));
    expect(calls('clock_in')[0]?.args).toMatchObject({ p: { lat: null, lng: null } });
    expect(
      await screen.findByText(
        'Time in recorded. Your location couldn’t be read, so the Owner will check it.',
      ),
    ).toBeInTheDocument();
  });

  it('offline: the time in waits on this phone', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Clock in' }));
    expect(calls('clock_in')).toEqual([]);
    expect(server.queued[0]).toMatchObject({ kind: 'clock_in', uid: 'u2' });
    expect((server.queued[0]?.payload as Json).deviceAt).toEqual(expect.any(String));
    expect(
      await screen.findByText('Time in saved on this phone. It’s sent when you’re back online.'),
    ).toBeInTheDocument();
  });

  it('clocks out after a confirmation, then shows the day', async () => {
    server.today = todayWith({ ...RECORD, late_minutes: 16 });
    const user = renderPage();
    expect(await screen.findByText('Late by 16 min')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clock out' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(
      dialog.getByText('This ends your day. You can’t clock in again today.'),
    ).toBeInTheDocument();
    server.today = todayWith({
      ...RECORD,
      late_minutes: 16,
      out_at: `${day}T17:30:00+08:00`,
      day_type: 'whole',
      early_minutes: 30,
    });
    await user.click(dialog.getByRole('button', { name: 'Clock out' }));
    expect(calls('clock_out')).toHaveLength(1);
    expect(await screen.findByText('Whole day')).toBeInTheDocument();
    expect(screen.getByText('Early out 30 min')).toBeInTheDocument();
    expect(
      screen.getByText('Done for today. If a time is wrong, ask the Owner to fix it.'),
    ).toBeInTheDocument();
  });

  it('the Owner doesn’t clock in unless turned on, and fixes days instead', async () => {
    signInAs('owner');
    server.today = todayWith(null, { canClock: false });
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Fix a day' }));
    expect(await screen.findByRole('heading', { name: 'Fix a day' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clock in' })).toBeNull();
  });

  it('says when the store’s location isn’t set', async () => {
    server.today = todayWith(null, { storeLocationSet: false });
    renderPage();
    expect(
      await screen.findByText(
        'The store’s location isn’t set yet, so where you clock in isn’t checked.',
      ),
    ).toBeInTheDocument();
  });
});

describe('the owner’s decisions of Nov 23 (D, E, H)', () => {
  const yesterday = manilaDay(new Date(Date.now() - 24 * 60 * 60 * 1000));

  it('after midnight the clock offers Clock in, not yesterday’s Clock out (H)', async () => {
    // The server's answer is still yesterday's, with the day open.
    server.today = todayWith(
      { ...RECORD, work_date: yesterday, in_at: `${yesterday}T07:54:00+08:00` },
      { today: yesterday },
    );
    localStorage.setItem('pos.clock.u2', JSON.stringify(server.today));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Clock in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clock out' })).toBeNull();
  });

  it('a tap refused as more than 24 hours old stays on the phone, in words (D)', async () => {
    server.outbox = [
      {
        id: 't1',
        kind: 'clock_out',
        uid: 'u2',
        branchId: 'main',
        payload: { deviceAt: `${yesterday}T18:04:00+08:00` },
        madeAt: Date.now() - 26 * 60 * 60 * 1000,
        status: 'needsAttention',
        attempts: 1,
        error: refusalText('tap_too_old'),
      },
    ];
    renderPage();
    expect(
      await screen.findByText(/Your time out of .*6:04.*, saved on this phone, wasn’t counted./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/more than 24 hours after the tap, so it wasn’t counted/),
    ).toBeInTheDocument();
  });

  it('says a fix time hasn’t happened yet (E)', () => {
    expect(describeFixError({ message: 'future_time' })).toBe(
      'That time hasn’t happened yet. Give the real time in and time out.',
    );
    expect(refusalText('something new')).toBe('something new');
  });
});

describe('clock in before selling (ATT-16)', () => {
  it('Sell shows the clock until the day’s time in', async () => {
    const { SellPage } = await import('@/features/sales/SellPage');
    render(
      <MemoryRouter>
        <SellPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Clock in first' })).toBeInTheDocument();
    expect(screen.getByText('Clock in at the store to start selling today.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clock in' })).toBeInTheDocument();
  });
});

describe('fixing a day (ATT-11)', () => {
  it('staff ask the Owner with the real time and a reason', async () => {
    server.today = todayWith(RECORD);
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Ask the Owner to fix a day' }));
    await user.click(screen.getByRole('button', { name: 'Send to the Owner' }));
    expect(screen.getByText('Give the time in, the time out, or both.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Time out'), '18:05');
    await user.type(screen.getByLabelText('Reason'), 'Forgot to clock out');
    await user.click(screen.getByRole('button', { name: 'Send to the Owner' }));
    expect(calls('request_attendance_fix')[0]?.args).toMatchObject({
      p_day: day,
      p_in: null,
      p_out: '18:05',
      p_reason: 'Forgot to clock out',
    });
    expect(await screen.findByText(/Request sent. The Owner will decide/)).toBeInTheDocument();
  });

  it('the Owner marks a day absent, and sets a usual rest day', async () => {
    signInAs('owner');
    server.today = todayWith(null, { canClock: false });
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Fix a day' }));
    await user.click(await screen.findByRole('radio', { name: 'Absent' }));
    await user.type(screen.getByLabelText('Reason'), 'Sick');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(calls('mark_attendance_day')[0]?.args).toMatchObject({
      p_user: 'u2',
      p_day: day,
      p_kind: 'absent',
      p_reason: 'Sick',
    });
    expect(await screen.findByLabelText('Test Special 5')).toHaveValue('0');
    await user.selectOptions(screen.getByLabelText('Test Two'), 'Saturday');
    expect(calls('set_rest_weekday')[0]?.args).toMatchObject({ p_user: 'u2', p_weekday: 6 });
  });

  it('a poor location reading says how far and how precise', async () => {
    server.today = todayWith({
      ...RECORD,
      flags: ['location_not_verified'],
      in_distance_m: 230,
      in_accuracy_m: 41.6,
    });
    renderPage();
    expect(
      await screen.findByText('Location not verified: 230 m away, accuracy 42 m'),
    ).toBeInTheDocument();
  });
});
