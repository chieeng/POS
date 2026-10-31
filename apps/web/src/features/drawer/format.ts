const MANILA = 'Asia/Manila';

/** "2026-11-01" as "Sunday, Nov 1, 2026". */
export const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00+08:00`).toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: MANILA,
  });

/** "2026-11-01" as "Nov 1". */
export const shortDay = (day: string) =>
  new Date(`${day}T12:00:00+08:00`).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    timeZone: MANILA,
  });

/** "8:14 PM", in the store's time. */
export const timeLabel = (when: Date) =>
  when.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: MANILA });

/** The day before a "YYYY-MM-DD" day. */
export function dayBefore(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
