import Dexie, { type Table } from 'dexie';

/** Which user and branch the saved lists belong to, and when they were last fresh. */
interface Owner {
  list: string;
  uid: string;
  branchId: string;
  savedAt: number;
}

interface Item {
  id: string;
}

/**
 * The device's copy of the lists a screen needs offline (NFR-01, NFR-02): the products and
 * the categories, as each screen shows them. It never holds cost or anything else the
 * user may not read, and it is cleared on sign-out (see `clearOfflineCache`).
 */
class OfflineDb extends Dexie {
  products!: Table<Item, string>;
  categories!: Table<Item, string>;
  owners!: Table<Owner, string>;

  constructor() {
    super('pos-offline');
    this.version(1).stores({ products: 'id', categories: 'id', owners: 'list' });
  }
}

let db: OfflineDb | null = null;

/** Null where the browser has no IndexedDB (or blocks it): the app then works online only. */
function open(): OfflineDb | null {
  if (typeof indexedDB === 'undefined') return null;
  db ??= new OfflineDb();
  return db;
}

export type CachedList = 'products' | 'categories';

export interface Who {
  uid: string;
  branchId: string;
}

export interface ListCache<T extends Item> {
  /** The saved list and when it was last fresh, or null if none was saved for this user. */
  read: () => Promise<{ items: T[]; savedAt: Date } | null>;
  replace: (items: T[]) => Promise<void>;
  put: (item: T) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** The saved copy of one list, for one signed-in user. Every failure is ignored. */
export function listCache<T extends Item>(list: CachedList, who: Who): ListCache<T> {
  const quietly = async <R>(work: (db: OfflineDb) => Promise<R>): Promise<R | null> => {
    const current = open();
    if (!current) return null;
    try {
      return await work(current);
    } catch {
      return null;
    }
  };
  const stamp = (db: OfflineDb) => db.owners.put({ list, ...who, savedAt: Date.now() });

  return {
    read: async () =>
      quietly(async (db) => {
        const owner = await db.owners.get(list);
        if (!owner || owner.uid !== who.uid || owner.branchId !== who.branchId) return null;
        const items = (await db.table(list).toArray()) as T[];
        return { items, savedAt: new Date(owner.savedAt) };
      }),
    replace: async (items) => {
      await quietly((db) =>
        db.transaction('rw', db.table(list), db.owners, async () => {
          await db.table(list).clear();
          await db.table(list).bulkPut(items);
          await stamp(db);
        }),
      );
    },
    put: async (item) => {
      await quietly((db) =>
        db.transaction('rw', db.table(list), db.owners, async () => {
          await db.table(list).put(item);
          await stamp(db);
        }),
      );
    },
    remove: async (id) => {
      await quietly((db) => db.table(list).delete(id));
    },
  };
}

/**
 * Forgets every saved list: on sign-out, deactivation and "sign out everywhere", so a phone
 * that changes hands keeps nothing of the store's (the Owner's decision, Oct 31, 2026).
 */
export async function clearOfflineCache(): Promise<void> {
  const current = open();
  if (!current) return;
  try {
    await current.transaction(
      'rw',
      current.products,
      current.categories,
      current.owners,
      async () => {
        await current.products.clear();
        await current.categories.clear();
        await current.owners.clear();
      },
    );
  } catch {
    // Nothing saved, or storage blocked.
  }
}
