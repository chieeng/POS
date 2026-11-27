import { describe, expect, it } from 'vitest';
import { ShoppingCart } from 'lucide-react';
import { isAtItem, NAV_ORDER, navItems, phoneNav, type NavItem, type NavKey } from './nav';

const keys = (items: readonly NavItem[]) => items.map((item) => item.key);

/** A role's full design list, as if every screen were built. */
function allBuilt(order: readonly NavKey[]): NavItem[] {
  return order.map((key) => ({ key, to: `/${key}`, label: key, short: key, icon: ShoppingCart }));
}

describe('navItems', () => {
  it('lists only built screens, in the round 3 order', () => {
    expect(keys(navItems('owner', 0))).toEqual([
      'home',
      'sell',
      'approvals',
      'sales',
      'drawer',
      'products',
      'attendance',
      'settings',
    ]);
    expect(keys(navItems('special_sales', 0))).toEqual([
      'sell',
      'sales',
      'drawer',
      'attendance',
      'products',
      'requests',
    ]);
    // SRS 6.1: Sales can view products and stock levels.
    expect(keys(navItems('sales', 0))).toEqual([
      'sell',
      'sales',
      'drawer',
      'attendance',
      'products',
      'requests',
    ]);
  });

  it('groups the laptop sidebar under Money, Stock, People and Mine', () => {
    const groups = (role: 'owner' | 'special_sales') =>
      navItems(role, 0).map((item) => `${item.key}:${item.group ?? ''}`);
    expect(groups('owner')).toEqual([
      'home:',
      'sell:',
      'approvals:',
      'sales:Money',
      'drawer:Money',
      'products:Stock',
      'attendance:People',
      'settings:',
    ]);
    expect(groups('special_sales')).toEqual([
      'sell:',
      'sales:',
      'drawer:',
      'attendance:',
      'products:Stock',
      'requests:Mine',
    ]);
  });

  it('makes Products and Stock-in one item for those who stock in', () => {
    for (const role of ['owner', 'special_sales'] as const) {
      expect(navItems(role, 0).find((i) => i.key === 'products')).toMatchObject({
        to: '/products',
        label: 'Products & stock-in',
        also: ['/stock-in'],
      });
    }
    // INV-02: Sales doesn't stock in, so the item stays Products.
    const sales = navItems('sales', 0).find((i) => i.key === 'products');
    expect(sales?.label).toBe('Products');
    expect(sales?.also).toBeUndefined();
  });

  it('names sales history by role: everyone’s for the Owner, their own for staff', () => {
    expect(navItems('owner', 0).find((i) => i.key === 'sales')).toMatchObject({
      to: '/sales',
      label: 'Sales history',
    });
    expect(navItems('sales', 0).find((i) => i.key === 'sales')?.label).toBe('My sales');
    expect(navItems('special_sales', 0).find((i) => i.key === 'sales')?.label).toBe('My sales');
  });

  it('Sell is the same page for every role', () => {
    for (const role of ['owner', 'special_sales', 'sales'] as const) {
      expect(navItems(role, 0).find((i) => i.key === 'sell')?.to).toBe('/sell');
    }
  });

  it('puts the pending count on Approvals and My requests', () => {
    expect(navItems('owner', 3).find((i) => i.key === 'approvals')?.badge).toBe(3);
    expect(navItems('special_sales', 2).find((i) => i.key === 'requests')?.badge).toBe(2);
  });
});

describe('phoneNav', () => {
  it('keeps the owner’s four plus More (Nov 27, 2026)', () => {
    // Owner: Dashboard, Sell, Approvals, Attendance; the rest in More.
    const owner = phoneNav('owner', navItems('owner', 0));
    expect(keys(owner.bar)).toEqual(['home', 'sell', 'approvals', 'attendance']);
    expect(keys(owner.more)).toEqual(['sales', 'drawer', 'products', 'settings']);
    // Staff: Sell, Sales, Drawer, Attendance; Products & stock-in and My requests in More.
    for (const role of ['special_sales', 'sales'] as const) {
      const staff = phoneNav(role, navItems(role, 0));
      expect(keys(staff.bar)).toEqual(['sell', 'sales', 'drawer', 'attendance']);
      expect(keys(staff.more)).toEqual(['products', 'requests']);
    }
  });

  it('shows every item and no More while five fit', () => {
    const five = navItems('sales', 0).slice(0, 5);
    expect(phoneNav('sales', five)).toEqual({ bar: five, more: [] });
  });

  it('keeps the priority four plus More once every screen is built', () => {
    const owner = phoneNav('owner', allBuilt(NAV_ORDER.owner));
    expect(keys(owner.bar)).toEqual(['home', 'sell', 'approvals', 'attendance']);
    expect(keys(owner.more)).toEqual([
      'sales',
      'drawer',
      'customers',
      'reports',
      'products',
      'payroll',
      'settings',
    ]);

    const special = phoneNav('special_sales', allBuilt(NAV_ORDER.special_sales));
    expect(keys(special.bar)).toEqual(['sell', 'sales', 'drawer', 'attendance']);
    expect(keys(special.more)).toEqual(['customers', 'products', 'requests', 'payroll']);
  });

  it('fills a priority slot that is not built with the next item in order', () => {
    // An Owner with six screens and no Sell.
    const items = allBuilt(['home', 'approvals', 'sales', 'drawer', 'products', 'settings']);
    const { bar, more } = phoneNav('owner', items);
    expect(keys(bar)).toEqual(['home', 'approvals', 'sales', 'drawer']);
    expect(keys(more)).toEqual(['products', 'settings']);
  });
});

describe('isAtItem', () => {
  it('matches the item page and pages below it', () => {
    expect(isAtItem('/settings', { to: '/settings' })).toBe(true);
    expect(isAtItem('/settings/users', { to: '/settings' })).toBe(true);
    expect(isAtItem('/settings-old', { to: '/settings' })).toBe(false);
  });

  it('matches the other pages an item holds', () => {
    const item = { to: '/products', also: ['/stock-in'] };
    expect(isAtItem('/stock-in/new', item)).toBe(true);
    expect(isAtItem('/products/categories', item)).toBe(true);
    expect(isAtItem('/sell', item)).toBe(false);
  });
});
