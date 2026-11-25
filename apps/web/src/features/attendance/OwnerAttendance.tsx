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
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { download } from '@/features/catalog/export';
import { formatPeso } from '@/lib/money';
import { cn, ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { flagText, manilaDay, timeText } from './clock';
import { DayMore, DayTags } from './DayBadges';
import { dayParts, dayText, useMore } from './dayRow';
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
  stateLabel,
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
  const flagged = days.filter(({ row }) => toReview(row).length > 0);
  const count = (test: (day: PersonDay) => boolean) => days.filter(test).length;
  const late = count(({ row }) => !!row && row.lateMinutes > 0);

  return (
    <>
      {/* One summary line (cleanup round 1): how many are in, then only what needs a look. */}
      <section
        aria-label="Today’s counts"
        className="flex flex-col gap-[8px] md:flex-row md:flex-wrap md:items-center md:gap-x-[18px]"
      >
        <p className="m-0 flex items-baseline gap-[8px]">
          <span className="font-heading text-[40px] leading-none tabular-nums md:text-[44px]">
            {count(({ row }) => row?.kind === 'worked')}
          </span>
          <span className="text-[16px] font-bold">of {days.length} in</span>
        </p>
        {(late > 0 || flagged.length > 0 || noOut.length > 0) && (
          <span className="flex flex-wrap gap-[6px]">
            {late > 0 && <SummaryTag tone="warn">{late} late</SummaryTag>}
            {flagged.length > 0 && <SummaryTag tone="warn">{flagged.length} flagged</SummaryTag>}
            {noOut.length > 0 && <SummaryTag tone="danger">{noOut.length} no time out</SummaryTag>}
          </span>
        )}
        <p className="m-0 text-[15px]">
          Not in yet <b>{count(({ state }) => state === 'not_in')}</b> · Rest day{' '}
          <b>{count(({ state }) => state === 'rest')}</b> · Absent{' '}
          <b>{count(({ state }) => state === 'absent')}</b> · Left early{' '}
          <b>{count(({ row }) => !!row && row.earlyMinutes > 0)}</b>
        </p>
      </section>

      {noOut.length + flagged.length > 0 && <NeedsYou noOut={noOut} flagged={flagged} />}

      <section
        aria-label="Today’s board"
        className="flex flex-col rounded-[12px] bg-surface px-[14px] pt-[10px] pb-[4px] md:px-[18px]"
      >
        <h2 className="m-0 pb-[4px] font-body text-[15px] font-extrabold">
          Everyone · {dayName(today)}
        </h2>
        {days.length === 0 ? (
          <p className="pb-[8px] text-neutral-700">
            No staff yet. Add them in Settings &gt; Users.
          </p>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col p-0 md:hidden">
              {days.map((day) => (
                <PersonLine key={day.person.id} day={day} today={today} />
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>In</TableHead>
                    <TableHead>Out</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.map((day) => (
                    <PersonRow key={day.person.id} day={day} today={today} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>
    </>
  );
}

function SummaryTag({ tone, children }: { tone: 'warn' | 'danger'; children: ReactNode }) {
  return (
    <StatusBadge tone={tone} className="px-[10px] py-[5px] text-[13px]">
      {children}
    </StatusBadge>
  );
}

const historyOf = (id: string) => `/attendance?tab=history&person=${id}`;
const fixOf = (id: string, day: string) => `/attendance?tab=fix&person=${id}&day=${day}`;

/** The day's kind in words, for the Day column and the phone line. */
function dayWord({ state, row }: Pick<PersonDay, 'state' | 'row'>): string {
  const text = dayText({ state, row });
  if (state === 'in') return 'Working';
  if (state === 'done' || state === 'absent') return text.sub ?? text.title;
  return text.title;
}

/** A person not in yet is marked from here: absent or rest day, on the Fix tab. */
function MarkLink({
  day,
  today,
  short = false,
}: {
  day: PersonDay;
  today: string;
  short?: boolean;
}) {
  return (
    <Link
      to={fixOf(day.person.id, today)}
      aria-label={`Mark ${day.person.name} absent or rest day`}
      className="inline-flex min-h-[44px] items-center text-[14px] font-bold text-text"
    >
      {short ? 'Mark ›' : 'Mark absent or rest day ›'}
    </Link>
  );
}

/** Laptop: one table row, and the details of "+N" in a row under it. */
function PersonRow({ day, today }: { day: PersonDay; today: string }) {
  const more = useMore();
  const parts = dayParts(day);
  const { person, row, state } = day;
  const worked = row?.kind === 'worked' ? row : null;
  const quiet = !worked;
  return (
    <>
      <TableRow {...more.rowProps}>
        <TableCell>
          <Link to={historyOf(person.id)} className="font-bold text-text hover:underline">
            {person.name}
          </Link>
        </TableCell>
        <TableCell
          className={cn('whitespace-nowrap tabular-nums', !worked?.inAt && 'text-neutral-700')}
        >
          {worked?.inAt ? timeText(worked.inAt) : '–'}
        </TableCell>
        <TableCell
          className={cn('whitespace-nowrap tabular-nums', !worked?.outAt && 'text-neutral-700')}
        >
          {worked?.outAt ? outText(worked) : '–'}
        </TableCell>
        <TableCell className={cn(quiet && 'text-neutral-700')}>{dayWord(day)}</TableCell>
        <TableCell>
          {state === 'not_in' ? (
            <MarkLink day={day} today={today} />
          ) : (
            <DayTags parts={parts} open={more.open} onToggle={more.toggle} label={person.name} />
          )}
        </TableCell>
      </TableRow>
      {more.open && parts.more.length > 0 && (
        <TableRow {...more.rowProps}>
          <TableCell colSpan={5} className="pt-0">
            <DayMore parts={parts} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** Phone: name, time, one tag and "+N"; the whole list scrolls, nobody is cut off. */
function PersonLine({ day, today }: { day: PersonDay; today: string }) {
  const more = useMore();
  const parts = dayParts(day);
  const { person, row, state } = day;
  const worked = row?.kind === 'worked' && row.inAt ? row : null;
  return (
    <li className="flex flex-col border-b border-divider last:border-b-0" {...more.rowProps}>
      <div className="flex min-h-[52px] flex-wrap items-center gap-x-[10px] gap-y-[4px] py-[6px]">
        <Link
          to={historyOf(person.id)}
          className="min-w-0 text-[15px] font-bold text-text [overflow-wrap:anywhere]"
        >
          {person.name}
        </Link>
        <span
          className={cn(
            'text-[14px] tabular-nums',
            worked ? 'whitespace-nowrap' : 'text-neutral-700',
          )}
        >
          {worked ? dayText(day).title : dayWord(day)}
        </span>
        <span className="ml-auto flex items-center gap-[6px]">
          {state === 'not_in' ? (
            <MarkLink day={day} today={today} short />
          ) : (
            <DayTags parts={parts} open={more.open} onToggle={more.toggle} label={person.name} />
          )}
        </span>
      </div>
      {more.open && parts.more.length > 0 && <DayMore parts={parts} className="mb-[8px]" />}
    </li>
  );
}

const NEEDS_SHOWN = 5;

/**
 * What the Owner must act on, in one list (cleanup round 1): days with no time out in the
 * last 30 days (Fix), then today's flagged days (View).
 */
function NeedsYou({ noOut, flagged }: { noOut: DayRow[]; flagged: PersonDay[] }) {
  const [shown, setShown] = useState(NEEDS_SHOWN);
  const items = [
    ...noOut.map((row) => ({
      key: row.id,
      name: row.userName,
      tag: <StatusBadge tone="danger">No time out</StatusBadge>,
      when: `${dayName(row.workDate)}${row.inAt ? ` · in ${timeText(row.inAt)}` : ''}`,
      action: (
        <Button asChild variant="secondary" size="md" className="flex-none">
          <Link
            to={fixOf(row.userId, row.workDate)}
            aria-label={`Fix ${row.userName}, ${dayName(row.workDate)}`}
          >
            Fix
          </Link>
        </Button>
      ),
    })),
    ...flagged.map(({ person, row }) => {
      const worked = row?.kind === 'worked' ? row : null;
      const why = worked ? toReview(row).map((flag) => flagText(flag, worked)) : [];
      return {
        key: `flag-${person.id}`,
        name: person.name,
        tag: <StatusBadge tone="warn">Flagged</StatusBadge>,
        when: [`today${worked?.inAt ? ` · in ${timeText(worked.inAt)}` : ''}`, ...why].join(' · '),
        action: (
          <Button asChild variant="secondary" size="md" className="flex-none">
            <Link to={historyOf(person.id)} aria-label={`View ${person.name}, today`}>
              View
            </Link>
          </Button>
        ),
      };
    }),
  ];
  return (
    <section
      aria-label="Needs you"
      className="flex flex-col rounded-[12px] bg-surface px-[14px] pt-[10px] md:px-[18px]"
    >
      <h2 className="m-0 font-body text-[15px] font-extrabold">Needs you · {items.length}</h2>
      {/* Money: a day with no time out isn't paid until it's fixed (ATT-11). */}
      {noOut.length > 0 && (
        <p className="m-0 pb-[6px] text-[13px] text-neutral-700">
          A day with no time out counts for nothing until it’s fixed.
        </p>
      )}
      <ul className="m-0 flex list-none flex-col p-0">
        {items.slice(0, shown).map((item) => (
          <li
            key={item.key}
            className="flex min-h-[56px] items-center gap-[12px] border-t border-divider py-[6px] text-[14.5px]"
          >
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[8px] gap-y-[4px]">
              <b className="w-full [overflow-wrap:anywhere] md:order-2 md:w-auto">{item.name}</b>
              <span className="md:order-1">{item.tag}</span>
              <span className="min-w-0 text-neutral-700 [overflow-wrap:anywhere] md:order-3">
                <span className="hidden md:inline">· </span>
                {item.when}
              </span>
            </span>
            {item.action}
          </li>
        ))}
      </ul>
      <LoadMore
        shown={Math.min(shown, items.length)}
        total={items.length}
        onLoadMore={() => setShown((n) => n + 20)}
      />
    </section>
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

/** What the day is in words (not a tag), then its tags; "+N" opens on the day's history. */
function DayKind({
  state,
  row,
  more,
  label,
}: Pick<PersonDay, 'state' | 'row'> & { more?: ReturnType<typeof useMore>; label?: string }) {
  const parts = dayParts({ state, row });
  // The red tag already says "No time out" or "Absent"; the kind of absent stays in words.
  const kind =
    state === 'no_out'
      ? null
      : state === 'absent'
        ? dayText({ state, row }).sub
        : stateLabel({ state, row });
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[6px]">
      {kind && <span className="text-[13px] text-neutral-700">{kind}</span>}
      <DayTags parts={parts} open={more?.open} onToggle={more?.toggle} label={label} />
    </span>
  );
}

function HistoryDay({ day, row, state }: Pick<PersonDay, 'day' | 'state' | 'row'>) {
  const more = useMore();
  const parts = dayParts({ state, row });
  return (
    <li className="flex flex-col gap-[5px] border-b border-divider py-[10px]" {...more.rowProps}>
      <span className="flex flex-wrap items-baseline justify-between gap-x-[10px]">
        <span className="text-[15px] font-bold">{dayName(day)}</span>
        <Times row={row} />
      </span>
      <DayKind state={state} row={row} more={more} label={dayName(day)} />
      {more.open && parts.more.length > 0 && <DayMore parts={parts} />}
    </li>
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
          <HistoryDay key={day} day={day} row={row} state={state} />
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
