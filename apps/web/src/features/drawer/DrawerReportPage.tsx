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
import { InfoTip } from '@/components/ui/info-tip';
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
  countedLater,
  damagedItems,
  drawerCsv,
  earlierCount,
  expectedFrom,
  FLAG_LABELS,
  movementDay,
  movements,
  paidBy,
  refundWords,
  refundedBy,
  reopenDrawer,
  returnItemsText,
  useDrawerDay,
  useDrawerEntries,
  useDrawerEvents,
  useDrawerSales,
  useLatestDrawer,
  type DrawerEntryRecord,
  type DrawerEvent,
  type DrawerRecord,
  type DrawerSales,
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
  reopened: RotateCcw,
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
  const events = useDrawerEvents(record?.id);
  const sales = useDrawerSales(record?.id);
  const salesData = sales.data[0] ?? null;
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
        {/* On a phone the day and CSV take their own row, so the title isn't squeezed. */}
        <div className="flex w-full items-center gap-[10px] sm:w-auto">
          <input
            type="date"
            aria-label="Day"
            value={day}
            max={today}
            onChange={(event) => {
              if (event.target.value) setParams({ date: event.target.value }, { replace: true });
            }}
            className="h-[40px] rounded-[10px] bg-neutral-200 px-[14px] text-[14px]"
          />
          <Button
            variant="secondary"
            className="min-h-[40px]"
            disabled={!record}
            onClick={() =>
              record &&
              download(`drawer-${day}.csv`, drawerCsv(record, entries.data, events.data, salesData))
            }
          >
            <Download size={15} strokeWidth={ICON_STROKE} aria-hidden />
            CSV
          </Button>
        </div>
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
          events={events.data}
          sales={salesData}
          salesFailed={sales.error}
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
  events,
  sales,
  salesFailed,
  canReopen,
  onReopen,
}: {
  record: DrawerRecord;
  entries: DrawerEntryRecord[];
  events: DrawerEvent[];
  /** Null while it loads, or if it could not be loaded. */
  sales: DrawerSales | null;
  salesFailed: boolean;
  canReopen: boolean;
  onReopen: () => void;
}) {
  const {
    cashIn,
    cashOut,
    cashSales,
    cashRefunds,
    expected: expectedNow,
  } = expectedFrom(record, entries, paidBy(sales, 'cash'), sales?.cashRefunds ?? 0);
  // A closed drawer keeps the server's figure; an open one waits for its sales.
  const expected = record.expectedCash ?? (sales ? expectedNow : null);
  const pending = salesFailed ? 'Needs internet' : '…';
  const difference = record.prefillDifference ?? 0;
  const rows = movements(record, entries, events);
  const countedBefore = events.some((event) => event.kind === 'closed');
  const earlier = earlierCount(record, events);

  return (
    <>
      {/* Round 3: the day's result is the main thing, one raised card. */}
      <section
        aria-label="Drawer result"
        className="grid grid-cols-[minmax(0,1fr)] gap-[8px] rounded-[16px] bg-surface p-[12px] shadow-[var(--shadow-md)] sm:grid-cols-2 xl:grid-cols-4"
      >
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
          value={expected === null ? pending : formatPeso(expected)}
          sub=""
          tip="Opening + cash sales + cash in − cash out − refunds"
        />
        <SummaryCard
          icon={HandCoins}
          label="Counted"
          value={record.countedCash === null ? '—' : formatPeso(record.countedCash)}
          sub={
            record.status === 'closed'
              ? `${countedLater(record.businessDate, record.closedAt) ?? `Closed ${record.closedAt ? timeLabel(record.closedAt) : ''}`} by ${record.closedByName ?? ''}`
              : record.status === 'not_counted'
                ? countedBefore
                  ? 'Not counted again after the reopen'
                  : 'Never counted'
                : 'Still open'
          }
        />
        <OverShortCard overShort={record.overShort} status={record.status} earlier={earlier} />
      </section>

      {record.status === 'not_counted' && (
        <Alert variant="warn">
          {countedBefore
            ? 'Nobody counted this drawer again after it was reopened.'
            : 'Nobody counted this drawer.'}{' '}
          {earlier && `${earlier}. `}
          It was closed when the next day&apos;s drawer opened.
        </Alert>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-[16px] xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-[16px] bg-surface px-[14px] py-[10px] md:px-[22px]">
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
                      {move.at
                        ? movementDay(move.at, record.businessDate) === record.businessDate
                          ? timeLabel(move.at)
                          : `${shortDay(movementDay(move.at, record.businessDate))}, ${timeLabel(move.at)}`
                        : '—'}
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

        <div className="flex min-w-0 flex-col gap-[8px] rounded-[16px] bg-neutral-100 p-[22px] text-[14.5px]">
          <h2 className="mb-[4px] text-[20px]">Expected cash</h2>
          <Line label="Opening cash" value={formatPeso(record.openingCash)} />
          <Line label="Cash sales" value={sales ? formatPeso(cashSales) : pending} />
          <Line label="Cash in" value={formatPeso(cashIn)} />
          <Line
            label="Cash out"
            value={cashOut > 0 ? `−${formatPeso(cashOut)}` : formatPeso(0)}
            negative={cashOut > 0}
          />
          {cashRefunds > 0 && (
            <Line label="Cash refunds" value={`−${formatPeso(cashRefunds)}`} negative />
          )}
          <div className="flex justify-between border-t border-divider pt-[8px] font-bold">
            <span>Expected</span>
            <span className="tabular-nums">
              {expected === null ? pending : formatPeso(expected)}
            </span>
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
          {sales && (
            <p className="mt-[6px] text-[13px] text-neutral-700">
              Not in the drawer: GCash {ewalletText(sales, 'gcash')} · Maya{' '}
              {ewalletText(sales, 'maya')}
            </p>
          )}
          <p className="text-[13px] text-neutral-700">
            Utang payments join this list in a later update.
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

      {sales && <FixesSection sales={sales} />}

      {sales ? (
        <SalesSection sales={sales} />
      ) : (
        salesFailed && (
          <Alert variant="danger">
            <b>The sales could not be loaded.</b> Connect and try again.
          </Alert>
        )
      )}
    </>
  );
}

const METHOD_LABELS = { cash: 'Cash', gcash: 'GCash', maya: 'Maya' } as const;

/** "₱45.00", or "₱0.00 (₱45.00 paid, ₱45.00 refunded)" once some was sent back. */
function ewalletText(sales: DrawerSales, method: 'gcash' | 'maya') {
  const paid = paidBy(sales, method);
  const back = refundedBy(sales, method);
  return back > 0
    ? `${formatPeso(paid - back)} (${formatPeso(paid)} paid, ${formatPeso(back)} refunded)`
    : formatPeso(paid);
}

/**
 * SHIFT-04, POS-10: the drawer's voids, returns and damaged items, each with who, why and what
 * went back. Shown only when there is any.
 */
function FixesSection({ sales }: { sales: DrawerSales }) {
  const damaged = damagedItems(sales);
  if (sales.voids.length === 0 && sales.returns.length === 0) return null;
  const damagedCost = damaged.reduce((sum, item) => sum + item.cost, 0);
  return (
    <section
      aria-label="Voids and returns"
      className="grid grid-cols-[minmax(0,1fr)] gap-[16px] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-[10px] rounded-[16px] bg-surface p-[22px] text-[14.5px]">
        <h2 className="mb-[4px] text-[20px]">
          Voids{sales.voids.length > 0 ? ` · ${sales.voids.length}` : ''}
        </h2>
        {sales.voids.length === 0 ? (
          <p className="text-neutral-700">No voids.</p>
        ) : (
          <>
            <p className="text-[12.5px] text-neutral-700">
              Voided sales are already left out of the sales and the cash sales.
            </p>
            <ul className="flex flex-col gap-[10px]">
              {sales.voids.map((sale) => (
                <li key={sale.id} className="flex flex-col gap-[4px] rounded-[12px] bg-bg p-[12px]">
                  <div className="flex items-baseline justify-between gap-[8px]">
                    <span className="font-semibold break-all">{sale.receiptNo}</span>
                    <span className="font-bold text-danger-fg tabular-nums">
                      −{formatPeso(sale.total)}
                    </span>
                  </div>
                  <div className="text-[12.5px] text-neutral-700">
                    {sale.salesperson} · voided {madeLabel(sale.at)} by {sale.by}
                  </div>
                  <div className="text-[13px]">
                    {[
                      sale.cash > 0 ? `${formatPeso(sale.cash)} cash back` : null,
                      sale.ewallet > 0
                        ? `${formatPeso(sale.ewallet)} GCash/Maya sent back${sale.refundReference ? `, ref ${sale.refundReference}` : ''}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  <div className="text-[13px] text-neutral-700">Reason: {sale.reason}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex flex-col gap-[10px] rounded-[16px] bg-surface p-[22px] text-[14.5px]">
        <h2 className="mb-[4px] text-[20px]">
          Returns{sales.returns.length > 0 ? ` · ${sales.returns.length}` : ''}
        </h2>
        {sales.returns.length === 0 ? (
          <p className="text-neutral-700">No returns.</p>
        ) : (
          <ul className="flex flex-col gap-[10px]">
            {sales.returns.map((ret) => (
              <li key={ret.id} className="flex flex-col gap-[4px] rounded-[12px] bg-bg p-[12px]">
                <div className="flex items-baseline justify-between gap-[8px]">
                  <span className="font-semibold break-all">{ret.receiptNo}</span>
                  <span className="font-bold text-danger-fg tabular-nums">
                    −{formatPeso(ret.refund)}
                  </span>
                </div>
                <div className="text-[12.5px] text-neutral-700">
                  {ret.salesperson} · returned {madeLabel(ret.at)} by {ret.by}
                  {ret.defective ? ' · defective' : ''}
                </div>
                <div className="text-[13px]">{returnItemsText(ret.items)}</div>
                <div className="text-[13px]">{refundWords(ret)}</div>
                <div className="text-[13px] text-neutral-700">Reason: {ret.reason}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-[8px] rounded-[16px] bg-surface p-[22px] text-[14.5px]">
        <h2 className="mb-[4px] text-[20px]">Damaged</h2>
        {damaged.length === 0 ? (
          <p className="text-neutral-700">Nothing damaged.</p>
        ) : (
          <>
            {damaged.map((item, index) => (
              <Line
                key={index}
                label={`${item.name} × ${item.qty}${item.unit === 'kg' || item.unit === 'L' ? ` ${item.unit}` : ''}`}
                value={formatPeso(item.cost)}
              />
            ))}
            <div className="flex justify-between border-t border-divider pt-[8px] font-bold">
              <span>Written off at cost</span>
              <span className="tabular-nums">{formatPeso(damagedCost)}</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

const madeLabel = (date: Date) =>
  date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * SHIFT-04: the drawer's sales by payment method and by salesperson, and the sales the Owner
 * should check (POS-14: late, price or settings changed, stock below zero, reused reference).
 * The design has no such section; it follows the report's own cards and lists.
 */
function SalesSection({ sales }: { sales: DrawerSales }) {
  return (
    <section
      aria-label="Sales"
      className="grid grid-cols-[minmax(0,1fr)] gap-[16px] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)]"
    >
      <div className="flex flex-col gap-[8px] rounded-[16px] bg-surface p-[22px] text-[14.5px]">
        <h2 className="mb-[4px] text-[20px]">Sales</h2>
        <Line
          label={`${sales.count} ${sales.count === 1 ? 'sale' : 'sales'}`}
          value={formatPeso(sales.total)}
        />
        {sales.methods.map((m) => (
          <Line
            key={m.method}
            label={`${METHOD_LABELS[m.method]} · ${m.count} ${m.count === 1 ? 'sale' : 'sales'}`}
            value={formatPeso(m.amount)}
          />
        ))}
        {sales.discounts > 0 && (
          <Line label="Discounts given" value={`−${formatPeso(sales.discounts)}`} />
        )}
        {sales.methods.length > 1 && (
          <p className="text-[12.5px] text-neutral-700">
            A sale paid two ways counts under each. Cash is what stayed in the drawer.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-[8px] rounded-[16px] bg-surface p-[22px] text-[14.5px]">
        <h2 className="mb-[4px] text-[20px]">By salesperson</h2>
        {sales.salespeople.length === 0 ? (
          <p className="text-neutral-700">No sales in this drawer yet.</p>
        ) : (
          sales.salespeople.map((person) => (
            <Line
              key={person.name}
              label={`${person.name} · ${person.count} ${person.count === 1 ? 'sale' : 'sales'}`}
              value={formatPeso(person.total)}
            />
          ))
        )}
      </div>

      <div className="flex flex-col gap-[10px] rounded-[16px] bg-surface p-[22px] text-[14.5px]">
        <h2 className="mb-[4px] text-[20px]">
          Sales to check{sales.flaggedCount > 0 ? ` · ${sales.flaggedCount}` : ''}
        </h2>
        {sales.flagged.length === 0 ? (
          <p className="text-neutral-700">Nothing to check.</p>
        ) : (
          <ul className="flex flex-col gap-[10px]">
            {sales.flagged.map((sale) => (
              <li key={sale.id} className="flex flex-col gap-[4px] rounded-[12px] bg-bg p-[12px]">
                <div className="flex items-baseline justify-between gap-[8px]">
                  <span className="font-semibold break-all">{sale.receiptNo}</span>
                  <span className="font-bold tabular-nums">{formatPeso(sale.total)}</span>
                </div>
                <div className="text-[12.5px] text-neutral-700">
                  {sale.salesperson} · made {madeLabel(sale.madeAt)}
                  {sale.madeOffline
                    ? ` offline, reached the store ${madeLabel(sale.syncedAt)}`
                    : ''}
                </div>
                <div className="flex flex-wrap gap-[6px]">
                  {sale.flags.map((flag) => (
                    <span
                      key={flag}
                      className="inline-flex items-center gap-[4px] rounded-full bg-warn-bg px-[10px] py-[3px] text-[12px] font-semibold text-warn-fg"
                    >
                      <TriangleAlert size={12} strokeWidth={ICON_STROKE} aria-hidden />
                      {FLAG_LABELS[flag]}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {sales.flaggedCount > sales.flagged.length && (
          <p className="text-[12.5px] text-neutral-700">
            Showing {sales.flagged.length} of {sales.flaggedCount}.
          </p>
        )}
      </div>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  tip,
  tone = 'plain',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  /** How the figure is worked out, behind (i). */
  tip?: string;
  tone?: 'plain' | 'warn' | 'danger' | 'ok';
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-[4px] rounded-[12px] px-[14px] py-[12px]',
        tone === 'plain' && 'text-text',
        tone === 'warn' && 'bg-warn-bg text-warn-fg',
        tone === 'danger' && 'bg-danger-bg text-danger-fg',
        tone === 'ok' && 'bg-accent-2-100 text-accent-2-800',
      )}
    >
      <span className="flex items-center gap-[6px] text-[13.5px]">
        <Icon size={15} strokeWidth={ICON_STROKE} aria-hidden />
        {label}
        {tip && <InfoTip label={`About ${label.toLowerCase()}`}>{tip}</InfoTip>}
      </span>
      <span className="font-heading text-[30px] leading-[1.15]">{value}</span>
      <span className="text-[12.5px]">{sub}</span>
    </div>
  );
}

function OverShortCard({
  overShort,
  status,
  earlier,
}: {
  overShort: number | null;
  status: 'open' | 'closed' | 'not_counted';
  earlier: string | null;
}) {
  if (overShort === null) {
    return (
      <SummaryCard
        icon={CircleAlert}
        label="Over / short"
        value="—"
        sub={status === 'open' ? 'Shows after the count' : (earlier ?? 'Not counted')}
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
          Its count is set aside (it stays on this report and in the audit log), and it has to be
          counted and closed again.
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
            className="min-h-[64px] rounded-[12px] border-2 border-transparent bg-neutral-200 px-[14px] py-[10px] text-[14px] outline-none focus-visible:border-accent"
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
