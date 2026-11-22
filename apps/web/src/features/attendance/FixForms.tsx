import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { manilaDay } from './clock';
import {
  describeFixError,
  fixDay,
  markDay,
  requestFix,
  setRestDay,
  useStaff,
  WEEKDAYS,
  type DayMark,
} from './fixes';

const daysAgo = (n: number) => {
  const date = new Date(`${manilaDay(new Date())}T12:00:00+08:00`);
  date.setDate(date.getDate() - n);
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
};

const fieldClass = 'flex min-w-0 flex-col gap-[6px]';
const panelClass = 'flex flex-col gap-[12px] rounded-[12px] bg-surface px-[16px] py-[14px]';

/** ATT-11: staff ask the Owner to fix one of their days, with the real times and a reason. */
export function FixRequestForm() {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(daysAgo(0));
  const [timeIn, setTimeIn] = useState('');
  const [timeOut, setTimeOut] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="flex flex-col gap-[6px]">
        {notice && (
          <p role="status" className="m-0 text-[14px] text-neutral-800">
            {notice}
          </p>
        )}
        <Button variant="secondary" size="md" className="self-start" onClick={() => setOpen(true)}>
          Ask the Owner to fix a day
        </Button>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    if (!timeIn && !timeOut) {
      setError('Give the time in, the time out, or both.');
      return;
    }
    if (!reason.trim()) {
      setError('Say what happened, for example “Forgot to clock out”.');
      return;
    }
    setBusy(true);
    try {
      await requestFix(day, timeIn, timeOut, reason);
      setNotice('Request sent. The Owner will decide; you can follow it in My requests.');
      setOpen(false);
      setTimeIn('');
      setTimeOut('');
      setReason('');
    } catch (caught) {
      setError(describeFixError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="fix-heading" className={panelClass}>
      <h2 id="fix-heading" className="font-body text-[16px] font-bold">
        Ask the Owner to fix a day
      </h2>
      <p className="m-0 text-[13.5px] text-neutral-700">
        For a forgotten or wrong time in or out. Leave a time empty to keep what is recorded.
      </p>
      <div className={fieldClass}>
        <Label htmlFor="fix-day" className="text-[13px]">
          Day
        </Label>
        <Input
          id="fix-day"
          type="date"
          value={day}
          min={daysAgo(30)}
          max={daysAgo(0)}
          onChange={(event) => setDay(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-[10px]">
        <div className={fieldClass}>
          <Label htmlFor="fix-in" className="text-[13px]">
            Time in
          </Label>
          <Input
            id="fix-in"
            type="time"
            value={timeIn}
            onChange={(event) => setTimeIn(event.target.value)}
          />
        </div>
        <div className={fieldClass}>
          <Label htmlFor="fix-out" className="text-[13px]">
            Time out
          </Label>
          <Input
            id="fix-out"
            type="time"
            value={timeOut}
            onChange={(event) => setTimeOut(event.target.value)}
          />
        </div>
      </div>
      <div className={fieldClass}>
        <Label htmlFor="fix-reason" className="text-[13px]">
          Reason
        </Label>
        <Input
          id="fix-reason"
          value={reason}
          maxLength={200}
          autoComplete="off"
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
      <div className="flex flex-wrap gap-[10px]">
        <Button needsInternet size="md" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Sending…' : 'Send to the Owner'}
        </Button>
        <Button variant="secondary" size="md" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

const ACTIONS = [
  { value: 'times', label: 'Times' },
  { value: 'absent', label: 'Absent' },
  { value: 'rest', label: 'Rest day' },
  { value: 'clear', label: 'Clear mark' },
] as const;
type Action = (typeof ACTIONS)[number]['value'];

/**
 * ATT-11: the Owner fixes any person's day directly (times, Absent, Rest day), with a reason,
 * and sets each person's usual rest day.
 */
export function OwnerFixPanel({
  initialPerson = '',
  initialDay = '',
}: {
  /** From the board's Fix button. */
  initialPerson?: string;
  initialDay?: string;
}) {
  const [reloads, setReloads] = useState(0);
  const staff = useStaff(reloads);
  const [person, setPerson] = useState(initialPerson);
  const [day, setDay] = useState(initialDay || daysAgo(0));
  // A deactivated person's last days may still need a fix: shown when the board points at one.
  const members = staff.data.filter((member) => member.active || member.id === initialPerson);
  const [action, setAction] = useState<Action>('times');
  const [timeIn, setTimeIn] = useState('');
  const [timeOut, setTimeOut] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const chosen = person || members[0]?.id || '';

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (!chosen) return;
    if (action === 'times' && !timeIn && !timeOut) {
      setError('Give the time in, the time out, or both.');
      return;
    }
    if (!reason.trim()) {
      setError('Give a reason; it goes in the audit log.');
      return;
    }
    setBusy(true);
    try {
      if (action === 'times') await fixDay(chosen, day, timeIn, timeOut, reason);
      else await markDay(chosen, day, action as DayMark, reason);
      setNotice('Saved. The day is worked out again from the times.');
      setReason('');
    } catch (caught) {
      setError(describeFixError(caught));
    } finally {
      setBusy(false);
    }
  };

  const changeRestDay = async (id: string, value: string) => {
    setError(null);
    try {
      await setRestDay(id, value === '' ? null : Number(value));
      setReloads((n) => n + 1);
    } catch (caught) {
      setError(describeFixError(caught));
    }
  };

  return (
    <div className="flex flex-col gap-[16px]">
      <section aria-labelledby="owner-fix-heading" className={panelClass}>
        <h2 id="owner-fix-heading" className="font-body text-[16px] font-bold">
          Fix a day
        </h2>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-[10px] sm:grid-cols-2">
          <div className={fieldClass}>
            <Label htmlFor="owner-fix-person" className="text-[13px]">
              Person
            </Label>
            <select
              id="owner-fix-person"
              value={chosen}
              onChange={(event) => setPerson(event.target.value)}
              className="min-h-[48px] w-full min-w-0 rounded-[12px] border border-divider bg-bg px-[12px] text-[15px]"
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <div className={fieldClass}>
            <Label htmlFor="owner-fix-day" className="text-[13px]">
              Day
            </Label>
            <Input
              id="owner-fix-day"
              type="date"
              value={day}
              max={daysAgo(0)}
              onChange={(event) => setDay(event.target.value)}
            />
          </div>
        </div>
        <Segmented label="What to do" options={ACTIONS} value={action} onChange={setAction} />
        {action === 'times' && (
          <div className="grid grid-cols-2 gap-[10px]">
            <div className={fieldClass}>
              <Label htmlFor="owner-fix-in" className="text-[13px]">
                Time in
              </Label>
              <Input
                id="owner-fix-in"
                type="time"
                value={timeIn}
                onChange={(event) => setTimeIn(event.target.value)}
              />
            </div>
            <div className={fieldClass}>
              <Label htmlFor="owner-fix-out" className="text-[13px]">
                Time out
              </Label>
              <Input
                id="owner-fix-out"
                type="time"
                value={timeOut}
                onChange={(event) => setTimeOut(event.target.value)}
              />
            </div>
          </div>
        )}
        <div className={fieldClass}>
          <Label htmlFor="owner-fix-reason" className="text-[13px]">
            Reason
          </Label>
          <Input
            id="owner-fix-reason"
            value={reason}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {error && <Alert variant="danger">{error}</Alert>}
        {notice && (
          <p role="status" className="m-0 text-[14px] text-neutral-800">
            {notice}
          </p>
        )}
        <Button
          needsInternet
          size="md"
          className="self-start"
          disabled={busy || !chosen}
          onClick={() => void submit()}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </section>

      <section aria-labelledby="rest-heading" className={panelClass}>
        <h2 id="rest-heading" className="font-body text-[16px] font-bold">
          Usual rest day
        </h2>
        <p className="m-0 text-[13.5px] text-neutral-700">
          Shown as “Rest day” instead of “not in yet” on that day each week.
        </p>
        {members.map((member) => (
          <div key={member.id} className="flex items-center justify-between gap-[10px] text-[15px]">
            <label htmlFor={`rest-${member.id}`} className="min-w-0 [overflow-wrap:anywhere]">
              {member.name}
            </label>
            <select
              id={`rest-${member.id}`}
              value={member.restWeekday === null ? '' : String(member.restWeekday)}
              onChange={(event) => void changeRestDay(member.id, event.target.value)}
              className="min-h-[44px] flex-none rounded-[12px] border border-divider bg-bg px-[10px] text-[15px]"
            >
              <option value="">None</option>
              {WEEKDAYS.map((name, index) => (
                <option key={name} value={String(index)}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </section>
    </div>
  );
}
