import { useEffect, useId, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { formatPeso } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useSession } from '@/stores/session';
import {
  describeDrawerError,
  fetchExpectedCash,
  parsePeso,
  REASON_LABELS,
  REASONS,
  recordDrawerEntry,
  type EntryReason,
  type EntryType,
} from './data';
import { PesoInput } from './PesoInput';

const TYPES = [
  { value: 'cash_in', label: 'Cash in' },
  { value: 'cash_out', label: 'Cash out' },
] as const;

/**
 * Cash Drawer.dc.html 8b (SHIFT-02): cash in or out of today's drawer, with a reason and an
 * optional note (required for Other). Only the Owner sees "Expected cash after": staff never
 * see expected cash before the closing count (the Owner's decision, Oct 31, 2026).
 */
export function CashMoveSheet({
  open,
  initialType,
  onOpenChange,
  onRecorded,
}: {
  open: boolean;
  initialType: EntryType;
  onOpenChange: (open: boolean) => void;
  onRecorded: (message: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        {open && (
          <CashMoveForm
            initialType={initialType}
            onDone={(message) => {
              onOpenChange(false);
              onRecorded(message);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CashMoveForm({
  initialType,
  onDone,
}: {
  initialType: EntryType;
  onDone: (message: string) => void;
}) {
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [type, setType] = useState<EntryType>(initialType);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<EntryReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expected, setExpected] = useState<number | null>(null);
  const reasonLabel = useId();

  useEffect(() => {
    if (!isOwner) return;
    let current = true;
    fetchExpectedCash().then(
      (value) => {
        if (current) setExpected(value);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [isOwner]);

  const value = parsePeso(amount);
  const label = type === 'cash_in' ? 'Cash in' : 'Cash out';
  const after =
    expected === null || value === null ? null : expected + (type === 'cash_in' ? value : -value);

  const submit = async () => {
    setError(null);
    if (value === null || value <= 0) {
      setError('Enter the amount, for example 350.');
      return;
    }
    if (!reason || !REASONS[type].includes(reason)) {
      setError('Choose a reason.');
      return;
    }
    if (reason === 'other' && !note.trim()) {
      setError('Add a note: what was it for?');
      return;
    }
    setBusy(true);
    try {
      await recordDrawerEntry(type, value, reason, note.trim() || null);
      onDone(`${label} of ${formatPeso(value)} recorded.`);
    } catch (caught) {
      setError(describeDrawerError(caught));
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-[14px]"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <SheetTitle className="sr-only">{label}</SheetTitle>
      <Segmented
        label="Cash in or out"
        options={TYPES}
        value={type}
        onChange={(next) => {
          setType(next);
          if (reason && !REASONS[next].includes(reason)) setReason(null);
        }}
      />
      <div className="flex flex-col gap-[6px]">
        <Label htmlFor="drawer-amount" className="text-[13px]">
          Amount
        </Label>
        <PesoInput
          id="drawer-amount"
          size="md"
          value={amount}
          placeholder="0.00"
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-[8px]">
        <span id={reasonLabel} className="text-[13px] font-semibold">
          Reason
        </span>
        <div role="radiogroup" aria-labelledby={reasonLabel} className="flex flex-wrap gap-[8px]">
          {REASONS[type].map((option) => (
            <label
              key={option}
              className={cn(
                'flex h-11 cursor-pointer items-center rounded-full px-[16px] text-[14.5px]',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                reason === option
                  ? 'bg-text font-semibold text-bg'
                  : 'border border-divider hover:bg-text/7',
              )}
            >
              <input
                type="radio"
                name={reasonLabel}
                value={option}
                checked={reason === option}
                onChange={() => setReason(option)}
                className="sr-only"
              />
              {REASON_LABELS[option]}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-[6px]">
        <Label htmlFor="drawer-note" className="text-[13px]">
          {reason === 'other' ? 'Note · required for Other' : 'Note (optional)'}
        </Label>
        <Input
          id="drawer-note"
          value={note}
          maxLength={200}
          autoComplete="off"
          placeholder="For example: Ice, 2 sacks (Mang Berto)"
          onChange={(event) => setNote(event.target.value)}
          className="min-h-[50px] text-[15px]"
        />
      </div>
      {isOwner && after !== null && (
        <p className="px-[6px] text-[13.5px] text-neutral-700">
          Expected cash after: {formatPeso(after)}
        </p>
      )}
      {error && <Alert variant="danger">{error}</Alert>}
      <Button needsInternet type="submit" size="lg" disabled={busy}>
        {busy ? 'Recording…' : `Record ${label.toLowerCase()}`}
      </Button>
    </form>
  );
}
