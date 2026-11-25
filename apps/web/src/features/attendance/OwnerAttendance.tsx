import { Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterChip, FilterChips } from '@/components/ui/filter-chips';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadMore } from '@/components/ui/load-more';
import { download } from '@/features/catalog/export';
import { formatPeso } from '@/lib/money';
import { cn, ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { manilaDay, timeText } from './clock';
import { DayBadges } from './DayBadges';
import { OwnerFixPanel } from './FixForms';
import { useStaff } from './fixes';
import {
  addDays,
  dayName,
  daysBetween,
  daysCsv,
  outText,
  peopleIn,
  personDays,
  summaryCsv,
  toReview,
  totalsFor,
  useDays,
  useFirstClockIns,
  type DayRow,
  type Person,
  type PersonDay,
  type Totals,
} from './report';

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'history', label: 'History' },
  { key: 'summary', label: 'Summary' },
  { key: 'fix', label: 'Fix a day' },
] as const;

const DAYS_SHOWN = 31;
const MOST_DAYS = 366;
/** How far back the board looks for days with no time out. */
const LOOK_BACK = 30;

/**
 * The Owner's attendance (SRS ATT-11, ATT-14): today's board, each person's history, a summary
 * for any dates with CSV, and fixing a day. The tab, person and dates live in the address, so
 * a board row opens that person's history and Back returns to the board.
 */
export function OwnerAttendance() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((each) => each.key === params.get('tab'))?.key ?? 'today';
  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <FilterChips label="Attendance views" className="-mx-[16px] px-[16px] xl:mx-0 xl:px-0">
        {TABS.map((each) => (
          <FilterChip
            key={each.key}
            selected={tab === each.key}
            className="px-[12px]"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('tab', each.key);
              setParams(next);
            }}
          >
            {each.label}
          </FilterChip>
        ))}
      </FilterChips>
      {tab === 'fix' ? (
        <div className="w-full max-w-[560px]">
          <OwnerFixPanel
            key={`${params.get('person')}|${params.get('day')}`}
            initialPerson={params.get('person') ?? ''}
            initialDay={params.get('day') ?? ''}
          />
        </div>
      ) : (
        <Loaded tab={tab} />
      )}
    </div>
  );
}

function Loading() {
  return (
    <p role="status" className="text-neutral-700">
      Loading…
    </p>
  );
}

function NeedsInternet() {
  return (
    <Alert variant="danger">
      <b>Attendance needs internet.</b> Connect and try again.
    </Alert>
  );
}

/** What every view needs before it can tell "absent" from "no record". */
function Loaded({ tab }: { tab: 'today' | 'history' | 'summary' }) {
  const staff = useStaff();
  const first = useFirstClockIns();
  if (staff.error || first.error) return <NeedsInternet />;
  if (staff.loading || first.loading) return <Loading />;
  const props = {
    staff: staff.data,
    firstIns: new Map(first.data.map((each) => [each.userId, each.day])),
  };
  return tab === 'today' ? <Board {...props} /> : <Ranged view={tab} {...props} />;
}

interface ViewProps {
  staff: Person[];
  firstIns: ReadonlyMap<string, string>;
}

// ---- Today ----------------------------------------------------------------------------------------

function Board(props: ViewProps) {
  const today = manilaDay(new Date());
  // A new day starts a new board.
  return <BoardOf key={today} today={today} {...props} />;
}

// What needs a look comes first.
function order({ state, row }: PersonDay): number {
  if (row && (row.lateMinutes > 0 || row.earlyMinutes > 0 || toReview(row).length > 0)) return 0;
  return { in: 1, done: 2, no_out: 2, not_in: 3, absent: 4, rest: 5, none: 6 }[state];
}

function BoardOf({ today, staff, firstIns }: ViewProps & { today: string }) {
  const todays = useDays(today, today, { live: true });
  const before = useDays(addDays(today, -LOOK_BACK), addDays(today, -1), { openOnly: true });
  if (todays.error || before.error) return <NeedsInternet />;
  if (todays.loading || before.loading) return <Loading />;

  const days = personDays(
    peopleIn(staff, todays.data),
    todays.data,
    { from: today, to: today },
    today,
    firstIns,
  ).sort((a, b) => order(a) - order(b));
  const noOut = [...before.data].reverse();
  const count = (test: (day: PersonDay) => boolean) => days.filter(test).length;
  const tiles: [label: string, value: number, attention?: 'warn' | 'danger'][] = [
    ['Clocked in', count(({ row }) => row?.kind === 'worked')],
    ['Late', count(({ row }) => !!row && row.lateMinutes > 0), 'warn'],
    ['Flagged', count(({ row }) => toReview(row).length > 0), 'warn'],
    ['Not in yet', count(({ state }) => state === 'not_in')],
    ['Left early', count(({ row }) => !!row && row.earlyMinutes > 0), 'warn'],
    ['No time out', noOut.length, 'danger'],
    ['Rest day', count(({ state }) => state === 'rest')],
    ['Absent', count(({ state }) => state === 'absent')],
  ];

  return (
    <>
      <dl aria-label="Today’s counts" className="m-0 grid grid-cols-4 gap-[6px] md:gap-[10px]">
        {tiles.map(([label, value, attention]) => (
          <div
            key={label}
            className={cn(
              'flex min-w-0 flex-col-reverse justify-end rounded-[12px] bg-surface px-[4px] py-[10px] text-center',
              value > 0 && attention === 'warn' && 'bg-warn-bg text-warn-fg',
              value > 0 && attention === 'danger' && 'bg-danger-bg text-danger-fg',
            )}
          >
            <dt className="text-[11.5px] leading-[1.2] font-bold md:text-[13px]">{label}</dt>
            <dd className="m-0 font-heading text-[24px] tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {noOut.length > 0 && <NoTimeOut rows={noOut} />}

      <section aria-label="Today’s board" className="flex flex-col">
        <h2 className="pb-[2px] font-body text-[13px] font-bold text-neutral-700">
          {dayName(today)} · {days.length} {days.length === 1 ? 'person' : 'people'}
        </h2>
        {days.length === 0 ? (
          <p className="text-neutral-700">No staff yet. Add them in Settings &gt; Users.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {days.map(({ person, row, state }) => (
              <li key={person.id}>
                <Link
                  to={`/attendance?tab=history&person=${person.id}`}
                  className="flex min-h-[64px] flex-col justify-center gap-[5px] border-b border-divider py-[10px] text-text hover:bg-text/4"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-[10px]">
                    <span className="min-w-0 text-[15px] font-bold [overflow-wrap:anywhere]">
                      {person.name}
                    </span>
                    <Times row={row} />
                  </span>
                  <DayBadges state={state} row={row} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function NoTimeOut({ rows }: { rows: DayRow[] }) {
  const [shown, setShown] = useState(5);
  return (
    <Card asChild>
      <section aria-label="No time out">
        <h2 className="m-0 font-body text-[15px] font-bold">No time out · last {LOOK_BACK} days</h2>
        <p className="m-0 text-[13px] text-neutral-700">
          These days count for nothing until they’re fixed.
        </p>
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.slice(0, shown).map((row) => (
            <li
              key={row.id}
              className="flex min-h-11 items-center justify-between gap-[10px] border-t border-divider py-[6px] text-[14px]"
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <b>{row.userName}</b> · {dayName(row.workDate)}
                {row.inAt && ` · in ${timeText(row.inAt)}`}
              </span>
              <Button asChild variant="secondary" size="md" className="flex-none">
                <Link
                  to={`/attendance?tab=fix&person=${row.userId}&day=${row.workDate}`}
                  aria-label={`Fix ${row.userName}, ${dayName(row.workDate)}`}
                >
                  Fix
                </Link>
              </Button>
            </li>
          ))}
        </ul>
        <LoadMore
          shown={Math.min(shown, rows.length)}
          total={rows.length}
          onLoadMore={() => setShown((n) => n + 20)}
        />
      </section>
    </Card>
  );
}

function Times({ row }: { row: DayRow | null }) {
  if (row?.kind !== 'worked' || !row.inAt) return null;
  return (
    <span className="text-[13px] text-neutral-700 tabular-nums">
      In {timeText(row.inAt)}
      {row.outAt ? ` · Out ${outText(row)}` : ''}
    </span>
  );
}

// ---- History and summary --------------------------------------------------------------------------

function Ranged({ view, staff, firstIns }: ViewProps & { view: 'history' | 'summary' }) {
  const [params, setParams] = useSearchParams();
  const me = useSession((s) => s.user);
  const today = manilaDay(new Date());
  const from = params.get('from') ?? addDays(today, -14);
  const to = params.get('to') ?? today;
  const person =
    params.get('person') ?? staff.find((each) => each.active)?.id ?? staff[0]?.id ?? '';
  const set = (name: string, value: string) => {
    if (!value) return;
    const next = new URLSearchParams(params);
    next.set(name, value);
    setParams(next, { replace: true });
  };
  const valid = (day: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T12:00:00Z`));
  let problem: string | null = null;
  if (!valid(from) || !valid(to) || from > to || to > today) {
    problem = 'Pick a first day on or before the last day, and no day after today.';
  } else if (from < addDays(to, 1 - MOST_DAYS)) {
    problem = 'Pick a year or less.';
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-[10px] md:max-w-[720px] md:grid-cols-3">
        {view === 'history' && (
          <Field id="att-person" label="Person" className="col-span-2 md:col-span-1">
            <select
              id="att-person"
              value={person}
              onChange={(event) => set('person', event.target.value)}
              className="min-h-[48px] w-full min-w-0 rounded-[12px] border border-divider bg-surface px-[12px] text-[15px]"
            >
              {/* The Owner is on the board only with "Owner clocks in too". */}
              {me && person === me.uid && <option value={me.uid}>{me.displayName}</option>}
              {staff.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                  {each.active ? '' : ' (deactivated)'}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field id="att-from" label="From">
          <Input
            id="att-from"
            type="date"
            size="touch"
            className="min-w-0 px-[10px]"
            value={from}
            max={to}
            onChange={(event) => set('from', event.target.value)}
          />
        </Field>
        <Field id="att-to" label="To">
          <Input
            id="att-to"
            type="date"
            size="touch"
            className="min-w-0 px-[10px]"
            value={to}
            max={today}
            onChange={(event) => set('to', event.target.value)}
          />
        </Field>
      </div>
      {problem ? (
        <Alert variant="danger">{problem}</Alert>
      ) : view === 'history' ? (
        <History
          key={`${person}|${from}|${to}`}
          {...{ staff, firstIns, today, from, to, person }}
        />
      ) : (
        <Summary key={`${from}|${to}`} {...{ staff, firstIns, today, from, to }} />
      )}
    </>
  );
}

function Field({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-[6px]', className)}>
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      {children}
    </div>
  );
}

interface RangeProps extends ViewProps {
  today: string;
  from: string;
  to: string;
}

function History({ staff, firstIns, today, from, to, person }: RangeProps & { person: string }) {
  const rows = useDays(from, to, { userId: person });
  const [shown, setShown] = useState(DAYS_SHOWN);
  if (rows.error) return <NeedsInternet />;
  if (rows.loading) return <Loading />;
  const who =
    staff.find((each) => each.id === person) ??
    peopleIn([], rows.data).find((each) => each.id === person);
  if (!who) return <p className="text-neutral-700">No one to show.</p>;

  const days = personDays([who], rows.data, { from, to }, today, firstIns);
  const totals = totalsFor(who, days);
  const newest = [...days].reverse();
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-[12px] md:max-w-[420px]">
        <TotalsCard totals={totals} />
      </div>
      <Csv
        label="Download this history (CSV)"
        onClick={() => download(`attendance-${slug(who.name)}-${from}-to-${to}.csv`, daysCsv(days))}
      />
      <ul aria-label="Days" className="m-0 flex list-none flex-col p-0">
        {newest.slice(0, shown).map(({ day, row, state }) => (
          <li key={day} className="flex flex-col gap-[5px] border-b border-divider py-[10px]">
            <span className="flex flex-wrap items-baseline justify-between gap-x-[10px]">
              <span className="text-[15px] font-bold">{dayName(day)}</span>
              <Times row={row} />
            </span>
            <DayBadges state={state} row={row} />
            {row?.note && (
              <span className="text-[13px] break-words text-neutral-700">Reason: {row.note}</span>
            )}
          </li>
        ))}
      </ul>
      <LoadMore
        shown={Math.min(shown, newest.length)}
        total={newest.length}
        onLoadMore={() => setShown((n) => n + DAYS_SHOWN)}
      />
    </>
  );
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function Summary({ staff, firstIns, today, from, to }: RangeProps) {
  const rows = useDays(from, to);
  if (rows.error) return <NeedsInternet />;
  if (rows.loading) return <Loading />;
  const people = peopleIn(staff, rows.data);
  const days = personDays(people, rows.data, { from, to }, today, firstIns);
  const totals = people.map((person) => totalsFor(person, days));
  const unfixed = totals.reduce((sum, t) => sum + t.noOut, 0);
  const stillOpen = to === today && days.some((d) => d.state === 'in');
  return (
    <>
      <p className="m-0 text-[13px] text-neutral-700">
        {daysBetween(from, to).length} days. Days counted: 1 for a whole day, less for a half day.
        Pay is worked out in payroll, after go-live.
      </p>
      {unfixed > 0 && (
        <Alert variant="warn">
          {unfixed} {unfixed === 1 ? 'day has' : 'days have'} no time out and{' '}
          {unfixed === 1 ? 'counts' : 'count'} for nothing until fixed.
        </Alert>
      )}
      {stillOpen && (
        <Alert variant="info">Today is still open: it counts once each person clocks out.</Alert>
      )}
      <div className="flex flex-wrap gap-[10px]">
        <Csv
          label="Summary (CSV)"
          onClick={() =>
            download(`attendance-summary-${from}-to-${to}.csv`, summaryCsv(totals, { from, to }))
          }
        />
        <Csv
          label="Every day (CSV)"
          onClick={() => download(`attendance-days-${from}-to-${to}.csv`, daysCsv(days))}
        />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-[12px] sm:grid-cols-2 xl:grid-cols-3">
        {totals.map((t) => (
          <TotalsCard key={t.person.id} totals={t} />
        ))}
      </div>
    </>
  );
}

function Csv({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="secondary" size="md" className="self-start" onClick={onClick}>
      <Download size={15} strokeWidth={ICON_STROKE} aria-hidden />
      {label}
    </Button>
  );
}

function TotalsCard({ totals: t }: { totals: Totals }) {
  const lines: [label: string, value: string | number][] = [
    ['Whole days', t.whole],
    ['Morning half days', t.morningHalf],
    ['Afternoon half days', t.afternoonHalf],
    ['Late', `${t.lateCount}× · ${t.lateMinutes} min`],
    ['Early out', `${t.earlyCount}× · ${t.earlyMinutes} min`],
    ['Overtime', `${t.overtimeMinutes} min`],
    ['Absent', t.absent],
    ['Rest days', t.rest],
    ['No time out', t.noOut],
    ['Days to review', t.toReview],
    ['Late deductions', formatPeso(t.flatDeductions)],
  ];
  if (t.minutesToPrice > 0) lines.push(['Late, priced in payroll', `${t.minutesToPrice} min`]);
  return (
    <Card asChild>
      <section aria-label={t.person.name}>
        <div className="flex items-baseline justify-between gap-[10px]">
          <h2 className="m-0 min-w-0 font-body text-[16px] font-bold break-words">
            {t.person.name}
          </h2>
          <span className="flex-none text-[13px] text-neutral-700">
            <b className="font-heading text-[22px] text-text tabular-nums">{t.credit}</b> days
            counted
          </span>
        </div>
        <dl className="m-0 flex flex-col text-[14px]">
          {lines.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-[10px] py-[3px]">
              <dt className="min-w-0 text-neutral-700">{label}</dt>
              <dd className="m-0 text-right tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Card>
  );
}
