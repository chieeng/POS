import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatPeso } from '@/lib/money';
import { describeDrawerError, openDrawer, parsePeso, type DrawerToday } from './data';
import { dayBefore, shortDay, timeLabel } from './format';
import { PesoInput } from './PesoInput';

const plain = (amount: number) => amount.toFixed(2);

/**
 * Cash Drawer.dc.html 8a (SHIFT-01): the first staff member of the day enters the opening
 * cash, pre-filled from the last closing count. An amount that differs needs a reason; the
 * Owner sees the difference on the drawer report.
 */
export function OpenDrawerForm({
  drawer,
  onOpened,
}: {
  drawer: DrawerToday;
  onOpened: () => void;
}) {
  const last = drawer.lastCount;
  const [amount, setAmount] = useState(last ? plain(last.amount) : '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const value = parsePeso(amount);
  const difference = last && value !== null ? value - last.amount : 0;
  const yesterday = last?.businessDate === dayBefore(drawer.today);
  const lastName = yesterday
    ? 'yesterday’s count'
    : `the ${shortDay(last?.businessDate ?? '')} count`;

  const submit = async () => {
    setError(null);
    if (value === null) {
      setError('Enter the cash in the drawer, for example 2000.');
      return;
    }
    if (difference !== 0 && !reason.trim()) {
      setError('Say why the amount differs from the last count.');
      return;
    }
    setBusy(true);
    try {
      await openDrawer(value, difference !== 0 ? reason.trim() : null);
      onOpened();
    } catch (caught) {
      setError(describeDrawerError(caught));
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
      {drawer.staleOpen && (
        <Alert variant="info">
          An earlier drawer was never counted. Opening today’s closes it as “not counted”, and the
          Owner sees it on the drawer report.
        </Alert>
      )}
      <div className="flex flex-col gap-[6px]">
        <Label htmlFor="opening-cash" className="text-[13px]">
          Opening cash
        </Label>
        <PesoInput
          id="opening-cash"
          value={amount}
          placeholder="0.00"
          warn={difference !== 0}
          onChange={(event) => setAmount(event.target.value)}
        />
        {last && (
          <p className="px-[8px] text-[13px] text-neutral-700">
            {yesterday ? 'Yesterday’s' : `Last (${shortDay(last.businessDate)})`} closing count:{' '}
            {formatPeso(last.amount)} ({last.countedByName}, {timeLabel(last.closedAt)})
          </p>
        )}
      </div>

      {difference !== 0 && (
        <>
          <Alert variant="warn">
            <b>
              {formatPeso(Math.abs(difference))} {difference < 0 ? 'less' : 'more'} than {lastName}.
            </b>{' '}
            The Owner will see this on the drawer report.
          </Alert>
          <div className="flex flex-col gap-[6px]">
            <Label htmlFor="opening-reason" className="text-[13px]">
              Reason · required when changed
            </Label>
            <textarea
              id="opening-reason"
              value={reason}
              maxLength={200}
              rows={3}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-[80px] rounded-[24px] border-2 border-divider bg-surface px-[16px] py-[12px] text-[14.5px] leading-[1.45] outline-none focus-visible:border-accent"
            />
          </div>
        </>
      )}

      {error && <Alert variant="danger">{error}</Alert>}

      <Button needsInternet type="submit" size="lg" disabled={busy}>
        {busy ? 'Opening…' : 'Open drawer'}
      </Button>
      {last && difference !== 0 && (
        <Button
          variant="ghost"
          className="min-h-11 w-full font-body font-semibold text-accent-700"
          onClick={() => {
            setAmount(plain(last.amount));
            setError(null);
          }}
        >
          Reset to {formatPeso(last.amount)}
        </Button>
      )}
    </form>
  );
}
