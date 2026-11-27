import { useState } from 'react';
import { LoadMore } from '@/components/ui/load-more';
import { manilaDay, type ClockState } from './clock';
import { DayMore, DayTags } from './DayBadges';
import { dayParts, dayText, useMore } from './dayRow';
import {
  addDays,
  dayName,
  daysBetween,
  stateOf,
  useDays,
  weekdayOf,
  type DayRow,
  type DayState,
} from './report';

const WEEK = 7;
const MONTH = 30;

/**
 * ATT-15: a staff member's own days, the last 7 first and up to 30, so they see a fix the
 * Owner approved and any day with no time out. Each day is worked out as on the Owner's board
 * (ATT-14; the Nov 24, 2026 step 11 test): a working day with no time in is "Absent", the
 * usual rest day is "Rest day", and days before their own first clock-in or before the account
 * was made are "No record" (Q-ATT-1, Nov 25, 2026). The list is live: a fix or a mark shows at once.
 */
export function RecentDays({
  uid,
  version,
  person,
  onAskFix,
}: {
  uid: string;
  version: string;
  /** From the clock's answer; null until the server answered once (then no day is absent). */
  person: ClockState['person'];
  /** Opens the fix request for a day (a day with no time in or no time out). */
  onAskFix?: (day: string) => void;
}) {
  const today = manilaDay(new Date());
  const from = addDays(today, 1 - MONTH);
  const rows = useDays(from, today, { userId: uid, version, live: true });
  const [shown, setShown] = useState(WEEK);

  if (rows.error) {
    return <p className="m-0 text-[13px] text-neutral-700">Your past days need internet.</p>;
  }
  if (rows.loading) {
    return (
      <p role="status" className="m-0 text-[13px] text-neutral-700">
        Loading your days…
      </p>
    );
  }
  const byDay = new Map(rows.data.map((row) => [row.workDate, row]));
  const days = daysBetween(from, today).reverse();
  return (
    <section aria-label="My days" className="flex flex-col">
      <h2 className="m-0 pb-[2px] font-body text-[13px] font-bold text-neutral-700">
        {shown === WEEK ? 'Last 7 days' : 'Last 30 days'}
      </h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {days.slice(0, shown).map((day) => {
          const row = byDay.get(day) ?? null;
          // Unknown (never online yet): no day is called absent, as before.
          const state = stateOf(
            {
              id: uid,
              name: '',
              active: true,
              since: person?.since ?? today,
              restWeekday: person?.restWeekday ?? null,
            },
            day,
            row,
            today,
            person ? person.firstIn : today,
          );
          return (
            <DayLine
              key={day}
              day={day}
              state={state}
              row={row}
              onAskFix={
                onAskFix && ((state === 'absent' && !row) || state === 'no_out')
                  ? () => onAskFix(day)
                  : undefined
              }
            />
          );
        })}
      </ul>
      <LoadMore shown={shown} total={days.length} onLoadMore={() => setShown(MONTH)} />
    </section>
  );
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** One day (the "Last 7 days" board): the date, the times big, one tag and "+N". */
function DayLine({
  day,
  state,
  row,
  onAskFix,
}: {
  day: string;
  state: DayState;
  row: DayRow | null;
  onAskFix?: () => void;
}) {
  const parts = dayParts({ state, row });
  const text = dayText({ state, row });
  const more = useMore();
  const quiet = state === 'rest' || state === 'none';
  return (
    <li className="flex flex-col border-b border-divider" {...more.rowProps}>
      <div className="grid min-h-[58px] grid-cols-[40px_minmax(0,1fr)] items-center gap-[12px] py-[8px]">
        <span className="flex flex-col items-center leading-[1.1]" aria-hidden>
          <span className="text-[12.5px] font-semibold text-neutral-700">
            {WEEKDAY[weekdayOf(day)]}
          </span>
          <span className="text-[18px] font-bold tabular-nums">{Number(day.slice(8))}</span>
        </span>
        {/* The tag sits at the right, and drops under the times when the phone is narrow. */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-[12px] gap-y-[6px]">
          <span className="flex min-w-0 flex-col gap-[2px]">
            <span className="sr-only">{dayName(day)}: </span>
            <span
              className={
                quiet
                  ? 'text-[15px] font-bold text-neutral-700'
                  : 'text-[15px] font-bold whitespace-nowrap tabular-nums'
              }
            >
              {text.title}
            </span>
            {(text.sub || onAskFix) && (
              <span className="flex flex-wrap items-center gap-x-[10px] text-[13px] text-neutral-700">
                {text.sub}
                {onAskFix && (
                  <button
                    type="button"
                    onClick={onAskFix}
                    aria-label={`Ask to fix ${dayName(day)}`}
                    className="mt-[4px] inline-flex min-h-[40px] cursor-pointer items-center rounded-[10px] border border-divider bg-surface px-[12px] text-[13.5px] font-bold text-danger-fg hover:bg-text/4"
                  >
                    Ask to fix ›
                  </button>
                )}
              </span>
            )}
          </span>
          <DayTags
            parts={parts}
            open={more.open}
            onToggle={more.toggle}
            label={dayName(day)}
            className="ml-auto justify-end"
          />
        </span>
      </div>
      {more.open && parts.more.length > 0 && (
        <DayMore parts={parts} className="mb-[8px] ml-[52px]" />
      )}
    </li>
  );
}
