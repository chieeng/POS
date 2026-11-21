import { useEffect, useState } from 'react';
import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';

/**
 * Fixing a day (SRS ATT-11; the owner's decisions of Nov 21, 2026): staff ask the Owner with
 * the real times and a reason; the Owner fixes or marks a day directly. Times are "HH:MM",
 * store time; an empty one keeps what is recorded.
 */

const orNull = (value: string) => (value.trim() === '' ? null : value);

export async function requestFix(day: string, timeIn: string, timeOut: string, reason: string) {
  const { error } = await supabase.rpc('request_attendance_fix', {
    p_day: day,
    p_in: orNull(timeIn),
    p_out: orNull(timeOut),
    p_reason: reason.trim(),
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
}

export async function fixDay(
  userId: string,
  day: string,
  timeIn: string,
  timeOut: string,
  reason: string,
) {
  const { error } = await supabase.rpc('fix_attendance', {
    p_user: userId,
    p_day: day,
    p_in: orNull(timeIn),
    p_out: orNull(timeOut),
    p_reason: reason.trim(),
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
}

export type DayMark = 'absent' | 'rest' | 'clear';

export async function markDay(userId: string, day: string, kind: DayMark, reason: string) {
  const { error } = await supabase.rpc('mark_attendance_day', {
    p_user: userId,
    p_day: day,
    p_kind: kind,
    p_reason: reason.trim(),
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
}

export async function setRestDay(userId: string, weekday: number | null) {
  const { error } = await supabase.rpc('set_rest_weekday', {
    p_user: userId,
    p_weekday: weekday,
    p_device_tag: getDeviceTag(),
  });
  if (error) throw error;
}

export function describeFixError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  switch (message) {
    case 'invalid_input':
      return 'Give a time in (or keep the one recorded), the times in order, and a reason.';
    case 'out_before_in':
      return 'The time out must be after the time in.';
    case 'too_old':
      return 'Only the last 30 days can be fixed by request. Ask the Owner for older days.';
    case 'request_pending':
      return 'You already asked to fix this day. Wait for the Owner, or withdraw it in My requests.';
    case 'has_times':
      return 'This day has times. Fix the times instead, or clear them first.';
    case 'not_found':
      return 'That person isn’t in this store. Reload the page.';
  }
  if (code === '42501') return 'This account cannot do that.';
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. This needs to be online; try again.';
  }
  return 'Something went wrong. Try again.';
}

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export interface StaffMember {
  id: string;
  name: string;
  restWeekday: number | null;
}

/** The people who clock in (staff, active), with their usual rest day: for the Owner. */
export function useStaff(reloadKey = 0): { data: StaffMember[]; loading: boolean; error: boolean } {
  const [state, setState] = useState<{ data: StaffMember[]; loading: boolean; error: boolean }>({
    data: [],
    loading: true,
    error: false,
  });
  useEffect(() => {
    let cancelled = false;
    void supabase
      .from('profiles')
      .select('id, display_name, role, active, rest_weekday')
      .neq('role', 'owner')
      .eq('active', true)
      .order('display_name')
      .then(({ data, error }) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: !!error,
          data: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
            id: String(row.id),
            name: String(row.display_name ?? ''),
            restWeekday:
              row.rest_weekday === null || row.rest_weekday === undefined
                ? null
                : Number(row.rest_weekday),
          })),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);
  return state;
}
