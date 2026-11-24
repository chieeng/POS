import { useCallback, useEffect, useState } from 'react';
import { isNetworkError } from '@/features/auth/authErrors';
import { currentLocation, type Fix } from '@/features/store/geo';
import { useOnline } from '@/hooks/useOnline';
import { getDeviceTag } from '@/lib/device';
import {
  addToOutbox,
  registerSender,
  sendFailure,
  watchOutboxClock,
  type OutboxItem,
  type SendResult,
} from '@/lib/outbox';
import { supabase } from '@/lib/supabase';

/**
 * Clock-in and clock-out (SRS ATT-01..05, ATT-12, ATT-16; the owner's decisions of Nov 21,
 * 2026). The server works out the day; the phone only sends the time and where it was.
 * Offline, the tap waits in the outbox with the phone's time and is sent later.
 */

export type ClockKind = 'clock_in' | 'clock_out';

/** Today's record, as the server keeps it (the fields this screen shows). */
export interface AttendanceRecord {
  workDate: string;
  inAt: Date | null;
  outAt: Date | null;
  startType: 'morning' | 'afternoon' | null;
  lateMinutes: number;
  dayType: 'whole' | 'morning_half' | 'afternoon_half' | null;
  earlyMinutes: number;
  overtimeMinutes: number;
  flags: string[];
  inLocation: string | null;
  outLocation: string | null;
  inDistanceM: number | null;
  inAccuracyM: number | null;
  outDistanceM: number | null;
  outAccuracyM: number | null;
}

/** The day's settings, in minutes after midnight. */
export interface ClockRules {
  latestIn: number;
  ownTime: boolean;
  afternoonStart: number;
  graceMinutes: number;
  afternoonLine: number;
  morningOutLine: number;
  earliestOut: number;
}

export interface AttendanceToday {
  today: string;
  canClock: boolean;
  record: AttendanceRecord | null;
  rules: ClockRules | null;
  storeLocationSet: boolean;
  /**
   * For the staff member's own list of days, worked out as on the Owner's board (ATT-14): the
   * store's first day with attendance, their usual rest day (0 = Sunday), and the day their
   * account was made. Null when unknown.
   */
  firstDay: string | null;
  restWeekday: number | null;
  since: string | null;
}

type Json = Record<string, unknown>;

const date = (value: unknown) => (typeof value === 'string' ? new Date(value) : null);
const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const numOrNull = (value: unknown) =>
  value === null || value === undefined ? null : Math.round(Number(value));

export function toRecord(row: Json): AttendanceRecord {
  return {
    workDate: String(row.work_date ?? ''),
    inAt: date(row.in_at),
    outAt: date(row.out_at),
    startType: (row.start_type as AttendanceRecord['startType']) ?? null,
    lateMinutes: num(row.late_minutes),
    dayType: (row.day_type as AttendanceRecord['dayType']) ?? null,
    earlyMinutes: num(row.early_minutes),
    overtimeMinutes: num(row.overtime_minutes),
    flags: Array.isArray(row.flags) ? (row.flags as string[]) : [],
    inLocation: typeof row.in_location === 'string' ? row.in_location : null,
    outLocation: typeof row.out_location === 'string' ? row.out_location : null,
    inDistanceM: numOrNull(row.in_distance_m),
    inAccuracyM: numOrNull(row.in_accuracy_m),
    outDistanceM: numOrNull(row.out_distance_m),
    outAccuracyM: numOrNull(row.out_accuracy_m),
  };
}

export function toToday(raw: unknown): AttendanceToday {
  const data = (raw ?? {}) as Json;
  const rules = data.rules as Json | null | undefined;
  return {
    today: String(data.today ?? ''),
    canClock: data.canClock === true,
    record: data.record ? toRecord(data.record as Json) : null,
    rules: rules
      ? {
          latestIn: num(rules.latestIn),
          ownTime: rules.ownTime === true,
          afternoonStart: num(rules.afternoonStart),
          graceMinutes: num(rules.graceMinutes),
          afternoonLine: num(rules.afternoonLine),
          morningOutLine: num(rules.morningOutLine),
          earliestOut: num(rules.earliestOut),
        }
      : null,
    storeLocationSet: data.storeLocationSet === true,
    firstDay: typeof data.firstDay === 'string' ? data.firstDay : null,
    restWeekday:
      data.restWeekday === null || data.restWeekday === undefined ? null : Number(data.restWeekday),
    since: typeof data.since === 'string' ? data.since : null,
  };
}

/** "YYYY-MM-DD" of a moment, in the store's time. */
export const manilaDay = (at: Date) => at.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

/** "8:00 AM" from minutes after midnight. */
export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export const timeText = (at: Date) =>
  at.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });

export const DAY_TYPE_LABELS = {
  whole: 'Whole day',
  morning_half: 'Morning half day',
  afternoon_half: 'Afternoon half day',
} as const;

export const FLAG_LABELS: Record<string, string> = {
  location_not_read: 'Location not read',
  location_not_verified: 'Location not verified',
  store_location_not_set: 'Store location not set',
  sent_late: 'Sent from this phone later',
  clock_ahead: 'Phone clock was ahead',
  edited: 'Changed by the Owner',
};

/**
 * A flag in words; a poor location reading says how far and how precise it was (the Nov 22
 * test): "Location not verified: 230 m away, accuracy 40 m".
 */
export function flagText(flag: string, record: AttendanceRecord): string {
  if (flag === 'location_not_verified') {
    // The reading that was poor: a good time in and a poor time out must not show the good one.
    const atOut =
      record.outLocation === 'not_verified' &&
      (record.inLocation !== 'not_verified' || record.inDistanceM === null);
    const distance = atOut ? record.outDistanceM : record.inDistanceM;
    const accuracy = atOut ? record.outAccuracyM : record.inAccuracyM;
    const parts = [
      distance !== null ? `${distance.toLocaleString('en-PH')} m away` : null,
      accuracy !== null ? `accuracy ${accuracy.toLocaleString('en-PH')} m` : null,
    ].filter(Boolean);
    return parts.length > 0 ? `Location not verified: ${parts.join(', ')}` : FLAG_LABELS[flag]!;
  }
  return FLAG_LABELS[flag] ?? flag;
}

// ---- Sending ------------------------------------------------------------------------------------

interface ClockPayload {
  clientId: string;
  /** Only for a tap that waited offline: the phone's time of the tap. */
  deviceAt: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
}

async function callClock(kind: ClockKind, payload: ClockPayload): Promise<void> {
  const { error } = await supabase.rpc(kind, { p: payload, p_device_tag: getDeviceTag() });
  if (error) throw error;
}

/**
 * Why the server refused a tap that waited on the phone, in words: kept on the phone, shown on
 * the clock screen and copied to the audit log for the Owner.
 */
export function refusalText(code: string): string {
  switch (code) {
    case 'tap_too_old':
      // The owner's decision D of Nov 23, 2026 (ATT-12).
      return 'It reached the server more than 24 hours after the tap, so it wasn’t counted. Send a fix request for that day.';
    case 'already_clocked_in':
      return 'There was already a time in that day.';
    case 'already_clocked_out':
      return 'There was already a time out that day.';
    case 'not_clocked_in':
      return 'There was no time in that day to close.';
    case 'out_before_in':
      return 'The time out was before the time in.';
    case 'outside_radius':
      return 'The phone was too far from the store.';
  }
  return code;
}

/** Sends a tap that waited in the outbox. */
async function sendClock(item: OutboxItem): Promise<SendResult> {
  try {
    await callClock(item.kind as ClockKind, item.payload as unknown as ClockPayload);
    return { sent: true };
  } catch (error) {
    const result = sendFailure(error);
    return 'rejected' in result ? { rejected: refusalText(result.rejected) } : result;
  }
}

/** Lets the outbox send clock taps; called once when the app starts (see outboxSync). */
export function registerClockSenders(): () => void {
  const stopIn = registerSender('clock_in', sendClock);
  const stopOut = registerSender('clock_out', sendClock);
  return () => {
    stopIn();
    stopOut();
  };
}

/** Why a clock tap was refused; outside_radius carries the distance in metres. */
export class ClockError extends Error {
  constructor(
    message: string,
    readonly distance: number | null = null,
  ) {
    super(message);
  }
}

/** Reads the location once (ATT-05); null when it can't, which the server flags. */
async function readLocation(): Promise<Fix | null> {
  try {
    return await currentLocation();
  } catch {
    return null;
  }
}

/**
 * One tap: online it goes straight to the server; offline (or when the connection drops on
 * the way) it waits in the outbox with the phone's time. Returns 'sent' or 'saved'.
 */
export async function clock(
  kind: ClockKind,
  who: { uid: string; branchId: string },
): Promise<{ result: 'sent' | 'saved'; located: boolean }> {
  const fix = await readLocation();
  const payload: ClockPayload = {
    clientId: crypto.randomUUID(),
    deviceAt: null,
    lat: fix?.lat ?? null,
    lng: fix?.lng ?? null,
    accuracy: fix?.accuracy ?? null,
  };
  const save = async () => {
    await addToOutbox({
      id: payload.clientId,
      kind,
      uid: who.uid,
      branchId: who.branchId,
      payload: { ...payload, deviceAt: new Date().toISOString() },
    });
    return { result: 'saved' as const, located: fix !== null };
  };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return save();
  try {
    await callClock(kind, payload);
    return { result: 'sent', located: fix !== null };
  } catch (error) {
    if (isNetworkError(error)) return save();
    const { message, details } = (error ?? {}) as { message?: unknown; details?: unknown };
    throw new ClockError(
      typeof message === 'string' ? message : 'unknown',
      message === 'outside_radius' && details !== undefined ? Number(details) : null,
    );
  }
}

export function describeClockError(error: unknown): string {
  if (error instanceof ClockError) {
    switch (error.message) {
      case 'outside_radius':
        return error.distance !== null
          ? `You’re ${error.distance.toLocaleString('en-PH')} m from the store. Clock-in and clock-out work only at the store. Move closer and try again.`
          : 'You’re too far from the store. Move closer and try again.';
      case 'already_clocked_in':
        return 'You already clocked in today. One time in a day counts.';
      case 'already_clocked_out':
        return 'You already clocked out today.';
      case 'not_clocked_in':
        return 'Clock in first. If you forgot to clock in, ask the Owner to fix it.';
      case 'out_before_in':
        return 'The time out can’t be before the time in. Check the phone’s clock and try again.';
      case 'past_midnight':
        return 'It’s past midnight, so yesterday’s time out can’t be added here. Send a fix request for yesterday with your time out.';
    }
    if (/no access/i.test(error.message)) return 'This account doesn’t clock in.';
  }
  return 'Something went wrong. Try again.';
}

// ---- Today's state, also offline -----------------------------------------------------------

const cacheKey = (uid: string) => `pos.clock.${uid}`;

function readCache(uid: string): AttendanceToday | null {
  try {
    const raw = localStorage.getItem(cacheKey(uid));
    return raw ? toToday(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export interface ClockState {
  /** The store day this state is for ("YYYY-MM-DD"); it turns over at midnight. */
  day: string;
  loading: boolean;
  /** This person clocks in (staff; the Owner only with "Owner clocks in too"). */
  canClock: boolean;
  record: AttendanceRecord | null;
  rules: ClockRules | null;
  storeLocationSet: boolean;
  /** For the list of own days (null until the server has answered once). */
  person: Pick<AttendanceToday, 'firstDay' | 'restWeekday' | 'since'> | null;
  /** A tap waiting on this phone, today. */
  waitingIn: Date | null;
  waitingOut: Date | null;
  /** A tap the server refused for good, in the last 30 days: which, when, and why. */
  refused: { kind: ClockKind; at: Date; reason: string } | null;
  clockedIn: boolean;
  clockedOut: boolean;
  reload: () => void;
}

/**
 * Today's attendance for the signed-in person: from the server when online (kept on the
 * phone for later), plus any taps still waiting in the outbox, so the clock screen and the
 * Sell gate work offline too.
 */
export function useClockState(uid: string | undefined, isOwner: boolean): ClockState {
  const online = useOnline();
  const [server, setServer] = useState<AttendanceToday | null>(() => (uid ? readCache(uid) : null));
  const [fetched, setFetched] = useState(false);
  const [waiting, setWaiting] = useState<OutboxItem[]>([]);
  const [runs, setRuns] = useState(0);
  const reload = useCallback(() => setRuns((n) => n + 1), []);
  const [today, setToday] = useState(() => manilaDay(new Date()));

  useEffect(() => {
    if (!uid) return undefined;
    return watchOutboxClock(uid, setWaiting);
  }, [uid]);

  // At midnight the screen turns to the new day: Clock in, never yesterday's Clock out
  // (the owner's decision H of Nov 23, 2026).
  useEffect(() => {
    const timer = setInterval(() => setToday(manilaDay(new Date())), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;
    if (!online) return undefined;
    void supabase.rpc('attendance_today').then(({ data, error }) => {
      if (cancelled) return;
      if (!error) {
        setServer(toToday(data));
        try {
          localStorage.setItem(cacheKey(uid), JSON.stringify(data));
        } catch {
          // A private window: the screen still works online.
        }
      }
      setFetched(true);
    });
    return () => {
      cancelled = true;
    };
    // A tap leaving the outbox changes what the server has.
  }, [uid, online, runs, waiting.length, today]);

  const record = server && server.today === today ? server.record : null;
  const tapAt = (item: OutboxItem) =>
    new Date(String((item.payload as Json).deviceAt ?? new Date(item.madeAt).toISOString()));
  const tapDay = (item: OutboxItem) => manilaDay(tapAt(item));
  const pending = waiting.filter((item) => item.status === 'waiting' && tapDay(item) === today);
  const tap = (kind: ClockKind) => pending.find((item) => item.kind === kind);
  const inItem = tap('clock_in');
  const outItem = tap('clock_out');
  // A refused tap is shown while a fix request can still be sent for its day (30 days).
  const fixable = manilaDay(new Date(Date.parse(`${today}T12:00:00+08:00`) - 30 * 86_400_000));
  const refusedItem = [...waiting]
    .reverse()
    .find((item) => item.status === 'needsAttention' && tapDay(item) >= fixable);
  const waitingIn = inItem ? new Date(String((inItem.payload as Json).deviceAt)) : null;
  const waitingOut = outItem ? new Date(String((outItem.payload as Json).deviceAt)) : null;

  return {
    day: today,
    // Offline with nothing saved: not loading, nothing known (the clock still works).
    loading: online && !fetched && !server,
    canClock: server ? server.canClock : !isOwner,
    record,
    rules: server?.rules ?? null,
    storeLocationSet: server?.storeLocationSet ?? true,
    person: server
      ? { firstDay: server.firstDay, restWeekday: server.restWeekday, since: server.since }
      : null,
    waitingIn,
    waitingOut,
    refused: refusedItem
      ? {
          kind: refusedItem.kind as ClockKind,
          at: tapAt(refusedItem),
          reason: refusalText(refusedItem.error ?? 'Refused.'),
        }
      : null,
    clockedIn: !!record?.inAt || waitingIn !== null,
    clockedOut: !!record?.outAt || waitingOut !== null,
    reload,
  };
}
