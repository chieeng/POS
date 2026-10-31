import { CircleCheck, CircleMinus, CirclePlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Stepper } from '@/components/ui/stepper';
import { PageHeader } from '@/features/settings/PageHeader';
import { formatPeso } from '@/lib/money';
import { cn, ICON_STROKE } from '@/lib/utils';
import {
  closeDrawer,
  countedTotal,
  DENOMINATIONS,
  describeDrawerError,
  emptyCounts,
  useDrawerToday,
  type CloseResult,
  type Counts,
} from './data';
import { timeLabel } from './format';

const billLabel = (bill: number) => `₱${bill.toLocaleString('en-PH')}`;

/**
 * Cash Drawer.dc.html 8c/8d (SHIFT-03): the Owner or Special Sales counts the drawer by
 * denomination and closes it. The count is blind: expected cash and the over/short come
 * back from the server only after the count is in (the Owner's decision, Oct 31, 2026).
 */
export function CountDrawerPage() {
  const drawer = useDrawerToday();
  const [counts, setCounts] = useState<Counts>(emptyCounts);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloseResult | null>(null);
  const session = drawer.data?.session ?? null;
  const counted = countedTotal(counts);

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await closeDrawer(counts, note.trim() || null));
      setConfirming(false);
    } catch (caught) {
      const { message } = (caught ?? {}) as { message?: unknown };
      setError(
        message === 'drawer_not_open'
          ? 'No drawer is open any more: someone may have closed it already.'
          : describeDrawerError(caught),
      );
      setConfirming(false);
      drawer.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full max-w-[1040px] flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <PageHeader title="Count the drawer" backTo="/drawer" backLabel="Back to the drawer" />

      {drawer.error ? (
        <Alert variant="danger">
          <b>Couldn’t load the drawer.</b> Check your connection and try again.
        </Alert>
      ) : drawer.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : result ? (
        <Revealed result={result} />
      ) : !session || session.status !== 'open' ? (
        <>
          {error && <Alert variant="danger">{error}</Alert>}
          <p className="px-[4px] text-neutral-700">
            There is no open drawer to count. <Link to="/drawer">Back to the drawer</Link>
          </p>
        </>
      ) : (
        <div className="grid gap-[18px] md:grid-cols-[1fr_300px] xl:grid-cols-[1fr_340px]">
          <ul
            aria-label="Bills and coins"
            className="grid content-start md:grid-cols-2 md:gap-x-[24px]"
          >
            {DENOMINATIONS.map((bill) => (
              <li
                key={bill}
                className="flex min-h-[52px] items-center gap-[8px] border-b border-text/8 md:min-h-[60px]"
              >
                <span className="w-[68px] text-[15px] font-bold md:w-[60px]">
                  {billLabel(bill)}
                </span>
                <span aria-hidden className="text-[13px] text-neutral-700 md:hidden">
                  ×
                </span>
                <Stepper
                  editable
                  label={`Number of ${billLabel(bill)}`}
                  value={counts[bill]}
                  max={100000}
                  onChange={(value) => setCounts((current) => ({ ...current, [bill]: value }))}
                  className="w-[118px] border-0 md:w-[124px]"
                />
                <span className="flex-1 text-right text-[14.5px] tabular-nums">
                  {formatPeso(bill * counts[bill])}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-[10px] md:rounded-[30px] md:bg-neutral-100 md:p-[20px]">
            <h2 className="hidden text-[20px] md:block">Today’s drawer</h2>
            <p className="hidden text-[14px] text-neutral-700 md:block">
              Opened at {timeLabel(session.openedAt)} by {session.openedByName}, with{' '}
              {formatPeso(session.openingCash)}.
            </p>
            <div className="flex justify-between text-[16px] font-bold md:border-t md:border-divider md:pt-[8px]">
              <span>Counted</span>
              <span className="tabular-nums">{formatPeso(counted)}</span>
            </div>
            <p className="text-[13px] text-neutral-700">
              Expected cash and any difference show after you close the drawer.
            </p>
            <div className="flex flex-col gap-[6px]">
              <Label htmlFor="closing-note" className="text-[13px]">
                Note for the Owner (optional)
              </Label>
              <textarea
                id="closing-note"
                value={note}
                maxLength={200}
                rows={2}
                placeholder="For example: one ₱500 bill looks torn"
                onChange={(event) => setNote(event.target.value)}
                className="min-h-[64px] rounded-[22px] border border-divider bg-bg px-[14px] py-[10px] text-[14px] outline-none focus-visible:border-accent"
              />
            </div>
            {error && <Alert variant="danger">{error}</Alert>}
            <Button
              needsInternet
              className="min-h-[54px] w-full text-[18px]"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Close drawer
            </Button>
          </div>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={(open) => !open && !busy && setConfirming(false)}>
        <DialogContent>
          <DialogTitle>Close today’s drawer with {formatPeso(counted)} counted?</DialogTitle>
          <DialogDescription>
            The count can’t be changed after closing. Later sales go to tomorrow’s drawer.
          </DialogDescription>
          <DialogActions>
            <DialogClose asChild>
              <Button variant="secondary" className="min-h-[46px] px-[18px]" disabled={busy}>
                Keep counting
              </Button>
            </DialogClose>
            <Button
              needsInternet
              className="min-h-[46px] px-[22px]"
              disabled={busy}
              onClick={() => void close()}
            >
              {busy ? 'Closing…' : 'Close drawer'}
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** After closing: what was expected, what was counted, and the exact difference. */
function Revealed({ result }: { result: CloseResult }) {
  const { expected, counted, overShort } = result;
  const short = overShort < 0;
  const Icon = overShort === 0 ? CircleCheck : short ? CircleMinus : CirclePlus;
  return (
    <div className="flex max-w-[480px] flex-col gap-[8px] text-[15px]">
      <p role="status" className="px-[4px] text-neutral-800">
        The drawer is closed.
      </p>
      <div className="flex justify-between px-[4px]">
        <span>Expected</span>
        <span className="tabular-nums">{formatPeso(expected)}</span>
      </div>
      <div className="flex justify-between px-[4px] font-bold">
        <span>Counted</span>
        <span className="tabular-nums">{formatPeso(counted)}</span>
      </div>
      <div
        className={cn(
          'flex items-center justify-between rounded-full px-[16px] py-[10px] font-bold',
          short ? 'bg-danger-bg text-danger-fg' : 'bg-accent-2-100 text-accent-2-800',
        )}
      >
        <span className="flex items-center gap-[6px]">
          <Icon size={17} strokeWidth={ICON_STROKE} aria-hidden />
          {overShort === 0 ? 'Exact' : short ? 'Short' : 'Over'}
        </span>
        <span className="font-heading text-[22px] font-normal">
          {overShort === 0
            ? formatPeso(0)
            : `${short ? '−' : '+'}${formatPeso(Math.abs(overShort))}`}
        </span>
      </div>
      <Button asChild variant="secondary" size="md" className="mt-[8px] self-start">
        <Link to="/drawer">Done</Link>
      </Button>
    </div>
  );
}
