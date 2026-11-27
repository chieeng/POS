import {
  CalendarCheck,
  Inbox,
  LayoutDashboard,
  Package,
  ReceiptText,
  Send,
  Settings,
  ShoppingCart,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { ROLE_HOME, type Role } from '@/features/auth/roles';

/** Every destination in the design's Nav, built or not. */
export type NavKey =
  | 'home'
  | 'sell'
  | 'sales'
  | 'approvals'
  | 'products'
  | 'customers'
  | 'drawer'
  | 'requests'
  | 'attendance'
  | 'payroll'
  | 'reports'
  | 'settings';

/** The laptop sidebar's headings (SRS 7.2, round 3). Items without one sit at the top. */
export type NavGroup = 'Money' | 'Stock' | 'People' | 'Mine';

export interface NavItem {
  key: NavKey;
  to: string;
  label: string;
  short: string;
  icon: LucideIcon;
  /** A count shown on the item, for example pending approvals. */
  badge?: number;
  /** The sidebar heading the item sits under. */
  group?: NavGroup;
  /** Other pages that belong to this item (Stock-in under Products & stock-in). */
  also?: readonly string[];
}

/**
 * The sidebar order per role (round 3, approved Nov 27, 2026): the daily items first, then
 * the Money, Stock, People and Mine groups; the Owner's Settings sits at the bottom. Products
 * and Stock-in are one item, "Products & stock-in". Sales keeps Products because SRS 6.1 lets
 * Sales view products and stock.
 */
export const NAV_ORDER: Record<Role, readonly NavKey[]> = {
  owner: [
    'home',
    'sell',
    'approvals',
    'sales',
    'drawer',
    'customers',
    'reports',
    'products',
    'attendance',
    'payroll',
    'settings',
  ],
  special_sales: [
    'sell',
    'sales',
    'drawer',
    'attendance',
    'customers',
    'products',
    'requests',
    'payroll',
  ],
  sales: ['sell', 'sales', 'drawer', 'attendance', 'customers', 'products', 'requests', 'payroll'],
};

const GROUPS: Record<Role, Partial<Record<NavKey, NavGroup>>> = {
  owner: {
    sales: 'Money',
    drawer: 'Money',
    customers: 'Money',
    reports: 'Money',
    products: 'Stock',
    attendance: 'People',
    payroll: 'People',
  },
  special_sales: { products: 'Stock', requests: 'Mine', payroll: 'Mine' },
  sales: { products: 'Stock', requests: 'Mine', payroll: 'Mine' },
};

/**
 * The four items the phone's bottom bar keeps, in order (the owner's answers, Nov 27, 2026):
 * the Owner has Attendance where Products was; staff have their daily four.
 */
export const PHONE_PRIORITY: Record<Role, readonly NavKey[]> = {
  owner: ['home', 'sell', 'approvals', 'attendance'],
  special_sales: ['sell', 'sales', 'drawer', 'attendance'],
  sales: ['sell', 'sales', 'drawer', 'attendance'],
};

/** The phone bar holds five places; past that it shows four and a More tab. */
const PHONE_SLOTS = 5;

/** Only screens that exist are listed; more arrive with each build step. */
export function navItems(role: Role, pending: number): NavItem[] {
  // INV-02: the Owner and Special Sales also stock in, so their item names both.
  const stocksIn = role === 'owner' || role === 'special_sales';
  const built: Partial<Record<NavKey, Omit<NavItem, 'key'>>> = {
    home: { to: ROLE_HOME.owner, label: 'Dashboard', short: 'Dashboard', icon: LayoutDashboard },
    sell: { to: '/sell', label: 'Sell', short: 'Sell', icon: ShoppingCart },
    // Staff see their own sales of the last 30 days; the Owner sees everyone's.
    sales: {
      to: '/sales',
      label: role === 'owner' ? 'Sales history' : 'My sales',
      short: 'Sales',
      icon: ReceiptText,
    },
    approvals: {
      to: '/approvals',
      label: 'Approvals',
      short: 'Approvals',
      icon: Inbox,
      badge: pending,
    },
    products: stocksIn
      ? {
          to: '/products',
          label: 'Products & stock-in',
          short: 'Stock',
          icon: Package,
          also: ['/stock-in'],
        }
      : { to: '/products', label: 'Products', short: 'Products', icon: Package },
    attendance: {
      to: '/attendance',
      label: role === 'owner' ? 'Attendance' : 'My attendance',
      short: 'Attendance',
      icon: CalendarCheck,
    },
    requests: {
      to: '/requests',
      label: 'My requests',
      short: 'Requests',
      icon: Send,
      badge: pending,
    },
    drawer: { to: '/drawer', label: 'Cash drawer', short: 'Drawer', icon: Wallet },
    settings: { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings },
  };
  const available: Record<Role, readonly NavKey[]> = {
    owner: ['home', 'sell', 'approvals', 'sales', 'drawer', 'products', 'attendance', 'settings'],
    special_sales: ['sell', 'sales', 'drawer', 'attendance', 'products', 'requests'],
    sales: ['sell', 'sales', 'drawer', 'attendance', 'products', 'requests'],
  };
  return NAV_ORDER[role]
    .filter((key) => available[role].includes(key) && built[key])
    .map((key) => {
      const group = GROUPS[role][key];
      return { key, ...built[key]!, ...(group ? { group } : {}) };
    });
}

/**
 * Splits a role's items between the phone's bottom bar and its More sheet. Up to five
 * items all fit. Past that the bar keeps the role's four priority items (any that aren't
 * built yet give their place to the next item in sidebar order) and the rest go to More,
 * whose tab shows their counts (My requests).
 */
export function phoneNav(
  role: Role,
  items: readonly NavItem[],
): { bar: NavItem[]; more: NavItem[] } {
  if (items.length <= PHONE_SLOTS) return { bar: [...items], more: [] };
  const byKey = new Map(items.map((item) => [item.key, item]));
  const bar = PHONE_PRIORITY[role].flatMap((key) => byKey.get(key) ?? []);
  for (const item of items) {
    if (bar.length >= PHONE_SLOTS - 1) break;
    if (!bar.includes(item)) bar.push(item);
  }
  return { bar, more: items.filter((item) => !bar.includes(item)) };
}

/** Whether a path is an item's page or one below it, as NavLink matches. */
export function isAtItem(pathname: string, item: Pick<NavItem, 'to' | 'also'>): boolean {
  return [item.to, ...(item.also ?? [])].some(
    (to) => pathname === to || pathname.startsWith(`${to}/`),
  );
}
