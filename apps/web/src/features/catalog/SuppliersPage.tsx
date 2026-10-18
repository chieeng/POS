import { useState, type FormEvent } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tag } from '@/components/ui/tag';
import { useSession } from '@/stores/session';
import {
  createSupplier,
  describeCatalogError,
  sortByActiveThenName,
  updateSupplier,
  useSuppliers,
  type Supplier,
  type SupplierFields,
} from './data';

const EMPTY: SupplierFields = { name: '', contact_person: '', phone: '', address: '' };

const FIELDS: { key: keyof SupplierFields; label: string; max: number; type?: string }[] = [
  { key: 'name', label: 'Supplier name', max: 120 },
  { key: 'contact_person', label: 'Contact person', max: 80 },
  { key: 'phone', label: 'Phone', max: 40, type: 'tel' },
  { key: 'address', label: 'Address', max: 200 },
];

function SupplierFieldset({
  idPrefix,
  values,
  onChange,
}: {
  idPrefix: string;
  values: SupplierFields;
  onChange: (values: SupplierFields) => void;
}) {
  return (
    <>
      {FIELDS.map(({ key, label, max, type }) => (
        <div key={key}>
          <Label htmlFor={`${idPrefix}-${key}`} className="text-[13px]">
            {label}
            {key !== 'name' && <span className="text-neutral-700"> (optional)</span>}
          </Label>
          <Input
            id={`${idPrefix}-${key}`}
            type={type ?? 'text'}
            inputMode={type === 'tel' ? 'tel' : undefined}
            value={values[key]}
            maxLength={max}
            autoComplete="off"
            onChange={(event) => onChange({ ...values, [key]: event.target.value })}
            className="min-h-[46px] bg-bg text-[15px]"
          />
        </div>
      ))}
    </>
  );
}

const fieldsOf = (supplier: Supplier): SupplierFields => ({
  name: supplier.name,
  contact_person: supplier.contactPerson ?? '',
  phone: supplier.phone ?? '',
  address: supplier.address ?? '',
});

/**
 * Products > Suppliers (SRS 3.2, PROD-03). The Owner and Special Sales add and read them; only
 * the Owner edits, deactivates or reactivates. Sales do not see suppliers at all.
 */
export function SuppliersPage() {
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const suppliers = useSuppliers();
  const rows = sortByActiveThenName(suppliers.data);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<SupplierFields>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<Supplier | null>(null);
  const [edit, setEdit] = useState<SupplierFields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setAddError(null);
    setNotice(null);
    if (!draft.name.trim()) {
      setAddError('Enter the supplier name.');
      return;
    }
    setSaving(true);
    try {
      await createSupplier(draft);
      setNotice(`Added “${draft.name.trim()}”.`);
      setDraft(EMPTY);
      setAdding(false);
    } catch (caught) {
      setAddError(describeCatalogError(caught, 'supplier'));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (supplier: Supplier) => {
    setNotice(null);
    setEditError(null);
    setEdit(fieldsOf(supplier));
    setEditing(supplier);
  };

  const save = async (changes: Partial<SupplierFields> & { active?: boolean }, done: string) => {
    if (!editing) return;
    setBusy(true);
    setEditError(null);
    try {
      await updateSupplier(editing.id, changes);
      setNotice(done);
      setEditing(null);
    } catch (caught) {
      setEditError(describeCatalogError(caught, 'supplier'));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!edit.name.trim()) {
      setEditError('Enter the supplier name.');
      return;
    }
    void save(edit, `Saved “${edit.name.trim()}”.`);
  };

  return (
    <div className="flex flex-col gap-[14px]">
      {adding ? (
        <form
          onSubmit={(event) => void add(event)}
          noValidate
          aria-label="New supplier"
          className="flex flex-col gap-[12px] rounded-[30px] bg-surface px-[18px] py-[16px] md:px-[22px]"
        >
          <h2 className="font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase">
            New supplier
          </h2>
          <SupplierFieldset idPrefix="new-supplier" values={draft} onChange={setDraft} />
          {addError && <Alert variant="danger">{addError}</Alert>}
          <div className="flex flex-wrap gap-[10px]">
            <Button type="submit" className="min-h-[46px] px-[20px]" disabled={saving}>
              {saving ? 'Adding…' : 'Add supplier'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-[46px] px-[18px]"
              disabled={saving}
              onClick={() => {
                setAdding(false);
                setAddError(null);
                setDraft(EMPTY);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          className="min-h-[46px] self-start px-[20px]"
          onClick={() => {
            setNotice(null);
            setAdding(true);
          }}
        >
          New supplier
        </Button>
      )}

      {notice && (
        <p role="status" className="px-[4px] text-[14px] text-neutral-800">
          {notice}
        </p>
      )}
      {!isOwner && (
        <p className="px-[4px] text-[13px] text-neutral-700">
          To change or deactivate a supplier, ask the Owner.
        </p>
      )}

      {suppliers.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load the suppliers.</b> Check your connection and reload.
        </Alert>
      ) : suppliers.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-neutral-700">No suppliers yet.</p>
      ) : (
        <ul className="rounded-[30px] bg-surface px-[14px] py-[6px] md:px-[22px]">
          {rows.map((supplier) => (
            <li
              key={supplier.id}
              className="flex min-h-[56px] flex-wrap items-center gap-[10px] border-b border-text/8 py-[8px] last:border-b-0"
            >
              <span className={supplier.active ? 'min-w-0 flex-1' : 'min-w-0 flex-1 opacity-55'}>
                <span className="block text-[15px]">{supplier.name}</span>
                {(supplier.contactPerson || supplier.phone) && (
                  <span className="block text-[12.5px] text-neutral-700">
                    {[supplier.contactPerson, supplier.phone].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              {!supplier.active && <Tag variant="muted">Inactive</Tag>}
              {isOwner && (
                <Button
                  variant="secondary"
                  className="min-h-[40px] px-[14px] text-[13.5px]"
                  onClick={() => openEdit(supplier)}
                  aria-label={`Edit ${supplier.name}`}
                >
                  Edit
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(next) => !next && !busy && setEditing(null)}>
        {editing && (
          <DialogContent>
            <form onSubmit={saveEdit} noValidate className="flex flex-col gap-[12px]">
              <DialogTitle>Edit supplier</DialogTitle>
              <DialogDescription className="sr-only">
                Change {editing.name}&apos;s details, or deactivate it.
              </DialogDescription>
              <SupplierFieldset idPrefix="edit-supplier" values={edit} onChange={setEdit} />
              {editError && <Alert variant="danger">{editError}</Alert>}
              <DialogActions className="justify-between">
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-[46px] px-[16px]"
                  disabled={busy}
                  onClick={() =>
                    void save(
                      { active: !editing.active },
                      `“${editing.name}” is ${editing.active ? 'deactivated' : 'active again'}.`,
                    )
                  }
                >
                  {editing.active ? 'Deactivate' : 'Reactivate'}
                </Button>
                <span className="flex gap-[10px]">
                  <DialogClose asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-[46px] px-[18px]"
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button type="submit" className="min-h-[46px] px-[22px]" disabled={busy}>
                    {busy ? 'Saving…' : 'Save'}
                  </Button>
                </span>
              </DialogActions>
              {editing.active && (
                <p className="text-[12.5px] text-neutral-700">
                  A deactivated supplier stays on past stock-ins but can no longer be chosen for new
                  ones.
                </p>
              )}
            </form>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
