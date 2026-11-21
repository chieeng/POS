import { Clock, LogIn, LogOut, MapPin } from 'lucide-react';
import { useState } from 'react';
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
import { StatusBadge } from '@/components/ui/status-badge';
import { useOnline } from '@/hooks/useOnline';
import { ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { FixRequestForm, OwnerFixPanel } from './FixForms';
import {
  clock,
  clockText,
  DAY_TYPE_LABELS,
  describeClockError,
  flagText,
  timeText,
  useClockState,
  type ClockKind,
  type ClockState,
} from './clock';

const today = () =>
  new Date().toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });

/**
 * My attendance (SRS ATT-01..05, ATT-11, ATT-12, ATT-15): today's time in and time out, one
 * tap each, at the store, and asking the Owner to fix a day. The Owner fixes or marks any day
 * here; the board, history and CSV come in the last step 11 PR.
 */
export function AttendancePage() {
  const user = useSession((s) => s.user);
  const isOwner = user?.role === 'owner';
  const state = useClockState(user?.uid, isOwner);
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-[16px] px-[16px] pt-[14px] pb-[24px] md:px-[26px] md:pt-[22px]">
      <div>
        <h1 className="text-[28px] md:text-[30px]">Attendance</h1>
        <p className="m-0 text-[14.5px] text-neutral-700">{today()}</p>
      </div>
      {state.loading ? (
        <p role="status" className="text-neutral-700">
          Loading…
        </p>
      ) : (
        <>
          {state.canClock && <ClockPanel state={state} />}
          {state.canClock && !isOwner && <FixRequestForm />}
          {isOwner && <OwnerFixPanel />}
        </>
      )}
    </div>
  );
}

/** The day's rules in plain words, from the Owner's settings. */
function Rules({ state }: { state: ClockState }) {
  const rules = state.rules;
  if (!rules) return null;
  return (
    <section
      aria-label="Today’s times"
      className="flex flex-col gap-[4px] rounded-[12px] bg-surface px-[16px] py-[12px] text-[14px]"
    >
      <span>
        <b>Morning:</b> in by {clockText(rules.latestIn)}
        {rules.ownTime ? ' (your own time)' : ''}, {rules.graceMinutes}-minute grace
      </span>
      <span>
        <b>Afternoon half day:</b> in from {clockText(rules.afternoonLine)}, by{' '}
        {clockText(rules.afternoonStart)}
      </span>
      <span>
        <b>Time out:</b> from {clockText(rules.earliestOut)} (before{' '}
        {clockText(rules.morningOutLine)} is a morning half day)
      </span>
    </section>
  );
}

/**
 * The clock itself, also shown on Sell before the first sale of the day (ATT-16): Clock in,
 * then Clock out, then the day's result.
 */
export function ClockPanel({ state, compact = false }: { state: ClockState; compact?: boolean }) {
  const user = useSession((s) => s.user);
  const online = useOnline();
  const [busy, setBusy] = useState<ClockKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const record = state.record;

  const tap = async (kind: ClockKind) => {
    if (!user) return;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const { result, located } = await clock(kind, { uid: user.uid, branchId: user.branchId });
      const what = kind === 'clock_in' ? 'Time in' : 'Time out';
      setNotice(
        result === 'saved'
          ? `${what} saved on this phone. It’s sent when you’re back online.`
          : located
            ? `${what} recorded.`
            : `${what} recorded. Your location couldn’t be read, so the Owner will check it.`,
      );
      state.reload();
    } catch (caught) {
      setError(describeClockError(caught));
    } finally {
      setBusy(null);
      setConfirmOut(false);
    }
  };

  const inAt = record?.inAt ?? state.waitingIn;
  const outAt = record?.outAt ?? state.waitingOut;

  return (
    <div className="flex flex-col gap-[14px]">
      {!compact && <Rules state={state} />}
      {!state.storeLocationSet && (
        <Alert variant="info">
          The store’s location isn’t set yet, so where you clock in isn’t checked.
        </Alert>
      )}

      {inAt && (
        <section
          aria-label="Today"
          className="flex flex-col gap-[8px] rounded-[12px] bg-surface px-[16px] py-[14px] text-[15px]"
        >
          <div className="flex flex-wrap items-center gap-[8px]">
            <LogIn size={18} strokeWidth={ICON_STROKE} aria-hidden />
            <span>
              In at <b>{timeText(inAt)}</b>
            </span>
            {record?.inAt ? (
              record.lateMinutes > 0 ? (
                <StatusBadge tone="warn">Late by {record.lateMinutes} min</StatusBadge>
              ) : (
                <StatusBadge tone="ok">On time</StatusBadge>
              )
            ) : (
              <StatusBadge tone="pending">Waiting to send</StatusBadge>
            )}
          </div>
          {outAt && (
            <div className="flex flex-wrap items-center gap-[8px]">
              <LogOut size={18} strokeWidth={ICON_STROKE} aria-hidden />
              <span>
                Out at <b>{timeText(outAt)}</b>
              </span>
              {record?.dayType ? (
                <StatusBadge tone="ok">{DAY_TYPE_LABELS[record.dayType]}</StatusBadge>
              ) : (
                <StatusBadge tone="pending">Waiting to send</StatusBadge>
              )}
              {record && record.earlyMinutes > 0 && (
                <StatusBadge tone="warn">Early out {record.earlyMinutes} min</StatusBadge>
              )}
              {record && record.overtimeMinutes > 0 && (
                <StatusBadge tone="accent">Overtime {record.overtimeMinutes} min</StatusBadge>
              )}
            </div>
          )}
          {record && record.flags.length > 0 && (
            <div className="flex flex-wrap gap-[6px]">
              {record.flags.map((flag) => (
                <StatusBadge key={flag} tone="warn">
                  {flagText(flag, record)}
                </StatusBadge>
              ))}
            </div>
          )}
        </section>
      )}

      {notice && (
        <p role="status" className="m-0 text-[14px] text-neutral-800">
          {notice}
        </p>
      )}
      {error && <Alert variant="danger">{error}</Alert>}
      {state.refused && (
        <Alert variant="danger">
          A clock tap saved on this phone was refused: {state.refused}. Ask the Owner to fix today’s
          record.
        </Alert>
      )}

      {!state.clockedIn ? (
        <div className="flex flex-col gap-[8px]">
          <Button
            size="lg"
            disabled={busy !== null}
            onClick={() => void tap('clock_in')}
            className="gap-[10px]"
          >
            <Clock size={22} strokeWidth={ICON_STROKE} aria-hidden />
            {busy === 'clock_in' ? 'Clocking in…' : 'Clock in'}
          </Button>
          <p className="m-0 flex items-center gap-[6px] text-[13px] text-neutral-700">
            <MapPin size={14} strokeWidth={ICON_STROKE} aria-hidden />
            Your location is read once, now, to check you’re at the store.
            {!online && ' You’re offline: the time is saved on this phone.'}
          </p>
        </div>
      ) : !state.clockedOut ? (
        <Button
          size="lg"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => setConfirmOut(true)}
          className="gap-[10px]"
        >
          <LogOut size={22} strokeWidth={ICON_STROKE} aria-hidden />
          Clock out
        </Button>
      ) : (
        <p className="m-0 text-[14px] text-neutral-700">
          Done for today. If a time is wrong, ask the Owner to fix it.
        </p>
      )}

      <Dialog open={confirmOut} onOpenChange={(next) => !busy && setConfirmOut(next)}>
        <DialogContent>
          <DialogTitle>Clock out now?</DialogTitle>
          <DialogDescription>This ends your day. You can’t clock in again today.</DialogDescription>
          <DialogActions>
            <DialogClose asChild>
              <Button variant="secondary" size="md" disabled={busy !== null}>
                Cancel
              </Button>
            </DialogClose>
            <Button size="md" disabled={busy !== null} onClick={() => void tap('clock_out')}>
              {busy === 'clock_out' ? 'Clocking out…' : 'Clock out'}
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}
