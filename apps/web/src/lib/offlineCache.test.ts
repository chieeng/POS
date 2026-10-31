import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearOfflineCache, listCache } from './offlineCache';

const maria = { uid: 'u1', branchId: 'main' };
const jun = { uid: 'u2', branchId: 'main' };

beforeEach(async () => {
  await clearOfflineCache();
});

describe('the product list saved on this device', () => {
  it('keeps the list, its changes and when it was saved', async () => {
    const cache = listCache<{ id: string; name: string }>('products', maria);
    expect(await cache.read()).toBeNull();

    await cache.replace([
      { id: 'p1', name: 'Chips' },
      { id: 'p2', name: 'Water' },
    ]);
    await cache.put({ id: 'p2', name: 'Water 500 ml' });
    await cache.put({ id: 'p3', name: 'Bread' });
    await cache.remove('p1');

    const saved = await cache.read();
    expect(saved?.items.map((item) => item.name).sort()).toEqual(['Bread', 'Water 500 ml']);
    expect(saved?.savedAt).toBeInstanceOf(Date);
  });

  it("never shows one user's copy to another", async () => {
    await listCache('products', maria).replace([{ id: 'p1' }]);
    expect(await listCache('products', jun).read()).toBeNull();
    expect(await listCache('products', { ...maria, branchId: 'other' }).read()).toBeNull();
  });

  it('is gone after sign-out', async () => {
    await listCache('products', maria).replace([{ id: 'p1' }]);
    await listCache('categories', maria).replace([{ id: 'c1' }]);
    await clearOfflineCache();
    expect(await listCache('products', maria).read()).toBeNull();
    expect(await listCache('categories', maria).read()).toBeNull();
  });
});
