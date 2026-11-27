import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Calculator,
  ClipboardList,
  LockOpen,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatPeso } from '@/lib/money';
import { ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { CashMoveSheet } from './CashMoveSheet';
import { useDrawerToday, type EntryType } from './data';
import { dayLabel, timeLabel } from './format';
import { OpenDrawerForm } from './OpenDrawerForm';

/**
 * Cash drawer (SRS 3.4): open today's drawer and record cash in and out (every role); the
 * Owner and Special Sales also count and close it (SHIFT-03).
 */
export function DrawerPage() {
  const role = useSession((s) => s.user?.role);
  const isOwner = role === 'owner';
  const canClose = isOwner || role === 'special_sales';
  const drawer = useDrawerToday();
  const [sheet, setSheet] = useState<EntryType | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const session = drawer.data?.session ?? null;

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-[16px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <div className="flex flex-wrap items-start gap-[12px]">
        <div className="flex-1">
          <h1 className="text-[30px] leading-[1.1]">
            {drawer.data && !session ? 'Open today’s drawer' : 'Cash drawer'}
          </h1>
          {drawer.data && (
            <p className="mt-[4px] text-[14.5px] text-neutral-700">{dayLabel(drawer.data.today)}</p>
          )}
        </div>
        {isOwner && (
          <Button
            asChild
            variant="secondary"
            size="md"
            className="border-transparent bg-neutral-200"
          >
            <Link to="report">
              <ClipboardList size={16} strokeWidth={ICON_STROKE} aria-hidden />
              Drawer report
            </Link>
          </Button>
        )}
      </div>

      {notice && (
        <p role="status" className="px-[4px] text-[14px] text-neutral-800">
          {notice}
        </p>
      )}

      {drawer.error ? (
        <Alert variant="danger">
          <b>The drawer needs internet.</b> Connect and try again.
        </Alert>
      ) : drawer.loading || !drawer.data ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : !session ? (
        <OpenDrawerForm
          drawer={drawer.data}
          onOpened={() => {
            setNotice('Today’s drawer is open.');
            drawer.reload();
          }}
        />
      ) : session.status === 'open' ? (
        <>
          {/* Round 3: the open drawer is the main thing, with its one money action inside. */}
          <section
            aria-label="Today’s drawer"
            className="flex flex-col gap-[12px] rounded-[16px] bg-surface px-[18px] pt-[16px] pb-[18px] shadow-[var(--shadow-md)]"
          >
            <div className="flex items-center gap-[8px] text-[14px] text-neutral-700">
              <LockOpen
                size={17}
                strokeWidth={ICON_STROKE}
                className="flex-none text-accent-2-700"
                aria-hidden
              />
              <span>
                <b className="text-text">Open</b> since {timeLabel(session.openedAt)} ·{' '}
                {session.openedByName}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-semibold">Opening cash</span>
              <span className="font-heading text-[30px] tabular-nums">
                {formatPeso(session.openingCash)}
              </span>
            </div>
            {canClose && (
              <Button needsInternet asChild variant="money" size="lg">
                <Link to="count">
                  <Calculator size={19} strokeWidth={ICON_STROKE} aria-hidden />
                  Close drawer
                </Link>
              </Button>
            )}
          </section>
          <div className="grid grid-cols-2 gap-[10px]">
            <Button
              needsInternet
              variant="secondary"
              className="min-h-[52px] border-transparent bg-neutral-200 text-[16px]"
              onClick={() => {
                setNotice(null);
                setSheet('cash_in');
              }}
            >
              <ArrowDownToLine size={18} strokeWidth={ICON_STROKE} aria-hidden />
              Cash in
            </Button>
            <Button
              needsInternet
              variant="secondary"
              className="min-h-[52px] border-transparent bg-neutral-200 text-[16px]"
              onClick={() => {
                setNotice(null);
                setSheet('cash_out');
              }}
            >
              <ArrowUpFromLine size={18} strokeWidth={ICON_STROKE} aria-hidden />
              Cash out
            </Button>
          </div>
        </>
      ) : (
        <section
          aria-label="Today’s drawer"
          className="flex flex-col gap-[12px] rounded-[16px] bg-surface px-[18px] py-[16px] shadow-[var(--shadow-md)]"
        >
          <p className="text-[15px] leading-[1.4]">
            <b>Today’s drawer is closed.</b> Sales from now on go to tomorrow’s drawer.
          </p>
          {/* No dead end (Round 3 states board): selling goes on. */}
          <Button
            asChild
            variant="secondary"
            className="min-h-[48px] border-transparent bg-neutral-200"
          >
            <Link to="/sell">Back to Sell</Link>
          </Button>
        </section>
      )}

      <CashMoveSheet
        open={sheet !== null}
        initialType={sheet ?? 'cash_out'}
        onOpenChange={(open) => !open && setSheet(null)}
        onRecorded={setNotice}
      />
    </div>
  );
}
