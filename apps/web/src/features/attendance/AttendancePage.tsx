import { ChevronDown, Clock, Info, LogIn, LogOut, MapPin } from 'lucide-react';
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
import { cn, ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { FixRequestForm } from './FixForms';
import { OwnerAttendance } from './OwnerAttendance';
import { RecentDays } from './RecentDays';
import {
  clock,
  ClockError,
  clockText,
  DAY_TYPE_LABELS,
  describeClockError,
  flagText,
  manilaDay,
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
 * tap each, at the store, the last days, and asking the Owner to fix one. For the Owner it is
 * the board, history, summary, CSV and fixing a day (ATT-14).
 */
export function AttendancePage() {
  const user = useSession((s) => s.user);
  const isOwner = user?.role === 'owner';
  const state = useClockState(user?.uid, isOwner);
  // "Ask to fix" on a day of the list opens the request form for that day.
  const [ask, setAsk] = useState<{ day: string; n: number } | null>(null);
  return (
    <div
      className={cn(
        'flex w-full flex-col gap-[16px] px-[16px] pt-[14px] pb-[24px] md:px-[26px] md:pt-[22px]',
        isOwner ? 'max-w-[1180px]' : 'max-w-[560px]',
      )}
    >
      <div>
        <h1 className="text-[28px] md:text-[30px]">Attendance</h1>
        <p className="m-0 text-[14.5px] text-neutral-700">{today()}</p>
      </div>
      {/* The Owner's board doesn't wait for their own clock. */}
      {state.loading && !isOwner ? (
        <p role="status" className="text-neutral-700">
          Loading…
        </p>
      ) : (
        <>
          {state.canClock && (
            <div className="w-full max-w-[560px]">
              <ClockPanel state={state} />
            </div>
          )}
          {state.canClock && !isOwner && (
            <FixRequestForm key={ask?.n ?? 0} initialDay={ask?.day} initiallyOpen={!!ask} />
          )}
          {!isOwner && user && (
            <RecentDays
              uid={user.uid}
              // A tap that reached the server changes today's line.
              version={`${state.record?.inAt?.getTime() ?? ''}-${state.record?.outAt?.getTime() ?? ''}`}
              person={state.person}
              onAskFix={
                state.canClock
                  ? (day) => setAsk((before) => ({ day, n: (before?.n ?? 0) + 1 }))
                  : undefined
              }
            />
          )}
          {isOwner && <OwnerAttendance />}
        </>
      )}
    </div>
  );
}

/** "Sat, Nov 21, 7:58 AM", store time. */
const refusedWhen = (at: Date) =>
  at.toLocaleString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });

/**
 * The day's rules in plain words, from the Owner's settings, behind "How days count" (cleanup
 * round 1: standing rules are one tap away, not on the screen every day).
 */
function Rules({ state }: { state: ClockState }) {
  const [open, setOpen] = useState(false);
  const rules = state.rules;
  if (!rules) return null;
  return (
    <div className="flex flex-col gap-[6px]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="day-rules"
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-[44px] cursor-pointer items-center gap-[6px] self-start bg-transparent p-0 text-[14px] font-bold text-text"
      >
        <Info size={18} strokeWidth={ICON_STROKE} aria-hidden />
        How days count
        <ChevronDown
          size={16}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className={cn('transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && <RulesText rules={rules} />}
    </div>
  );
}

function RulesText({ rules }: { rules: NonNullable<ClockState['rules']> }) {
  return (
    <section
      id="day-rules"
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
  // A tap saved offline remembers its kind, so the note follows it once it is sent (the Nov 27
  // step 11 test: "saved on this phone" stayed after the time out was sent).
  const [notice, setNotice] = useState<{ text: string; saved: ClockKind | null } | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const record = state.record;

  const tap = async (kind: ClockKind) => {
    if (!user) return;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      // The screen was opened yesterday: no Clock out after midnight (decision H, ATT-01).
      if (kind === 'clock_out' && manilaDay(new Date()) !== state.day) {
        state.reload();
        throw new ClockError('past_midnight');
      }
      const { result, located } = await clock(kind, { uid: user.uid, branchId: user.branchId });
      const what = kind === 'clock_in' ? 'Time in' : 'Time out';
      setNotice({
        text:
          result === 'saved'
            ? `${what} saved on this phone. It’s sent when you’re back online.`
            : located
              ? `${what} recorded.`
              : `${what} recorded. Your location couldn’t be read, so the Owner will check it.`,
        saved: result === 'saved' ? kind : null,
      });
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
  // The saved tap reached the server: say so instead of "saved on this phone".
  const sentNow =
    notice?.saved === 'clock_in'
      ? !state.waitingIn && !!record?.inAt
      : notice?.saved === 'clock_out'
        ? !state.waitingOut && !!record?.outAt
        : false;
  const noticeText = sentNow
    ? `${notice?.saved === 'clock_in' ? 'Time in' : 'Time out'} sent.`
    : notice?.text;

  return (
    <div className="flex flex-col gap-[14px]">
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
                <StatusBadge tone="warn">Late {record.lateMinutes} min</StatusBadge>
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
                <StatusBadge key={flag} tone="warn" className="max-w-full whitespace-normal">
                  {flagText(flag, record)}
                </StatusBadge>
              ))}
            </div>
          )}
        </section>
      )}

      {notice && (
        <p role="status" className="m-0 text-[14px] text-neutral-800">
          {noticeText}
        </p>
      )}
      {error && <Alert variant="danger">{error}</Alert>}
      {state.refused && (
        <Alert variant="danger">
          Your {state.refused.kind === 'clock_in' ? 'time in' : 'time out'} of{' '}
          {refusedWhen(state.refused.at)}, saved on this phone, wasn’t counted.{' '}
          {state.refused.reason} If that day’s times are wrong, send a fix request
          {compact ? ' on the Attendance page.' : ' below.'}
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
            Checks you’re at the store.
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
      {!compact && <Rules state={state} />}
    </div>
  );
}
