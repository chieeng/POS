import {
  Inbox,
  LayoutDashboard,
  Package,
  PackagePlus,
  Send,
  Settings,
  ShoppingCart,
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
  | 'stockIn'
  | 'customers'
  | 'drawer'
  | 'requests'
  | 'attendance'
  | 'payroll'
  | 'reports'
  | 'settings';

export interface NavItem {
  key: NavKey;
  to: string;
  label: string;
  short: string;
  icon: LucideIcon;
  /** A count shown on the item, for example pending approvals. */
  badge?: number;
}

/**
 * The design's sidebar order per role. Products and Stock-in stand in for its single
 * Inventory item until the Inventory screens are restyled. Sales keeps Products because
 * SRS 6.1 lets Sales view products and stock.
 */
export const NAV_ORDER: Record<Role, readonly NavKey[]> = {
  owner: [
    'home',
    'sell',
    'sales',
    'approvals',
    'products',
    'stockIn',
    'customers',
    'drawer',
    'attendance',
    'payroll',
    'reports',
    'settings',
  ],
  special_sales: [
    'sell',
    'sales',
    'products',
    'stockIn',
    'customers',
    'drawer',
    'requests',
    'attendance',
    'payroll',
  ],
  sales: ['sell', 'sales', 'products', 'customers', 'drawer', 'requests', 'attendance', 'payroll'],
};

/** The four most-used items the design keeps in the phone's bottom bar, in its order. */
export const PHONE_PRIORITY: Record<Role, readonly NavKey[]> = {
  owner: ['home', 'sell', 'approvals', 'products'],
  special_sales: ['sell', 'products', 'sales', 'customers'],
  sales: ['sell', 'sales', 'customers', 'drawer'],
};

/** The phone bar holds five places; past that it shows four and a More tab. */
const PHONE_SLOTS = 5;

/** Only screens that exist are listed; more arrive with each build step. */
export function navItems(role: Role, pending: number): NavItem[] {
  const built: Partial<Record<NavKey, Omit<NavItem, 'key'>>> = {
    home: { to: ROLE_HOME.owner, label: 'Dashboard', short: 'Home', icon: LayoutDashboard },
    sell: { to: ROLE_HOME[role], label: 'Sell', short: 'Sell', icon: ShoppingCart },
    approvals: {
      to: '/approvals',
      label: 'Approvals',
      short: 'Approvals',
      icon: Inbox,
      badge: pending,
    },
    products: { to: '/products', label: 'Products', short: 'Products', icon: Package },
    stockIn: { to: '/stock-in', label: 'Stock-in', short: 'Stock-in', icon: PackagePlus },
    requests: {
      to: '/requests',
      label: 'My requests',
      short: 'Requests',
      icon: Send,
      badge: pending,
    },
    settings: { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings },
  };
  const available: Record<Role, readonly NavKey[]> = {
    owner: ['home', 'approvals', 'products', 'stockIn', 'settings'],
    special_sales: ['sell', 'products', 'stockIn', 'requests'],
    sales: ['sell', 'products'],
  };
  return NAV_ORDER[role]
    .filter((key) => available[role].includes(key) && built[key])
    .map((key) => ({ key, ...built[key]! }));
}

/**
 * Splits a role's items between the phone's bottom bar and its More sheet. Up to five
 * items all fit. Past that the bar keeps the role's four priority items (any that aren't
 * built yet give their place to the next item in sidebar order) and the rest go to More.
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
export function isAtItem(pathname: string, item: Pick<NavItem, 'to'>): boolean {
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
