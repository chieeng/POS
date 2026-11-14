import { ReceiptText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterChip, FilterChips } from '@/components/ui/filter-chips';
import { StatusBadge } from '@/components/ui/status-badge';
import { useUsers } from '@/features/users/data';
import { formatPeso } from '@/lib/money';
import { watchOutboxSales, type OutboxItem } from '@/lib/outbox';
import { useSession } from '@/stores/session';
import {
  dayHeading,
  daysBefore,
  manilaDay,
  METHOD_LABELS,
  rangeFor,
  useSalesHistory,
  type HistorySale,
  type PayMethod,
  type RangeKey,
} from './history';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'all', label: 'All 30 days' },
];

const time = (at: Date) =>
  at.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });

const itemsText = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

const methodsText = (methods: PayMethod[]) =>
  methods.length === 0 ? '' : methods.map((m) => METHOD_LABELS[m]).join(' + ');

/** A sale still on this phone, from the outbox: shown until the server has it. */
interface LocalSale {
  id: string;
  receiptNo: string;
  madeAt: Date;
  total: number;
  methods: PayMethod[];
  refused: string | null;
}

function toLocalSale(item: OutboxItem): LocalSale {
  const payload = item.payload as {
    receipt_no?: string;
    made_at?: string;
    total?: number;
    payments?: { method: PayMethod }[];
  };
  return {
    id: item.id,
    receiptNo: String(payload.receipt_no ?? ''),
    madeAt: new Date(payload.made_at ?? item.madeAt),
    total: Number(payload.total ?? 0),
    methods: [...new Set((payload.payments ?? []).map((p) => p.method))],
    refused: item.status === 'needsAttention' ? (item.error ?? 'Refused.') : null,
  };
}

/**
 * Sales history (SRS 6.1, the owner's decisions of Nov 13, 2026). Staff: "My sales", their own
 * sales of the last 30 days, with chips for Today, Yesterday, This week and All 30 days, and
 * the sales still waiting on this phone. The Owner: every sale, any day, any salesperson. Built
 * to the new look's "My sales" board; the laptop has no board, so it uses the same list wider.
 */
export function SalesHistoryPage() {
  const user = useSession((s) => s.user);
  const isOwner = user?.role === 'owner';
  const today = manilaDay(new Date());
  const [range, setRange] = useState<RangeKey>('today');
  const [ownerDay, setOwnerDay] = useState(today);
  const [salesperson, setSalesperson] = useState<string | null>(null);

  const { from, to } = isOwner ? { from: ownerDay, to: ownerDay } : rangeFor(range, today);
  const history = useSalesHistory(from, to, isOwner ? salesperson : null);

  // Staff: the sales on this phone that the server doesn't have yet.
  const [local, setLocal] = useState<LocalSale[]>([]);
  useEffect(() => {
    if (!user || isOwner) return;
    return watchOutboxSales(user.uid, (items) => setLocal(items.map(toLocalSale).reverse()));
  }, [user, isOwner]);
  const localShown = local.filter((sale) => {
    const day = manilaDay(sale.madeAt);
    return day >= from && day <= to;
  });

  const groups = useMemo(() => {
    const byDay = new Map<string, HistorySale[]>();
    for (const sale of history.sales) {
      const day = manilaDay(sale.madeAt);
      byDay.set(day, [...(byDay.get(day) ?? []), sale]);
    }
    return [...byDay.entries()];
  }, [history.sales]);
  const dayTotals = new Map(history.days.map((day) => [day.day, day]));

  const empty =
    !history.loading && !history.error && history.sales.length === 0 && localShown.length === 0;

  return (
    <div className="flex w-full max-w-[960px] flex-col gap-[8px] px-[16px] pt-[4px] pb-[24px] md:px-[26px] md:pt-[20px]">
      <header className="flex min-h-[56px] items-center gap-[12px]">
        <h1 className="font-heading text-[22px] tracking-[-0.02em] md:text-[28px]">
          {isOwner ? 'Sales history' : 'My sales'}
        </h1>
        {!isOwner && <span className="ml-auto text-[13px] text-neutral-700">Last 30 days</span>}
      </header>

      {isOwner ? (
        <OwnerFilters
          day={ownerDay}
          today={today}
          onDay={setOwnerDay}
          salesperson={salesperson}
          onSalesperson={setSalesperson}
        />
      ) : (
        <FilterChips label="Days">
          {RANGES.map((each) => (
            <FilterChip
              key={each.key}
              selected={range === each.key}
              onClick={() => setRange(each.key)}
            >
              {each.label}
            </FilterChip>
          ))}
        </FilterChips>
      )}

      {localShown.length > 0 && (
        <section aria-label="Waiting on this phone">
          <h2 className="pt-[14px] pb-[2px] text-[13px] font-bold text-neutral-700">
            On this phone · {localShown.length} not sent yet
          </h2>
          <ul className="flex flex-col">
            {localShown.map((sale) => (
              <li
                key={sale.id}
                className="flex min-h-[68px] items-center gap-[10px] border-b border-divider"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="text-[15px] font-bold">{time(sale.madeAt)}</span>
                  <span className="flex flex-wrap items-center gap-[6px] text-[12.5px] text-neutral-700">
                    {sale.receiptNo} · {methodsText(sale.methods)}
                    {sale.refused ? (
                      <StatusBadge tone="danger">Not saved: {sale.refused}</StatusBadge>
                    ) : (
                      <StatusBadge tone="warn">Waiting to sync</StatusBadge>
                    )}
                  </span>
                </span>
                <span className="font-heading text-[16px]">{formatPeso(sale.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {history.error ? (
        <Alert variant="danger">
          <b>Sales history needs internet.</b> Connect and try again.{' '}
          <Button variant="secondary" size="md" className="mt-[8px]" onClick={history.reload}>
            Try again
          </Button>
        </Alert>
      ) : history.loading && history.sales.length === 0 ? (
        <p role="status" className="py-[16px] text-neutral-700">
          Loading…
        </p>
      ) : empty ? (
        <EmptyState icon={ReceiptText} title="No sales" compact>
          {isOwner ? 'No sales on this day.' : 'No sales of yours in this range.'}
        </EmptyState>
      ) : (
        groups.map(([day, sales]) => {
          const totals = dayTotals.get(day);
          return (
            <section key={day} aria-label={dayHeading(day, today)}>
              <h2 className="pt-[14px] pb-[2px] text-[13px] font-bold text-neutral-700">
                {dayHeading(day, today)}
                {totals &&
                  ` · ${totals.count} ${totals.count === 1 ? 'sale' : 'sales'} · ${formatPeso(totals.total)}`}
              </h2>
              <ul className="flex flex-col">
                {sales.map((sale) => (
                  <li key={sale.id}>
                    <Link
                      to={`/sales/${sale.id}`}
                      className="flex min-h-[68px] items-center gap-[10px] border-b border-divider text-text hover:bg-text/4"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                        <span className="text-[15px] font-bold">
                          {time(sale.madeAt)} · {itemsText(sale.items)}
                          {isOwner && (
                            <span className="font-normal text-neutral-700">
                              {' '}
                              · {sale.salesperson}
                            </span>
                          )}
                        </span>
                        <span className="flex flex-wrap items-center gap-[6px] text-[12.5px] text-neutral-700">
                          {sale.receiptNo} · {methodsText(sale.methods)}
                          <SaleBadge sale={sale} />
                        </span>
                      </span>
                      <span className="font-heading text-[16px]">{formatPeso(sale.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {history.hasMore && (
        <Button
          variant="secondary"
          size="md"
          className="mt-[10px] self-center"
          disabled={history.loadingMore}
          onClick={history.loadMore}
        >
          {history.loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}

/** A sale that isn't simply completed says so: voided, corrected. */
function SaleBadge({ sale }: { sale: HistorySale }) {
  if (sale.status === 'voided') return <StatusBadge tone="danger">Voided</StatusBadge>;
  if (sale.status === 'corrected') return <StatusBadge tone="pending">Corrected</StatusBadge>;
  return null;
}

/** The Owner: one day at a time (any day), and everyone or one salesperson. */
function OwnerFilters({
  day,
  today,
  onDay,
  salesperson,
  onSalesperson,
}: {
  day: string;
  today: string;
  onDay: (day: string) => void;
  salesperson: string | null;
  onSalesperson: (uid: string | null) => void;
}) {
  const branchId = useSession((s) => s.user?.branchId ?? '');
  const users = useUsers(branchId);
  // Everyone who can sell, the Owner too.
  const staff = [...users.data].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' }),
  );
  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      <FilterChips label="Days">
        <FilterChip selected={day === today} onClick={() => onDay(today)}>
          Today
        </FilterChip>
        <FilterChip
          selected={day === daysBefore(today, 1)}
          onClick={() => onDay(daysBefore(today, 1))}
        >
          Yesterday
        </FilterChip>
      </FilterChips>
      <input
        type="date"
        aria-label="Day"
        value={day}
        max={today}
        onChange={(event) => event.target.value && onDay(event.target.value)}
        className="h-10 rounded-[10px] border border-divider bg-surface px-[12px] text-[14px]"
      />
      <select
        aria-label="Salesperson"
        value={salesperson ?? ''}
        onChange={(event) => onSalesperson(event.target.value || null)}
        className="h-10 rounded-[10px] border border-divider bg-surface px-[12px] text-[14px]"
      >
        <option value="">All salespeople</option>
        {staff.map((user) => (
          <option key={user.uid} value={user.uid}>
            {user.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
