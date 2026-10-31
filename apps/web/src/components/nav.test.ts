import { describe, expect, it } from 'vitest';
import { ShoppingCart } from 'lucide-react';
import { isAtItem, NAV_ORDER, navItems, phoneNav, type NavItem, type NavKey } from './nav';

const keys = (items: readonly NavItem[]) => items.map((item) => item.key);

/** A role's full design list, as if every screen were built. */
function allBuilt(order: readonly NavKey[]): NavItem[] {
  return order.map((key) => ({ key, to: `/${key}`, label: key, short: key, icon: ShoppingCart }));
}

describe('navItems', () => {
  it('lists only built screens, in the design order', () => {
    expect(keys(navItems('owner', 0))).toEqual([
      'home',
      'approvals',
      'products',
      'stockIn',
      'drawer',
      'settings',
    ]);
    expect(keys(navItems('special_sales', 0))).toEqual([
      'sell',
      'products',
      'stockIn',
      'drawer',
      'requests',
    ]);
    // SRS 6.1: Sales can view products and stock levels.
    expect(keys(navItems('sales', 0))).toEqual(['sell', 'products', 'drawer']);
  });

  it('puts the pending count on Approvals and My requests', () => {
    expect(navItems('owner', 3).find((i) => i.key === 'approvals')?.badge).toBe(3);
    expect(navItems('special_sales', 2).find((i) => i.key === 'requests')?.badge).toBe(2);
  });
});

describe('phoneNav', () => {
  it('shows every item and no More while five fit', () => {
    // The Owner has six with the drawer: see the next tests.
    for (const role of ['special_sales', 'sales'] as const) {
      const items = navItems(role, 0);
      expect(phoneNav(role, items)).toEqual({ bar: items, more: [] });
    }
  });

  it('keeps the design priority four plus More past five items', () => {
    const owner = phoneNav('owner', allBuilt(NAV_ORDER.owner));
    expect(keys(owner.bar)).toEqual(['home', 'sell', 'approvals', 'products']);
    expect(keys(owner.more)).toEqual([
      'sales',
      'stockIn',
      'customers',
      'drawer',
      'attendance',
      'payroll',
      'reports',
      'settings',
    ]);

    const special = phoneNav('special_sales', allBuilt(NAV_ORDER.special_sales));
    expect(keys(special.bar)).toEqual(['sell', 'products', 'sales', 'customers']);
    expect(keys(special.more)).toEqual(['stockIn', 'drawer', 'requests', 'attendance', 'payroll']);

    const sales = phoneNav('sales', allBuilt(NAV_ORDER.sales));
    expect(keys(sales.bar)).toEqual(['sell', 'sales', 'customers', 'drawer']);
    expect(keys(sales.more)).toEqual(['products', 'requests', 'attendance', 'payroll']);
  });

  it('fills a priority slot that is not built with the next item in order', () => {
    // Owner with six screens and no Sell yet.
    const items = allBuilt(['home', 'approvals', 'products', 'stockIn', 'drawer', 'settings']);
    const { bar, more } = phoneNav('owner', items);
    expect(keys(bar)).toEqual(['home', 'approvals', 'products', 'stockIn']);
    expect(keys(more)).toEqual(['drawer', 'settings']);
  });
});

describe('isAtItem', () => {
  it('matches the item page and pages below it', () => {
    expect(isAtItem('/settings', { to: '/settings' })).toBe(true);
    expect(isAtItem('/settings/users', { to: '/settings' })).toBe(true);
    expect(isAtItem('/settings-old', { to: '/settings' })).toBe(false);
  });
});
