import { ArrowDownToLine, ArrowUpFromLine, Calculator, LockOpen } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  const canClose = role === 'owner' || role === 'special_sales';
  const drawer = useDrawerToday();
  const [sheet, setSheet] = useState<EntryType | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const session = drawer.data?.session ?? null;

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-[16px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <div>
        <h1 className="text-[30px] leading-[1.1]">
          {session ? 'Cash drawer' : 'Open today’s drawer'}
        </h1>
        {drawer.data && (
          <p className="mt-[4px] text-[14.5px] text-neutral-700">{dayLabel(drawer.data.today)}</p>
        )}
      </div>

      {notice && (
        <p role="status" className="px-[4px] text-[14px] text-neutral-800">
          {notice}
        </p>
      )}

      {drawer.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load the drawer.</b> Check your connection and try again.
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
          <Card className="flex flex-row items-center gap-[12px] px-[18px] py-[16px]">
            <LockOpen
              size={20}
              strokeWidth={ICON_STROKE}
              className="flex-none text-accent-2-700"
              aria-hidden
            />
            <p className="text-[15px] leading-[1.4]">
              <b>Open</b> since {timeLabel(session.openedAt)}, by {session.openedByName}, with{' '}
              {formatPeso(session.openingCash)}.
            </p>
          </Card>
          <div className="grid grid-cols-2 gap-[10px]">
            <Button
              needsInternet
              variant="secondary"
              className="min-h-[56px] text-[16px]"
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
              className="min-h-[56px] text-[16px]"
              onClick={() => {
                setNotice(null);
                setSheet('cash_out');
              }}
            >
              <ArrowUpFromLine size={18} strokeWidth={ICON_STROKE} aria-hidden />
              Cash out
            </Button>
          </div>
          {canClose && (
            <Button needsInternet asChild size="lg">
              <Link to="count">
                <Calculator size={19} strokeWidth={ICON_STROKE} aria-hidden />
                Count and close
              </Link>
            </Button>
          )}
        </>
      ) : (
        <Card className="px-[18px] py-[16px] text-[15px] leading-[1.4]">
          Today’s drawer is closed. Sales from now on go to tomorrow’s drawer.
        </Card>
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
