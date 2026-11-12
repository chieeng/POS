import {
  ArrowLeft,
  Banknote,
  CircleCheck,
  HandCoins,
  Plus,
  Smartphone,
  Split,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { PROVIDER_LABELS, type PaymentProvider } from '@/features/store/data';
import { useOnline } from '@/hooks/useOnline';
import { formatPeso } from '@/lib/money';
import { cn, ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import {
  checkout,
  CheckoutError,
  normalizeReference,
  REFERENCE,
  referenceUsedOnDevice,
  type CheckoutSettings,
  type PaymentEntry,
  totalsLines,
  type Slip,
  type SoldLine,
} from './checkout';
import { describeSaleError } from './data';
import { quickCash, saleTotals, type SalePaymentInput } from './totals';

type Method = 'cash' | PaymentProvider | 'split';

const METHODS: { value: Method; label: string; icon: LucideIcon }[] = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'gcash', label: 'GCash', icon: Smartphone },
  { value: 'maya', label: 'Maya', icon: Smartphone },
  { value: 'split', label: 'Split', icon: Split },
];

const PESO = /^\d{1,7}(\.\d{1,2})?$/;
const pesoValue = (text: string) => (PESO.test(text.trim()) ? Number(text.trim()) : null);

interface Row {
  key: number;
  method: 'cash' | PaymentProvider;
  amount: string;
  reference: string;
  accountId: string | null;
}

/**
 * Payment (POS-04): Cash with change, GCash or Maya with a reference, or a split of these.
 * Utang arrives in build step 12. Staff never type a discount (POS-03). A bottom sheet on
 * phones and a dialog from tablet width up, as the POS Payment design shows.
 */
export function PaymentSheet({
  open,
  onOpenChange,
  lines,
  settings,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: SoldLine[];
  settings: CheckoutSettings;
  onDone: (slip: Slip) => void;
}) {
  const user = useSession((s) => s.user);
  const online = useOnline();
  const [method, setMethod] = useState<Method>('cash');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [referenceProblem, setReferenceProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accountsFor = (provider: PaymentProvider) =>
    settings.accounts.filter((account) => account.provider === provider);
  // POS-04: one account is picked automatically; with several, staff choose.
  const defaultAccount = (provider: PaymentProvider) => {
    const list = accountsFor(provider);
    return list.length === 1 ? list[0]!.id : null;
  };

  const exact = saleTotals(totalsLines(lines), [], false).subtotal;

  const payments: PaymentEntry[] =
    method === 'cash'
      ? [{ method: 'cash', amount: pesoValue(tendered) ?? 0 }]
      : method === 'split'
        ? rows.map((row) =>
            row.method === 'cash'
              ? { method: 'cash', amount: pesoValue(row.amount) ?? 0 }
              : {
                  method: row.method,
                  amount: pesoValue(row.amount) ?? 0,
                  reference: row.reference,
                  accountId: row.accountId,
                },
          )
        : [{ method, amount: exact, reference, accountId }];

  const totals = saleTotals(
    totalsLines(lines),
    payments.filter((payment) => payment.amount > 0) as SalePaymentInput[],
    settings.roundCash,
  );
  // What staff ask for: in cash, the rounded amount; by GCash or Maya, the exact one.
  const toPay = method === 'cash' ? totals.cashDue : totals.total;

  const choose = (next: Method) => {
    setMethod(next);
    setProblem(null);
    setReferenceProblem(null);
    if (next === 'gcash' || next === 'maya') setAccountId(defaultAccount(next));
    if (next === 'split' && rows.length === 0) {
      setRows([
        { key: 1, method: 'cash', amount: '', reference: '', accountId: null },
        { key: 2, method: 'gcash', amount: '', reference: '', accountId: defaultAccount('gcash') },
      ]);
    }
  };

  const checkReference = (provider: PaymentProvider, text: string, account: string | null) => {
    const ref = normalizeReference(text);
    if (!REFERENCE.test(ref)) {
      return `Enter the ${PROVIDER_LABELS[provider]} reference number from the customer's screen.`;
    }
    const usedOn = referenceUsedOnDevice(provider, ref);
    if (usedOn) {
      return `This reference was already used on receipt ${usedOn}. Check the customer's ${PROVIDER_LABELS[provider]} screen and type it again.`;
    }
    if (accountsFor(provider).length > 1 && !account) {
      return `Choose which ${PROVIDER_LABELS[provider]} account the customer paid.`;
    }
    return null;
  };

  const complete = async () => {
    if (!user) return;
    setProblem(null);
    setReferenceProblem(null);
    if (method === 'cash') {
      const amount = pesoValue(tendered);
      if (amount === null || amount < totals.cashDue) {
        setProblem(`Enter the cash received: at least ${formatPeso(totals.cashDue)}.`);
        return;
      }
    } else if (method === 'split') {
      for (const row of rows) {
        if (pesoValue(row.amount) === null || Number(row.amount) <= 0) {
          setProblem('Enter an amount on every line, or remove the line.');
          return;
        }
        if (row.method !== 'cash') {
          const message = checkReference(row.method, row.reference, row.accountId);
          if (message) {
            setProblem(message);
            return;
          }
        }
      }
      if (rows.filter((row) => row.method === 'cash').length > 1) {
        setProblem('Put all the cash on one line.');
        return;
      }
      if (totals.problem === 'more_than_total') {
        setProblem('GCash and Maya add up to more than the total.');
        return;
      }
      if (totals.problem === 'cash_needed' || totals.problem === 'cash_short') {
        setProblem(`${formatPeso(totals.cashDue)} is still to be paid.`);
        return;
      }
      if (totals.problem === 'cash_not_needed') {
        setProblem('GCash and Maya already cover the total: remove the cash line.');
        return;
      }
    } else {
      const message = checkReference(method, reference, accountId);
      if (message) {
        setReferenceProblem(message);
        return;
      }
    }

    setBusy(true);
    try {
      const slip = await checkout({
        uid: user.uid,
        branchId: user.branchId,
        userCode: user.userCode,
        salesperson: user.displayName,
        settings,
        lines,
        payments: payments.filter((payment) => payment.amount > 0),
        online,
      });
      onDone(slip);
    } catch (error) {
      if (error instanceof CheckoutError && error.reason === 'no_user_code') {
        setProblem(
          'Connect to the internet once so this device can number receipts, then try again.',
        );
      } else if (error instanceof CheckoutError && error.reason === 'storage') {
        setProblem(
          "This device couldn't keep the sale. Connect to the internet and try again, or record it on paper.",
        );
      } else {
        const cause = error instanceof CheckoutError ? error.detail : error;
        const { message } = (cause ?? {}) as { message?: unknown };
        const text = describeSaleError(cause);
        if (message === 'duplicate_reference' && method !== 'split') setReferenceProblem(text);
        else setProblem(text);
      }
    } finally {
      setBusy(false);
    }
  };

  const rowsCovered = method === 'split' && totals.problem === null && rows.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        aria-describedby={undefined}
        className="gap-[16px] md:w-[min(560px,calc(100vw-32px))]"
      >
        <div className="flex items-center gap-[8px]">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Back to the cart"
            onClick={() => onOpenChange(false)}
          >
            <ArrowLeft size={18} strokeWidth={ICON_STROKE} aria-hidden />
          </Button>
          <SheetTitle className="flex-1 font-body text-[15px] text-neutral-700">
            Total to pay
          </SheetTitle>
          <span
            className="font-heading text-[30px]"
            aria-label={`Total to pay ${formatPeso(toPay)}`}
          >
            {formatPeso(toPay)}
          </span>
        </div>
        {method === 'cash' && totals.rounding !== 0 && (
          <p className="-mt-[10px] text-right text-[13px] text-neutral-700">
            {formatPeso(totals.subtotal)} rounded to the peso for cash
          </p>
        )}

        <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-4 gap-[8px]">
          {METHODS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={method === value}
              onClick={() => choose(value)}
              className={cn(
                'flex h-[52px] items-center justify-center gap-[6px] rounded-full text-[14.5px]',
                method === value
                  ? 'bg-text font-bold text-bg'
                  : 'border border-divider hover:bg-text/7',
              )}
            >
              <Icon
                size={17}
                strokeWidth={ICON_STROKE}
                className={method === value ? undefined : 'text-neutral-700'}
                aria-hidden
              />
              {label}
            </button>
          ))}
        </div>

        {method === 'cash' && (
          <>
            <div>
              <Label htmlFor="pay-cash" className="text-[13px]">
                Amount received
              </Label>
              <Input
                id="pay-cash"
                inputMode="decimal"
                autoComplete="off"
                placeholder={formatPeso(totals.cashDue)}
                value={tendered}
                onChange={(event) => {
                  setTendered(event.target.value);
                  setProblem(null);
                }}
                className="min-h-[64px] rounded-full border-[1.5px] border-accent bg-surface px-[22px] font-heading text-[30px]"
              />
            </div>
            <div className="flex flex-wrap gap-[8px]">
              {quickCash(totals.cashDue).map((amount, index) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => {
                    setTendered(amount.toFixed(2));
                    setProblem(null);
                  }}
                  className="flex h-[44px] items-center rounded-full bg-surface px-[16px] text-[14.5px] font-semibold hover:bg-text/7"
                >
                  {index === 0 ? 'Exact' : formatPeso(amount).replace('.00', '')}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-[28px] bg-accent-2-100 px-[20px] py-[16px] text-accent-2-800">
              <span className="flex items-center gap-[8px] text-[15px] font-bold">
                <HandCoins size={20} strokeWidth={ICON_STROKE} aria-hidden />
                Change
              </span>
              <span className="font-heading text-[36px] leading-none" aria-label="Change">
                {formatPeso(totals.problem === null ? totals.change : 0)}
              </span>
            </div>
          </>
        )}

        {(method === 'gcash' || method === 'maya') && (
          <>
            <div className="flex justify-between rounded-[24px] bg-surface px-[18px] py-[14px] text-[15px]">
              <span>{PROVIDER_LABELS[method]} amount</span>
              <b>{formatPeso(exact)}</b>
            </div>
            <AccountPicker
              provider={method}
              accounts={accountsFor(method)}
              value={accountId}
              onChange={setAccountId}
            />
            <ReferenceField
              id="pay-reference"
              provider={method}
              value={reference}
              problem={referenceProblem}
              onChange={(value) => {
                setReference(value);
                setReferenceProblem(null);
              }}
            />
          </>
        )}

        {method === 'split' && (
          <div className="flex flex-col gap-[10px]">
            {rows.map((row, index) => (
              <div
                key={row.key}
                className="flex flex-col gap-[10px] rounded-[26px] bg-surface px-[14px] py-[12px]"
              >
                <div className="flex items-center gap-[10px]">
                  <select
                    aria-label={`Method, line ${index + 1}`}
                    value={row.method}
                    onChange={(event) => {
                      const next = event.target.value as Row['method'];
                      setRows((current) =>
                        current.map((r) =>
                          r.key === row.key
                            ? {
                                ...r,
                                method: next,
                                accountId: next === 'cash' ? null : defaultAccount(next),
                              }
                            : r,
                        ),
                      );
                      setProblem(null);
                    }}
                    className="min-h-[48px] w-[110px] rounded-full border border-divider bg-bg px-[12px] text-[15px] font-bold"
                  >
                    <option value="cash">Cash</option>
                    <option value="gcash">GCash</option>
                    <option value="maya">Maya</option>
                  </select>
                  <Input
                    aria-label={`Amount, line ${index + 1}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="₱0.00"
                    value={row.amount}
                    onChange={(event) => {
                      setRows((current) =>
                        current.map((r) =>
                          r.key === row.key ? { ...r, amount: event.target.value } : r,
                        ),
                      );
                      setProblem(null);
                    }}
                    className="min-h-[48px] flex-1 bg-bg text-[17px] font-semibold"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={rows.length <= 1}
                    onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  >
                    <X size={17} strokeWidth={ICON_STROKE} aria-hidden />
                  </Button>
                </div>
                {row.method !== 'cash' && (
                  <>
                    <AccountPicker
                      provider={row.method}
                      accounts={accountsFor(row.method)}
                      value={row.accountId}
                      onChange={(value) =>
                        setRows((current) =>
                          current.map((r) => (r.key === row.key ? { ...r, accountId: value } : r)),
                        )
                      }
                    />
                    <ReferenceField
                      id={`pay-reference-${row.key}`}
                      provider={row.method}
                      value={row.reference}
                      problem={null}
                      onChange={(value) => {
                        setRows((current) =>
                          current.map((r) => (r.key === row.key ? { ...r, reference: value } : r)),
                        );
                        setProblem(null);
                      }}
                    />
                  </>
                )}
              </div>
            ))}
            {rows.length < 4 && (
              <Button
                variant="ghost"
                className="min-h-[44px] self-start text-accent-700"
                onClick={() =>
                  setRows((current) => [
                    ...current,
                    {
                      key: Math.max(0, ...current.map((r) => r.key)) + 1,
                      method: current.some((r) => r.method === 'cash') ? 'maya' : 'cash',
                      amount: '',
                      reference: '',
                      accountId: current.some((r) => r.method === 'cash')
                        ? defaultAccount('maya')
                        : null,
                    },
                  ])
                }
              >
                <Plus size={16} strokeWidth={ICON_STROKE} aria-hidden />
                Add another method
              </Button>
            )}
            <div
              role="status"
              className={cn(
                'flex items-center justify-between rounded-[24px] px-[18px] py-[14px] font-bold',
                rowsCovered ? 'bg-accent-2-100 text-accent-2-800' : 'bg-neutral-200 text-text',
              )}
            >
              {rowsCovered ? (
                <>
                  <span className="flex items-center gap-[8px]">
                    <CircleCheck size={18} strokeWidth={ICON_STROKE} aria-hidden />
                    Fully covered
                  </span>
                  <span>
                    {totals.change > 0 ? `Change ${formatPeso(totals.change)}` : 'Remaining ₱0.00'}
                  </span>
                </>
              ) : (
                <>
                  <span>Remaining</span>
                  <span>
                    {formatPeso(
                      Math.max(
                        totals.cashDue -
                          (pesoValue(rows.find((r) => r.method === 'cash')?.amount ?? '') ?? 0),
                        0,
                      ),
                    )}
                  </span>
                </>
              )}
            </div>
            {totals.rounding !== 0 && (
              <p className="text-[13px] text-neutral-700">
                The cash part is rounded to the peso: rounding {totals.rounding > 0 ? '+' : '−'}
                {formatPeso(Math.abs(totals.rounding))}.
              </p>
            )}
          </div>
        )}

        {problem && <Alert variant="danger">{problem}</Alert>}
        {!online && (
          <Alert variant="offline">
            Offline: the sale is kept on this phone and sent when the connection is back.
          </Alert>
        )}
        <Button
          className="min-h-[58px] w-full text-[20px]"
          disabled={busy || lines.length === 0}
          onClick={() => void complete()}
        >
          {busy ? 'Saving…' : 'Complete sale'}
        </Button>
      </SheetContent>
    </Sheet>
  );
}

function AccountPicker({
  provider,
  accounts,
  value,
  onChange,
}: {
  provider: PaymentProvider;
  accounts: { id: string; label: string; number: string }[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (accounts.length === 0) return null;
  if (accounts.length === 1) {
    return (
      <p className="px-[6px] text-[13.5px] text-neutral-700">
        To {accounts[0]!.label} · {accounts[0]!.number}
      </p>
    );
  }
  return (
    <div
      role="radiogroup"
      aria-label={`${PROVIDER_LABELS[provider]} account`}
      className="flex flex-wrap gap-[8px]"
    >
      {accounts.map((account) => (
        <button
          key={account.id}
          type="button"
          role="radio"
          aria-checked={value === account.id}
          onClick={() => onChange(account.id)}
          className={cn(
            'flex min-h-[44px] flex-col items-start justify-center rounded-[18px] px-[14px] py-[6px] text-left text-[13.5px]',
            value === account.id ? 'bg-text text-bg' : 'border border-divider hover:bg-text/7',
          )}
        >
          <b>{account.label}</b>
          <span className={value === account.id ? undefined : 'text-neutral-700'}>
            {account.number}
          </span>
        </button>
      ))}
    </div>
  );
}

function ReferenceField({
  id,
  provider,
  value,
  problem,
  onChange,
}: {
  id: string;
  provider: PaymentProvider;
  value: string;
  problem: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-[13px]">
        {PROVIDER_LABELS[provider]} reference no. <span className="text-danger-fg">· required</span>
      </Label>
      <Input
        id={id}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        maxLength={48}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!!problem || undefined}
        aria-describedby={problem ? `${id}-error` : undefined}
        className={cn(
          'min-h-[56px] rounded-full bg-surface px-[20px] text-[19px] font-semibold tracking-[0.04em]',
          problem && 'border-2 border-danger',
        )}
      />
      {problem && (
        <p id={`${id}-error`} className="mt-[8px] px-[6px] text-[14px] text-danger-fg">
          {problem}
        </p>
      )}
    </div>
  );
}
