import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Tag } from '@/components/ui/tag';
import { ICON_STROKE } from '@/lib/utils';
import {
  createPaymentAccount,
  describeSaveError,
  PROVIDER_LABELS,
  sortAccounts,
  updatePaymentAccount,
  usePaymentAccounts,
  type PaymentAccount,
} from './data';
import { paymentAccountSchema, type PaymentAccountValues } from './schemas';

const sectionClass =
  'flex flex-col gap-[14px] rounded-[30px] bg-surface px-[18px] py-[18px] md:px-[22px]';
const headingClass = 'font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase';
const inputClass = 'min-h-[48px] bg-bg text-[15px]';

const PROVIDERS = [
  { value: 'gcash', label: 'GCash' },
  { value: 'maya', label: 'Maya' },
] as const;

/**
 * POS-04 in Store settings: the store's GCash and Maya accounts. Staff pick which one the
 * customer paid; each sale keeps a copy of the label. Accounts are deactivated, never deleted.
 */
export function PaymentAccountsSection() {
  const accounts = usePaymentAccounts();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = sortAccounts(accounts.data);
  const active = list.filter((account) => account.active).length;

  const setActive = async (account: PaymentAccount, value: boolean) => {
    setError(null);
    setBusyId(account.id);
    try {
      await updatePaymentAccount(account.id, { active: value });
    } catch (caught) {
      setError(describeSaveError(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={sectionClass} aria-labelledby="accounts-heading">
      <h2 id="accounts-heading" className={headingClass}>
        GCash and Maya accounts
      </h2>
      <p className="text-[13.5px] text-neutral-700">
        {active === 0
          ? 'No account yet. GCash and Maya still work: staff type the reference number. Add the store’s numbers so each sale says which one was paid.'
          : active === 1
            ? 'Checkout picks this account automatically. Staff type the reference number.'
            : 'Staff pick which account the customer paid, then type the reference number.'}
      </p>
      {error && <Alert variant="danger">{error}</Alert>}

      {accounts.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load the accounts.</b> Check your connection and reload.
        </Alert>
      ) : accounts.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : (
        list.length > 0 && (
          <ul aria-label="Payment accounts" className="flex flex-col">
            {list.map((account) => (
              <li
                key={account.id}
                aria-label={`${PROVIDER_LABELS[account.provider]} ${account.label}`}
                className="flex flex-col gap-[10px] border-b border-text/8 py-[10px] last:border-b-0"
              >
                {editingId === account.id ? (
                  <AccountForm
                    account={account}
                    onDone={() => setEditingId(null)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-[10px]">
                    <Tag variant={account.provider === 'gcash' ? 'accent' : 'accent-2'}>
                      {PROVIDER_LABELS[account.provider]}
                    </Tag>
                    <span
                      className={
                        account.active ? 'min-w-0 flex-1' : 'min-w-0 flex-1 text-neutral-700'
                      }
                    >
                      <b className="block text-[15px]">{account.label}</b>
                      <span className="block text-[13.5px]">{account.number}</span>
                    </span>
                    {!account.active && <Tag variant="muted">Inactive</Tag>}
                    <Button
                      needsInternet
                      variant="secondary"
                      className="min-h-[44px] px-[14px]"
                      aria-label={`Edit ${account.label}`}
                      onClick={() => {
                        setError(null);
                        setAdding(false);
                        setEditingId(account.id);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      needsInternet
                      variant="secondary"
                      className="min-h-[44px] px-[14px]"
                      aria-label={`${account.active ? 'Deactivate' : 'Reactivate'} ${account.label}`}
                      disabled={busyId === account.id}
                      onClick={() => void setActive(account, !account.active)}
                    >
                      {account.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      )}

      {adding ? (
        <AccountForm onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
      ) : (
        <Button
          needsInternet
          variant="secondary"
          className="min-h-[46px] self-start px-[18px]"
          onClick={() => {
            setError(null);
            setEditingId(null);
            setAdding(true);
          }}
        >
          <Plus size={17} strokeWidth={ICON_STROKE} aria-hidden />
          Add account
        </Button>
      )}
      <p className="text-[12.5px] text-neutral-700">
        An account is never deleted, so past sales keep pointing at it. Deactivate one the store no
        longer uses.
      </p>
    </section>
  );
}

/** Add an account, or change one's label and number. The provider is fixed once added. */
function AccountForm({
  account,
  onDone,
  onCancel,
}: {
  account?: PaymentAccount;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const prefix = account ? `account-${account.id}` : 'account-new';
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PaymentAccountValues>({
    resolver: zodResolver(paymentAccountSchema),
    defaultValues: {
      provider: account?.provider ?? 'gcash',
      label: account?.label ?? '',
      number: account?.number ?? '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      if (account) {
        const changes: { label?: string; number?: string } = {};
        if (values.label !== account.label) changes.label = values.label;
        if (values.number !== account.number) changes.number = values.number;
        if (Object.keys(changes).length > 0) await updatePaymentAccount(account.id, changes);
      } else {
        await createPaymentAccount(values);
      }
      onDone();
    } catch (caught) {
      setError(describeSaveError(caught));
    }
  });

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      aria-label={account ? `Edit ${account.label}` : 'Add a payment account'}
      className="flex flex-col gap-[12px] rounded-[22px] bg-bg px-[14px] py-[14px]"
    >
      {error && <Alert variant="danger">{error}</Alert>}
      {account ? (
        <p className="text-[13.5px] text-neutral-700">
          {PROVIDER_LABELS[account.provider]} account. To switch it to{' '}
          {account.provider === 'gcash' ? 'Maya' : 'GCash'}, deactivate it and add a new one.
        </p>
      ) : (
        <Controller
          control={control}
          name="provider"
          render={({ field }) => (
            <Segmented
              label="Provider"
              options={PROVIDERS}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      )}
      <div className="grid gap-[12px] sm:grid-cols-2">
        <div>
          <Label htmlFor={`${prefix}-label`} className="text-[13px]">
            Label
          </Label>
          <Input
            id={`${prefix}-label`}
            autoComplete="off"
            maxLength={40}
            placeholder="For example: Main GCash"
            className={inputClass}
            aria-invalid={!!errors.label || undefined}
            aria-describedby={errors.label ? `${prefix}-label-error` : undefined}
            {...register('label')}
          />
          {errors.label && (
            <p id={`${prefix}-label-error`} className="mt-[5px] text-[13px] text-danger-fg">
              {errors.label.message}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor={`${prefix}-number`} className="text-[13px]">
            Number
          </Label>
          <Input
            id={`${prefix}-number`}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="0917 123 4567"
            className={inputClass}
            aria-invalid={!!errors.number || undefined}
            aria-describedby={errors.number ? `${prefix}-number-error` : undefined}
            {...register('number')}
          />
          {errors.number && (
            <p id={`${prefix}-number-error`} className="mt-[5px] text-[13px] text-danger-fg">
              {errors.number.message}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-[10px]">
        <Button
          needsInternet
          type="submit"
          className="min-h-[46px] px-[20px]"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Saving…' : account ? 'Save account' : 'Add account'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-[46px] px-[18px]"
          disabled={isSubmitting}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
