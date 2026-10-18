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
  createCategory,
  describeCatalogError,
  sortByActiveThenName,
  updateCategory,
  useCategories,
  type Category,
} from './data';

const NAME_MAX = 60;

type Pending =
  { kind: 'rename'; category: Category } | { kind: 'active'; category: Category } | null;

/**
 * Products > Categories (SRS 3.2, PROD-03). The Owner and Special Sales add; only the Owner
 * renames, deactivates or reactivates. Until approval requests exist (build step 3), Special
 * Sales asks the Owner for changes.
 */
export function CategoriesPage() {
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const categories = useCategories();
  const rows = sortByActiveThenName(categories.data);

  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [pending, setPending] = useState<Pending>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setAddError(null);
    setNotice(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setAddError('Enter a name.');
      return;
    }
    setAdding(true);
    try {
      await createCategory(trimmed);
      setName('');
      setNotice(`Added “${trimmed}”.`);
    } catch (caught) {
      setAddError(describeCatalogError(caught, 'category'));
    } finally {
      setAdding(false);
    }
  };

  const open = (next: Pending) => {
    setDialogError(null);
    setNotice(null);
    if (next?.kind === 'rename') setNewName(next.category.name);
    setPending(next);
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setDialogError(null);
    try {
      if (pending.kind === 'rename') {
        const trimmed = newName.trim();
        if (!trimmed) {
          setDialogError('Enter a name.');
          return;
        }
        await updateCategory(pending.category.id, { name: trimmed });
        setNotice(`Renamed to “${trimmed}”.`);
      } else {
        const active = !pending.category.active;
        await updateCategory(pending.category.id, { active });
        setNotice(`“${pending.category.name}” is ${active ? 'active again' : 'deactivated'}.`);
      }
      setPending(null);
    } catch (caught) {
      setDialogError(describeCatalogError(caught, 'category'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-[14px]">
      <form
        onSubmit={(event) => void add(event)}
        noValidate
        className="flex flex-col gap-[8px] rounded-[30px] bg-surface px-[18px] py-[16px] md:px-[22px]"
      >
        <Label htmlFor="new-category" className="text-[13px]">
          New category
        </Label>
        <div className="flex flex-wrap gap-[10px]">
          <Input
            id="new-category"
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            placeholder="For example Snacks"
            onChange={(event) => setName(event.target.value)}
            className="min-h-[46px] min-w-0 flex-1 bg-bg text-[15px]"
            aria-invalid={!!addError || undefined}
            aria-describedby={addError ? 'new-category-error' : undefined}
          />
          <Button type="submit" className="min-h-[46px] px-[20px]" disabled={adding}>
            {adding ? 'Adding…' : 'Add category'}
          </Button>
        </div>
        {addError && (
          <p id="new-category-error" className="text-[13px] text-danger-fg">
            {addError}
          </p>
        )}
      </form>

      {notice && (
        <p role="status" className="px-[4px] text-[14px] text-neutral-800">
          {notice}
        </p>
      )}
      {!isOwner && (
        <p className="px-[4px] text-[13px] text-neutral-700">
          To rename or deactivate a category, ask the Owner.
        </p>
      )}

      {categories.error ? (
        <Alert variant="danger">
          <b>Couldn&apos;t load the categories.</b> Check your connection and reload.
        </Alert>
      ) : categories.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-neutral-700">No categories yet.</p>
      ) : (
        <ul className="rounded-[30px] bg-surface px-[14px] py-[6px] md:px-[22px]">
          {rows.map((category) => (
            <li
              key={category.id}
              className="flex min-h-[56px] flex-wrap items-center gap-[10px] border-b border-text/8 py-[8px] last:border-b-0"
            >
              <span
                className={
                  category.active
                    ? 'min-w-0 flex-1 text-[15px]'
                    : 'min-w-0 flex-1 text-[15px] opacity-55'
                }
              >
                {category.name}
              </span>
              {!category.active && <Tag variant="muted">Inactive</Tag>}
              {isOwner && (
                <span className="flex gap-[6px]">
                  <Button
                    variant="secondary"
                    className="min-h-[40px] px-[14px] text-[13.5px]"
                    onClick={() => open({ kind: 'rename', category })}
                    aria-label={`Rename ${category.name}`}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-[40px] px-[14px] text-[13.5px]"
                    onClick={() => open({ kind: 'active', category })}
                    aria-label={`${category.active ? 'Deactivate' : 'Reactivate'} ${category.name}`}
                  >
                    {category.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={pending !== null} onOpenChange={(next) => !next && !busy && setPending(null)}>
        {pending && (
          <DialogContent>
            {pending.kind === 'rename' ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirm();
                }}
                noValidate
                className="flex flex-col gap-[14px]"
              >
                <DialogTitle>Rename category</DialogTitle>
                <DialogDescription>
                  Products in “{pending.category.name}” keep their category under the new name.
                </DialogDescription>
                <div>
                  <Label htmlFor="rename-category" className="text-[13px]">
                    Name
                  </Label>
                  <Input
                    id="rename-category"
                    value={newName}
                    maxLength={NAME_MAX}
                    autoComplete="off"
                    onChange={(event) => setNewName(event.target.value)}
                    className="min-h-[46px] bg-bg text-[15px]"
                  />
                </div>
                {dialogError && <Alert variant="danger">{dialogError}</Alert>}
                <DialogActions>
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
                    {busy ? 'Saving…' : 'Rename'}
                  </Button>
                </DialogActions>
              </form>
            ) : (
              <>
                <DialogTitle>
                  {pending.category.active ? 'Deactivate' : 'Reactivate'} “{pending.category.name}”?
                </DialogTitle>
                <DialogDescription>
                  {pending.category.active
                    ? 'It stays on the products that already use it and in their history, but it can no longer be chosen for a new product.'
                    : 'It can be chosen for products again.'}
                </DialogDescription>
                {dialogError && <Alert variant="danger">{dialogError}</Alert>}
                <DialogActions>
                  <DialogClose asChild>
                    <Button variant="secondary" className="min-h-[46px] px-[18px]" disabled={busy}>
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button
                    className="min-h-[46px] px-[22px]"
                    disabled={busy}
                    onClick={() => void confirm()}
                  >
                    {busy ? 'Saving…' : pending.category.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </DialogActions>
              </>
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
