import { useState } from 'react';
import { LoadMore } from '@/components/ui/load-more';
import { manilaDay, timeText } from './clock';
import { DayBadges } from './DayBadges';
import { addDays, dayName, daysBetween, outText, useDays, type DayState } from './report';

const WEEK = 7;
const MONTH = 30;

/**
 * ATT-15: a staff member's own days, the last 7 first and up to 30, so they see a fix the
 * Owner approved and any day with no time out. A day with no record isn't called absent here:
 * only the Owner's report knows the rest days and when the store began.
 */
export function RecentDays({ uid, version }: { uid: string; version: string }) {
  const today = manilaDay(new Date());
  const from = addDays(today, 1 - MONTH);
  const rows = useDays(from, today, { userId: uid, version });
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
          let state: DayState = day === today ? 'not_in' : 'none';
          if (row?.kind === 'absent' || row?.kind === 'rest') state = row.kind;
          else if (row?.outAt) state = 'done';
          else if (row) state = day === today ? 'in' : 'no_out';
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
