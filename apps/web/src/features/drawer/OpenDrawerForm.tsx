import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/info-tip';
import { Label } from '@/components/ui/label';
import { formatPeso } from '@/lib/money';
import { useSession } from '@/stores/session';
import {
  countedTotal,
  describeDrawerError,
  emptyCounts,
  openDrawer,
  openingMismatch,
  type Counts,
  type DrawerToday,
  type LastCount,
  type OpeningMismatch,
} from './data';
import { DenominationList } from './DenominationList';
import { dayBefore, manilaDay, shortDay, timeLabel } from './format';

/**
 * Cash Drawer.dc.html 8a (SHIFT-01; the owner's decisions of Nov 27, 2026): the first staff
 * member of the day counts the drawer by denomination, from empty. The count is blind, for the
 * Owner too: the last count shows only when the opening count differs from it, and then a
 * reason is needed; the Owner sees the difference on the drawer report.
 */
export function OpenDrawerForm({
  drawer,
  onOpened,
}: {
  drawer: DrawerToday;
  onOpened: () => void;
}) {
  const role = useSession((s) => s.user?.role);
  // SHIFT-03: only the Owner and Special Sales count a drawer.
  const canCount = role === 'owner' || role === 'special_sales';
  const [counts, setCounts] = useState<Counts>(emptyCounts);
  const [mismatch, setMismatch] = useState<OpeningMismatch | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const counted = countedTotal(counts);
  // A difference the server told belongs to the count it was told for; a new count asks again.
  const shown = mismatch && mismatch.counted === counted ? mismatch : null;

  const submit = async () => {
    setError(null);
    if (shown && !reason.trim()) {
      setError('Say why the count differs from the last count.');
      return;
    }
    setBusy(true);
    try {
      await openDrawer(counts, shown ? reason.trim() : null);
      onOpened();
    } catch (caught) {
      const told = openingMismatch(caught);
      if (told) setMismatch(told);
      else setError(describeDrawerError(caught));
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-[16px]"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {drawer.staleOpen &&
        (drawer.stale && canCount ? (
          // The owner's decision of Nov 13, 2026: count it first, before today's opens.
          <Alert variant="warn">
            <b>{shortDay(drawer.stale.businessDate)}’s drawer was never closed.</b> Count and close
            it first, before any of today’s cash goes in. If you open today’s drawer now instead, it
            is closed as “not counted”.
            <Button asChild variant="secondary" size="md" className="mt-[8px]">
              <Link to="/drawer/count">
                Count and close {shortDay(drawer.stale.businessDate)}’s drawer
              </Link>
            </Button>
          </Alert>
        ) : (
          <Alert variant="info">
            An earlier drawer was never counted. Ask the Owner or Special Sales to count it first;
            opening today’s closes it as “not counted”, and the Owner sees it on the drawer report.
          </Alert>
        ))}

      {/* Round 3 (pop-up set 2): one raised card; the count, its total and Open drawer. */}
      <section
        aria-label="Count the opening cash"
        className="flex flex-col gap-[12px] rounded-[16px] bg-surface px-[16px] pt-[14px] pb-[16px] shadow-[var(--shadow-md)] md:px-[20px]"
      >
        <h2 className="flex items-center gap-[6px] font-body text-[16px] font-semibold">
          Count the opening cash
          <InfoTip label="About the opening count">
            Count the cash in the drawer, bill by bill. It is checked against the last count when
            you open the drawer.
          </InfoTip>
        </h2>
        <DenominationList counts={counts} onChange={setCounts} />
        <div className="flex items-baseline justify-between">
          <span className="text-[16px] font-semibold">Opening cash</span>
          <span className="font-heading text-[28px] tabular-nums" aria-label="Opening cash">
            {formatPeso(counted)}
          </span>
        </div>

        {shown && (
          <>
            <Alert variant="warn">
              <b>
                {formatPeso(Math.abs(shown.difference))} {shown.difference < 0 ? 'less' : 'more'}{' '}
                than {lastCountText(shown.lastCount, drawer.today)}.
              </b>{' '}
              Count again, or say why.
              <InfoTip label="About the difference" className="ml-[6px]">
                The Owner will see this on the drawer report.
              </InfoTip>
            </Alert>
            <div className="flex flex-col gap-[6px]">
              <Label htmlFor="opening-reason" className="text-[13px]">
                Reason · required when it differs
              </Label>
              <textarea
                id="opening-reason"
                value={reason}
                maxLength={200}
                rows={3}
                onChange={(event) => setReason(event.target.value)}
                className="min-h-[80px] rounded-[12px] border-2 border-transparent bg-neutral-200 px-[14px] py-[12px] text-[14.5px] leading-[1.45] outline-none focus-visible:border-accent"
              />
            </div>
          </>
        )}

        {error && <Alert variant="danger">{error}</Alert>}

        <Button needsInternet type="submit" variant="money" size="lg" disabled={busy}>
          {busy ? 'Opening…' : 'Open drawer'}
        </Button>
      </section>
    </form>
  );
}

/**
 * Which count the opening was compared with: yesterday's, an earlier day's, one counted on a
 * later day (the overnight count), or one taken before the drawer was reopened.
 */
function lastCountText(last: LastCount, today: string): string {
  const amount = formatPeso(last.amount);
  if (last.beforeReopen) {
    return `the count taken before the drawer was reopened (${amount}, ${last.countedByName}, ${shortDay(last.businessDate)} ${timeLabel(last.closedAt)})`;
  }
  const countedDay = manilaDay(last.closedAt);
  if (countedDay > last.businessDate) {
    const when = countedDay === today ? 'today' : shortDay(countedDay);
    return `${shortDay(last.businessDate)}’s count (${amount}, counted later, ${when} ${timeLabel(last.closedAt)}, by ${last.countedByName})`;
  }
  const day =
    last.businessDate === dayBefore(today) ? 'yesterday’s' : `${shortDay(last.businessDate)}’s`;
  return `${day} closing count (${amount}, ${last.countedByName}, ${timeLabel(last.closedAt)})`;
}
