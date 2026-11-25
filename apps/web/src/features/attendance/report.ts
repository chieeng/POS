import { BOM, csvCell } from '@/features/catalog/export';
import { useLiveRows, type QueryState } from '@/hooks/useLiveRows';
import { supabase } from '@/lib/supabase';
import {
  DAY_TYPE_LABELS,
  flagText,
  manilaDay,
  timeText,
  toRecord,
  type AttendanceRecord,
} from './clock';

/**
 * The attendance board, history, summary and CSV (SRS ATT-14, ATT-15). The server works each
 * day out; this only reads the days and adds them up. What has no record is derived here:
 * "not in yet", the usual rest day, and "absent" for a working day with no time in.
 */

type Json = Record<string, unknown>;

export interface DayRow extends AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  kind: 'worked' | 'absent' | 'rest';
  dayCredit: number | null;
  note: string | null;
  /** The late rule kept on the day (ATT-09). */
  lateRule: 'none' | 'minutes' | 'flat';
  lateFlat: number;
}

export function toDayRow(row: Json): DayRow {
  const rules = (row.rules ?? {}) as Json;
  return {
    ...toRecord(row),
    id: String(row.id ?? ''),
    userId: String(row.user_id ?? ''),
    userName: String(row.user_name ?? ''),
    kind: row.kind === 'absent' || row.kind === 'rest' ? row.kind : 'worked',
    dayCredit:
      row.day_credit === null || row.day_credit === undefined ? null : Number(row.day_credit),
    note: typeof row.note === 'string' ? row.note : null,
    lateRule: rules.lateRule === 'minutes' || rules.lateRule === 'flat' ? rules.lateRule : 'none',
    lateFlat: Number(rules.lateFlat ?? 0),
  };
}

const COLUMNS =
  'id, user_id, user_name, work_date, kind, in_at, out_at, start_type, late_minutes, day_type, day_credit, early_minutes, overtime_minutes, flags, rules, note, in_location, out_location, in_distance_m, in_accuracy_m, out_distance_m, out_accuracy_m';

// The API returns at most this many rows per request (supabase/config.toml max_rows), and a
// month of 20 people is already more: every page is read, or the totals would be short.
export const PAGE = 300;

export async function fetchDays(
  from: string,
  to: string,
  userId?: string,
  openOnly = false,
): Promise<{ data: Json[] | null; error: unknown }> {
  const all: Json[] = [];
  for (let start = 0; ; start += PAGE) {
    let query = supabase
      .from('attendance')
      .select(COLUMNS)
      .gte('work_date', from)
      .lte('work_date', to);
    if (userId) query = query.eq('user_id', userId);
    // Only the days with a time in and no time out: a month of everyone is about 500 KB.
    if (openOnly) query = query.eq('kind', 'worked').is('out_at', null);
    const { data, error } = await query
      .order('work_date')
      .order('id')
      .range(start, start + PAGE - 1);
    if (error || !data) return { data: null, error: error ?? new Error('No answer.') };
    all.push(...(data as unknown as Json[]));
    if (data.length < PAGE) return { data: all, error: null };
  }
}

/**
 * Days from..to, every page. Live only for the board's today (about 40 messages a day) and a
 * staff member's own days (a few a day); the other lists load once when opened (SRS 7.1). Give a component a `key` of its range: the
 * rows of another range must never be added up as this one's.
 */
export function useDays(
  from: string,
  to: string,
  {
    userId,
    live = false,
    version = '',
    openOnly = false,
  }: { userId?: string; live?: boolean; version?: string; openOnly?: boolean } = {},
): QueryState<DayRow> {
  return useLiveRows({
    table: 'attendance',
    queryKey: `${from}|${to}|${userId ?? ''}|${version}|${openOnly}`,
    load: () => fetchDays(from, to, userId, openOnly),
    map: toDayRow,
    // One person's days (staff, ATT-15): only their own changes arrive, a few a day.
    filter: !live
      ? undefined
      : userId
        ? `user_id=eq.${userId}`
        : from === to
          ? `work_date=eq.${from}`
          : undefined,
    live,
  });
}

/**
 * Each person's first clock-in (first day with a time in): no day before it is their
 * "absent" (ATT-14; the owner's answer to Q-ATT-1, Nov 25, 2026). An Owner's Absent or Rest
 * day mark never moves it. Row Level Security returns the store's people to the Owner.
 */
export function useFirstClockIns(): QueryState<{ userId: string; day: string }> {
  return useLiveRows({
    table: 'attendance',
    queryKey: 'first-clock-ins',
    load: () => supabase.rpc('attendance_first_days'),
    map: (row: Json) => ({ userId: String(row.user_id), day: String(row.first_day) }),
    live: false,
  });
}

// ---- Dates ("YYYY-MM-DD") ------------------------------------------------------------------------

export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** "Sat, Nov 21". */
export const dayName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

// ---- One person's day -----------------------------------------------------------------------------

export interface Person {
  id: string;
  name: string;
  active: boolean;
  restWeekday: number | null;
  /** The day the account was made. */
  since: string;
}

/** Active staff, plus anyone else who has a day in these rows (deactivated, or the Owner). */
export function peopleIn(staff: readonly Person[], rows: readonly DayRow[]): Person[] {
  const known = new Map(staff.map((person) => [person.id, person]));
  const people = new Map(
    staff.filter((person) => person.active).map((person) => [person.id, person]),
  );
  for (const row of rows) {
    if (people.has(row.userId)) continue;
    people.set(
      row.userId,
      known.get(row.userId) ?? {
        id: row.userId,
        name: row.userName,
        active: false,
        restWeekday: null,
        since: '',
      },
    );
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type DayState = 'in' | 'done' | 'no_out' | 'absent' | 'rest' | 'not_in' | 'none';

export interface PersonDay {
  day: string;
  person: Person;
  row: DayRow | null;
  state: DayState;
}

export function stateOf(
  person: Person,
  day: string,
  row: DayRow | null,
  today: string,
  /** The person's first clock-in; null when they never clocked in. */
  firstIn: string | null,
): DayState {
  if (row) {
    if (row.kind !== 'worked') return row.kind;
    if (row.outAt) return 'done';
    return day < today ? 'no_out' : 'in';
  }
  if (!person.active || day > today || day < person.since) return 'none';
  if (day < today && (firstIn === null || day < firstIn)) return 'none';
  if (person.restWeekday === weekdayOf(day)) return 'rest';
  return day === today ? 'not_in' : 'absent';
}

/** Every person on every day of the range, in date order. */
export function personDays(
  people: readonly Person[],
  rows: readonly DayRow[],
  range: { from: string; to: string },
  today: string,
  /** Each person's first clock-in, by id. */
  firstIns: ReadonlyMap<string, string>,
): PersonDay[] {
  const byKey = new Map(rows.map((row) => [`${row.userId}|${row.workDate}`, row]));
  return daysBetween(range.from, range.to).flatMap((day) =>
    people.map((person) => {
      const row = byKey.get(`${person.id}|${day}`) ?? null;
      return {
        day,
        person,
        row,
        state: stateOf(person, day, row, today, firstIns.get(person.id) ?? null),
      };
    }),
  );
}

/** Flags the Owner should look at; "edited" is their own change. */
export const toReview = (row: DayRow | null) =>
  row?.kind === 'worked' ? row.flags.filter((flag) => flag !== 'edited') : [];

/**
 * What a late day costs, by the Owner's late deduction setting kept with the day (ATT-06,
 * ATT-09): nothing, a flat amount in pesos, or minutes late that payroll prices later (daily
 * rate ÷ paid minutes per day × minutes; daily rates arrive in step 14, so there is no peso
 * amount for them before). The one source for the board, the history, Summary and the CSV.
 *
 * A day counts once it has a time out (ATT-01). `{ open: true }` also gives what a day still
 * in will cost when it is closed ("expected"), for showing; totals never use it.
 */
export type LateCost =
  { kind: 'none' } | { kind: 'flat'; amount: number } | { kind: 'minutes'; minutes: number };

export function lateCost(row: DayRow | null, { open = false } = {}): LateCost {
  if (row?.kind !== 'worked' || row.lateMinutes <= 0) return { kind: 'none' };
  if (!row.outAt && !open) return { kind: 'none' };
  if (row.lateRule === 'flat') return { kind: 'flat', amount: row.lateFlat };
  if (row.lateRule === 'minutes') return { kind: 'minutes', minutes: row.lateMinutes };
  return { kind: 'none' };
}

/** The flat late deduction of a finished day, in pesos (0 for none or minutes). */
export const flatDeduction = (row: DayRow | null) => {
  const cost = lateCost(row);
  return cost.kind === 'flat' ? cost.amount : 0;
};

export function stateLabel({ state, row }: Pick<PersonDay, 'state' | 'row'>): string {
  switch (state) {
    case 'done':
      return row?.dayType ? DAY_TYPE_LABELS[row.dayType] : 'Clocked out';
    case 'in':
      return 'In';
    case 'no_out':
      return 'No time out';
    // Two kinds, told apart (the owner, Nov 24, 2026): the Owner's mark, or a working day with
    // no time in that may still be fixed by request.
    case 'absent':
      return row?.kind === 'absent' ? 'Absent · marked by the Owner' : 'Absent · no time in';
    case 'rest':
      return 'Rest day';
    case 'not_in':
      return 'Not in yet';
    case 'none':
      return 'No record';
  }
}

/** "6:05 PM", or "12:10 AM (next day)" for a time out after midnight. */
export function outText(row: DayRow): string {
  if (!row.outAt) return '';
  return `${timeText(row.outAt)}${manilaDay(row.outAt) > row.workDate ? ' (next day)' : ''}`;
}

// ---- Totals ---------------------------------------------------------------------------------------

export interface Totals {
  person: Person;
  credit: number;
  whole: number;
  morningHalf: number;
  afternoonHalf: number;
  lateCount: number;
  lateMinutes: number;
  earlyCount: number;
  earlyMinutes: number;
  overtimeMinutes: number;
  absent: number;
  rest: number;
  noOut: number;
  toReview: number;
  flatDeductions: number;
  /** Late minutes of finished days under "pay for the minutes only". */
  minutesToPrice: number;
}

export function totalsFor(person: Person, days: readonly PersonDay[]): Totals {
  const totals: Totals = {
    person,
    credit: 0,
    whole: 0,
    morningHalf: 0,
    afternoonHalf: 0,
    lateCount: 0,
    lateMinutes: 0,
    earlyCount: 0,
    earlyMinutes: 0,
    overtimeMinutes: 0,
    absent: 0,
    rest: 0,
    noOut: 0,
    toReview: 0,
    flatDeductions: 0,
    minutesToPrice: 0,
  };
  let centavos = 0;
  for (const { person: whose, row, state } of days) {
    if (whose.id !== person.id) continue;
    if (state === 'absent') totals.absent++;
    if (state === 'rest') totals.rest++;
    if (state === 'no_out') totals.noOut++;
    if (!row || row.kind !== 'worked') continue;
    if (toReview(row).length > 0) totals.toReview++;
    if (row.lateMinutes > 0) {
      totals.lateCount++;
      totals.lateMinutes += row.lateMinutes;
    }
    // A day with no time out counts for nothing until it is fixed (ATT-01).
    if (state !== 'done') continue;
    totals.credit += row.dayCredit ?? 0;
    if (row.dayType === 'whole') totals.whole++;
    if (row.dayType === 'morning_half') totals.morningHalf++;
    if (row.dayType === 'afternoon_half') totals.afternoonHalf++;
    if (row.earlyMinutes > 0) {
      totals.earlyCount++;
      totals.earlyMinutes += row.earlyMinutes;
    }
    totals.overtimeMinutes += row.overtimeMinutes;
    const cost = lateCost(row);
    if (cost.kind === 'flat') centavos += Math.round(cost.amount * 100);
    if (cost.kind === 'minutes') totals.minutesToPrice += cost.minutes;
  }
  totals.flatDeductions = centavos / 100;
  return totals;
}

// ---- CSV ------------------------------------------------------------------------------------------

export const DAYS_HEADERS = [
  'Date',
  'Person',
  'Status',
  'Time in',
  'Time out',
  'Day credit',
  'Late (min)',
  'Early out (min)',
  'Overtime (min)',
  'Late rule',
  'Late deduction',
  'Flags',
  'Reason',
];

const RULE_LABELS = { none: 'None', minutes: 'Minutes (priced in payroll)', flat: 'Flat amount' };

type Cell = string | number | null;
// CRLF and a byte order mark, like the other exports, so Excel keeps ₱ and ñ.
const file = (headers: readonly string[], rows: Cell[][]) =>
  `${BOM}${[headers.join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n')}\r\n`;

/** One line per person and day; days with nothing to say (before the records) are left out. */
export function daysCsv(days: readonly PersonDay[]): string {
  return file(
    DAYS_HEADERS,
    days
      .filter(({ state }) => state !== 'none')
      .map(({ day, person, row, state }) => {
        const worked = row?.kind === 'worked' ? row : null;
        const finished = state === 'done' ? worked : null;
        return [
          day,
          person.name,
          stateLabel({ state, row }),
          worked?.inAt ? timeText(worked.inAt) : null,
          worked ? outText(worked) : null,
          finished?.dayCredit ?? null,
          worked?.lateMinutes ?? null,
          finished?.earlyMinutes ?? null,
          finished?.overtimeMinutes ?? null,
          worked ? RULE_LABELS[worked.lateRule] : null,
          finished ? flatDeduction(finished) : null,
          worked ? worked.flags.map((flag) => flagText(flag, worked)).join('; ') : null,
          row?.note ?? null,
        ];
      }),
  );
}

export const SUMMARY_HEADERS = [
  'Person',
  'From',
  'To',
  'Days counted',
  'Whole days',
  'Morning half days',
  'Afternoon half days',
  'Times late',
  'Late (min)',
  'Times early out',
  'Early out (min)',
  'Overtime (min)',
  'Absent',
  'Rest days',
  'No time out',
  'Days to review',
  'Flat late deductions',
  'Late minutes to price in payroll',
];

export function summaryCsv(totals: readonly Totals[], range: { from: string; to: string }): string {
  return file(
    SUMMARY_HEADERS,
    totals.map((t) => [
      t.person.name,
      range.from,
      range.to,
      t.credit,
      t.whole,
      t.morningHalf,
      t.afternoonHalf,
      t.lateCount,
      t.lateMinutes,
      t.earlyCount,
      t.earlyMinutes,
      t.overtimeMinutes,
      t.absent,
      t.rest,
      t.noOut,
      t.toReview,
      t.flatDeductions,
      t.minutesToPrice,
    ]),
  );
}
