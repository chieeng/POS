import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Calculator,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CirclePlus,
  Download,
  HandCoins,
  Lock,
  LockOpen,
  RotateCcw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { download } from '@/features/catalog/export';
import { PageHeader } from '@/features/settings/PageHeader';
import { formatPeso } from '@/lib/money';
import { cn, ICON_STROKE } from '@/lib/utils';
import { describeDrawerError } from './data';
import { shortDay, timeLabel } from './format';
import {
  drawerCsv,
  expectedFrom,
  movements,
  reopenDrawer,
  useDrawerDay,
  useDrawerEntries,
  useLatestDrawer,
  type DrawerEntryRecord,
  type DrawerRecord,
  type Movement,
} from './report';

const manilaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

const signed = (amount: number) =>
  `${amount < 0 ? '−' : amount > 0 ? '+' : ''}${formatPeso(Math.abs(amount))}`;

const MOVE_ICONS: Record<Movement['kind'], LucideIcon> = {
  opened: LockOpen,
  cash_in: ArrowDownToLine,
  cash_out: ArrowUpFromLine,
  closed: Lock,
  not_counted: CircleAlert,
};

/**
 * Cash Drawer.dc.html 8e (SHIFT-04): the Owner's drawer report for one day, live: how it
 * opened (and any difference from the last count), every cash in and out, expected cash,
 * the count and the exact over/short. The Owner can reopen the latest drawer with a reason
 * and download the day as CSV. Sales by payment method and salesperson join with checkout.
 */
export function DrawerReportPage() {
  const [params, setParams] = useSearchParams();
  const today = manilaToday();
  const day = params.get('date') ?? today;
  const drawer = useDrawerDay(day);
  const record = drawer.data[0] ?? null;
  const entries = useDrawerEntries(record?.id);
  const latest = useLatestDrawer();
  const [reopening, setReopening] = useState(false);

  const canReopen = record !== null && record.status !== 'open' && latest.data[0]?.id === record.id;

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-[18px] p-[14px] md:px-[26px] md:py-[22px] xl:px-[36px] xl:py-[28px]">
      <PageHeader
        title={`Drawer · ${shortDay(day)}`}
        backTo="/drawer"
        backLabel="Back to the drawer"
      >
        <input
          type="date"
          aria-label="Day"
          value={day}
          max={today}
          onChange={(event) => {
            if (event.target.value) setParams({ date: event.target.value }, { replace: true });
          }}
          className="h-[40px] rounded-full bg-surface px-[14px] text-[14px]"
        />
        <Button
          variant="secondary"
          className="min-h-[40px]"
          disabled={!record}
          onClick={() => record && download(`drawer-${day}.csv`, drawerCsv(record, entries.data))}
        >
          <Download size={15} strokeWidth={ICON_STROKE} aria-hidden />
          CSV
        </Button>
      </PageHeader>

      {drawer.error ? (
        <Alert variant="danger">
          <b>The drawer needs internet.</b> Connect and try again.
        </Alert>
      ) : drawer.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : !record ? (
        <p className="px-[4px] text-neutral-700">No drawer was opened on this day.</p>
      ) : (
        <Report
          record={record}
          entries={entries.data}
          canReopen={canReopen}
          onReopen={() => setReopening(true)}
        />
      )}

      {record && (
        <ReopenDialog
          open={reopening}
          sessionId={record.id}
          day={record.businessDate}
          onOpenChange={setReopening}
        />
      )}
    </div>
  );
}

function Report({
  record,
  entries,
  canReopen,
  onReopen,
}: {
  record: DrawerRecord;
  entries: DrawerEntryRecord[];
  canReopen: boolean;
  onReopen: () => void;
}) {
  const { cashIn, cashOut, expected: expectedNow } = expectedFrom(record, entries);
  const expected = record.expectedCash ?? expectedNow;
  const difference = record.prefillDifference ?? 0;
  const rows = movements(record, entries);

  return (
    <>
      <div className="grid gap-[14px] sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={difference === 0 ? LockOpen : TriangleAlert}
          tone={difference === 0 ? 'plain' : 'warn'}
          label="Opened"
          value={formatPeso(record.openingCash)}
          sub={
            record.prefillCash === null
              ? `${timeLabel(record.openedAt)} by ${record.openedByName}`
              : difference === 0
                ? `Same as the last count · ${record.openedByName}`
                : `${formatPeso(Math.abs(difference))} ${difference < 0 ? 'less' : 'more'} than the last count · reason given`
          }
        />
        <SummaryCard
          icon={Calculator}
          label={record.status === 'open' ? 'Expected so far' : 'Expected'}
          value={formatPeso(expected)}
          sub="Opening + cash in − cash out"
        />
        <SummaryCard
          icon={HandCoins}
          label="Counted"
          value={record.countedCash === null ? '—' : formatPeso(record.countedCash)}
          sub={
            record.status === 'closed'
              ? `Closed ${record.closedAt ? timeLabel(record.closedAt) : ''} by ${record.closedByName ?? ''}`
              : record.status === 'not_counted'
                ? 'Never counted'
                : 'Still open'
          }
        />
        <OverShortCard overShort={record.overShort} status={record.status} />
      </div>

      {record.status === 'not_counted' && (
        <Alert variant="warn">
          Nobody counted this drawer. It was closed when the next day&apos;s drawer opened.
        </Alert>
      )}

      <div className="grid gap-[16px] xl:grid-cols-[1.6fr_1fr]">
        <div className="rounded-[30px] bg-surface px-[14px] py-[10px] md:px-[22px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reason / note</TableHead>
                <TableHead>By</TableHead>
                <TableHead numeric>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((move, index) => {
                const Icon = MOVE_ICONS[move.kind];
                return (
                  <TableRow key={index}>
                    <TableCell className="whitespace-nowrap">
                      {move.at ? timeLabel(move.at) : '—'}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-[5px] font-semibold whitespace-nowrap">
                        <Icon
                          size={14}
                          strokeWidth={ICON_STROKE}
                          className="text-neutral-700"
                          aria-hidden
                        />
                        {move.type}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-[180px]">{move.note}</TableCell>
                    <TableCell>{move.by}</TableCell>
                    <TableCell
                      numeric
                      className={cn(
                        'font-bold',
                        move.amount !== null && move.amount < 0 && 'text-danger-fg',
                      )}
                    >
                      {move.amount === null
                        ? '—'
                        : move.kind === 'cash_in' || move.kind === 'cash_out'
                          ? signed(move.amount)
                          : formatPeso(move.amount)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-[8px] rounded-[30px] bg-neutral-100 p-[22px] text-[14.5px]">
          <h2 className="mb-[4px] text-[20px]">Expected cash</h2>
          <Line label="Opening cash" value={formatPeso(record.openingCash)} />
          <Line label="Cash in" value={formatPeso(cashIn)} />
          <Line label="Cash out" value={`−${formatPeso(cashOut)}`} negative={cashOut > 0} />
          <div className="flex justify-between border-t border-divider pt-[8px] font-bold">
            <span>Expected</span>
            <span className="tabular-nums">{formatPeso(expected)}</span>
          </div>
          {record.countedCash !== null && (
            <div className="flex justify-between font-bold">
              <span>
                Counted by {record.closedByName}
                {record.closedAt ? `, ${timeLabel(record.closedAt)}` : ''}
              </span>
              <span className="tabular-nums">{formatPeso(record.countedCash)}</span>
            </div>
          )}
          {record.openingReason && (
            <p className="mt-[6px] text-[13px] text-neutral-700">
              Why the opening differed: {record.openingReason}
            </p>
          )}
          {record.closingNote && (
            <p className="text-[13px] text-neutral-700">Note at closing: {record.closingNote}</p>
          )}
          <p className="mt-[6px] text-[13px] text-neutral-700">
            Cash sales, refunds and utang payments join this list with checkout.
          </p>
          {canReopen && (
            <Button
              needsInternet
              variant="secondary"
              size="md"
              className="mt-[8px] self-start"
              onClick={onReopen}
            >
              <RotateCcw size={16} strokeWidth={ICON_STROKE} aria-hidden />
              Reopen this drawer
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'plain',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  tone?: 'plain' | 'warn' | 'danger' | 'ok';
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-[4px] rounded-[30px] px-[20px] py-[18px]',
        tone === 'plain' && 'bg-surface text-text',
        tone === 'warn' && 'bg-warn-bg text-warn-fg',
        tone === 'danger' && 'bg-danger-bg text-danger-fg',
        tone === 'ok' && 'bg-accent-2-100 text-accent-2-800',
      )}
    >
      <span className="flex items-center gap-[6px] text-[13.5px]">
        <Icon size={15} strokeWidth={ICON_STROKE} aria-hidden />
        {label}
      </span>
      <span className="font-heading text-[30px] leading-[1.15]">{value}</span>
      <span className="text-[12.5px]">{sub}</span>
    </div>
  );
}

function OverShortCard({
  overShort,
  status,
}: {
  overShort: number | null;
  status: 'open' | 'closed' | 'not_counted';
}) {
  if (overShort === null) {
    return (
      <SummaryCard
        icon={CircleAlert}
        label="Over / short"
        value="—"
        sub={status === 'open' ? 'Shows after the count' : 'Not counted'}
        tone={status === 'not_counted' ? 'warn' : 'plain'}
      />
    );
  }
  if (overShort === 0) {
    return <SummaryCard icon={CircleCheck} label="Exact" value={formatPeso(0)} sub="" tone="ok" />;
  }
  return overShort < 0 ? (
    <SummaryCard
      icon={CircleMinus}
      label="Short"
      value={signed(overShort)}
      sub="Counted less than expected"
      tone="danger"
    />
  ) : (
    <SummaryCard
      icon={CirclePlus}
      label="Over"
      value={signed(overShort)}
      sub="Counted more than expected"
      tone="ok"
    />
  );
}

function Line({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className={cn('flex justify-between', negative && 'text-danger-fg')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** SHIFT-01: the Owner reopens the latest drawer, with a reason. */
function ReopenDialog({
  open,
  sessionId,
  day,
  onOpenChange,
}: {
  open: boolean;
  sessionId: string;
  day: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!reason.trim()) {
      setError('Give a reason.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reopenDrawer(sessionId, reason.trim());
      setReason('');
      onOpenChange(false);
    } catch (caught) {
      const { message } = (caught ?? {}) as { message?: unknown };
      setError(
        message === 'not_found'
          ? 'Only the latest drawer can be reopened.'
          : describeDrawerError(caught),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogTitle>Reopen the drawer for {shortDay(day)}?</DialogTitle>
        <DialogDescription>
          Its count is set aside (it stays in the audit log), and it has to be counted and closed
          again.
        </DialogDescription>
        <div className="flex flex-col gap-[6px]">
          <Label htmlFor="reopen-reason" className="text-[13px]">
            Reason
          </Label>
          <textarea
            id="reopen-reason"
            value={reason}
            maxLength={200}
            rows={2}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-[64px] rounded-[22px] border border-divider bg-bg px-[14px] py-[10px] text-[14px] outline-none focus-visible:border-accent"
          />
        </div>
        {error && <Alert variant="danger">{error}</Alert>}
        <DialogActions>
          <DialogClose asChild>
            <Button variant="secondary" className="min-h-[46px] px-[18px]" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            needsInternet
            className="min-h-[46px] px-[22px]"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? 'Reopening…' : 'Reopen drawer'}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
