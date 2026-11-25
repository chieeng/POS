import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LoadMore } from '@/components/ui/load-more';
import { manilaDay, timeText, type ClockState } from './clock';
import { DayBadges } from './DayBadges';
import { addDays, dayName, daysBetween, outText, stateOf, useDays } from './report';

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
            <li key={day} className="flex flex-col gap-[5px] border-b border-divider py-[10px]">
              <span className="flex flex-wrap items-baseline justify-between gap-x-[10px] text-[14px]">
                <span className="font-bold">{dayName(day)}</span>
                {row?.inAt && (
                  <span className="text-[13px] text-neutral-700 tabular-nums">
                    In {timeText(row.inAt)}
                    {row.outAt ? ` · Out ${outText(row)}` : ''}
                  </span>
                )}
              </span>
              <DayBadges state={state} row={row} />
              {onAskFix && ((state === 'absent' && !row) || state === 'no_out') && (
                <Button
                  variant="quiet"
                  size="touch"
                  className="self-start"
                  aria-label={`Ask to fix ${dayName(day)}`}
                  onClick={() => onAskFix(day)}
                >
                  Ask to fix
                </Button>
              )}
              {row?.note && (
                <span className="text-[13px] break-words text-neutral-700">Reason: {row.note}</span>
              )}
            </li>
          );
        })}
      </ul>
      <LoadMore shown={shown} total={days.length} onLoadMore={() => setShown(MONTH)} />
    </section>
  );
}
