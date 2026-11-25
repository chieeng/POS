import { describe, expect, it } from 'vitest';
import { dayParts, dayText } from './dayRow';
import { toDayRow } from './report';

/** A finished whole day at the store, 8:00 AM to 6:00 PM, with overrides. */
const day = (extra: Record<string, unknown> = {}) =>
  toDayRow({
    id: 'r1',
    user_id: 'two',
    work_date: '2026-11-20',
    kind: 'worked',
    in_at: '2026-11-20T08:00:00+08:00',
    out_at: '2026-11-20T18:00:00+08:00',
    late_minutes: 0,
    day_type: 'whole',
    early_minutes: 0,
    overtime_minutes: 0,
    flags: [],
    rules: { lateRule: 'none', lateFlat: 0 },
    note: null,
    ...extra,
  });

describe('one tag and "+N" (cleanup round 1, SRS 7.2)', () => {
  it('a plain day has no tag, and its kind in words', () => {
    const row = day();
    expect(dayParts({ state: 'done', row })).toEqual({ tags: [], more: [] });
    expect(dayText({ state: 'done', row })).toEqual({
      title: '8:00 AM – 6:00 PM',
      sub: 'Whole day',
    });
  });

  it('shows one amber tag and folds the rest', () => {
    const row = day({
      late_minutes: 21,
      early_minutes: 10,
      overtime_minutes: 0,
      flags: ['location_not_read'],
    });
    const parts = dayParts({ state: 'done', row });
    expect(parts.tags.map((tag) => tag.text)).toEqual(['Late 21 min']);
    expect(parts.more).toEqual(['Early out 10 min', 'Location not read']);
  });

  it('never folds money or red, and money comes first', () => {
    const late = day({ late_minutes: 40, rules: { lateRule: 'flat', lateFlat: 50 } });
    expect(dayParts({ state: 'done', row: late }).tags).toEqual([
      { text: 'Late 40 min · −₱50.00', tone: 'warn' },
    ]);

    const open = day({ out_at: null, day_type: null, late_minutes: 5 });
    const parts = dayParts({ state: 'no_out', row: open });
    expect(parts.tags.map((tag) => tag.text)).toEqual(['No time out']);
    expect(parts.more).toEqual(['Late 5 min']);
    expect(dayText({ state: 'no_out', row: open }).title).toBe('8:00 AM – ?');
  });

  it('shows an amount only where Summary and the CSV count one', () => {
    const flat = { lateRule: 'flat', lateFlat: 50 };
    const inNow = day({ out_at: null, day_type: null, late_minutes: 40, rules: flat });
    expect(dayParts({ state: 'in', row: inNow }).tags.map((tag) => tag.text)).toEqual([
      'Late 40 min',
    ]);
    expect(dayParts({ state: 'no_out', row: inNow }).tags.map((tag) => tag.text)).toEqual([
      'No time out',
    ]);
    // Per-minute deduction: priced in payroll (step 14), so no amount on the row.
    const minutes = day({ late_minutes: 40, rules: { lateRule: 'minutes', lateFlat: 0 } });
    expect(dayParts({ state: 'done', row: minutes }).tags.map((tag) => tag.text)).toEqual([
      'Late 40 min',
    ]);
  });

  it('calls a flagged day "Flagged" and lists why behind "+N"', () => {
    const row = day({ flags: ['location_not_read', 'sent_late'], overtime_minutes: 98 });
    const parts = dayParts({ state: 'done', row });
    expect(parts.tags.map((tag) => tag.text)).toEqual(['Flagged']);
    expect(parts.more).toEqual([
      'Overtime 98 min',
      'Location not read',
      'Sent from this phone later',
    ]);
  });

  it('keeps the Owner’s change and the reason as one detail', () => {
    const row = day({ flags: ['edited'], note: 'Forgot to clock in' });
    expect(dayParts({ state: 'done', row })).toEqual({
      tags: [],
      more: ['Changed by the Owner: “Forgot to clock in”'],
    });
  });

  it('tells the two kinds of absent apart', () => {
    const marked = day({ kind: 'absent', in_at: null, out_at: null, note: 'Did not come' });
    expect(dayText({ state: 'absent', row: marked })).toEqual({
      title: 'Absent',
      sub: 'Marked by the Owner',
    });
    expect(dayParts({ state: 'absent', row: marked })).toEqual({
      tags: [{ text: 'Absent', tone: 'danger' }],
      more: ['Reason: “Did not come”'],
    });
    expect(dayText({ state: 'absent', row: null })).toEqual({
      title: 'Absent',
      sub: 'No time in',
    });
  });
});
