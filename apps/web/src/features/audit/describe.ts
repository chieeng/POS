import {
  ClipboardCheck,
  FileDown,
  KeyRound,
  LockKeyhole,
  LogIn,
  LogOut,
  ScrollText,
  ShieldCheck,
  Package,
  PackagePlus,
  ShieldPlus,
  Tags,
  Truck,
  Store,
  UserPen,
  UserPlus,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { ROLE_LABELS, type Role } from '@/features/auth/roles';
import type { AuditRecord } from '@/features/users/data';
import { formatPeso } from '@/lib/money';

export interface AuditLine {
  icon: LucideIcon;
  /** Reads after the actor's name: "<Rosario> added Jun Reyes". */
  what: string;
  change: string;
}

export const ACTION_LABELS: Record<string, string> = {
  'auth.signIn': 'Sign-ins',
  'auth.passwordSet': 'Passwords set',
  'auth.twoStepOn': 'Two-step sign-in turned on',
  'user.create': 'Users added',
  'user.update': 'User edits',
  'user.setRole': 'Role changes',
  'user.deactivate': 'Deactivations',
  'user.signOutEverywhere': 'Sign-outs of all devices',
  'user.passwordResetLink': 'Password reset links',
  'branch.update': 'Store settings changes',
  'category.create': 'Categories added',
  'category.update': 'Category changes',
  'supplier.create': 'Suppliers added',
  'supplier.update': 'Supplier changes',
  'product.create': 'Products added',
  'product.update': 'Product changes',
  'products.export': 'Product list exports',
  'stock.in': 'Stock-ins',
  'stock.adjust': 'Stock adjustments',
  'stock.correct': 'Stock-in corrections',
  'approval.request': 'Change requests',
  'approval.withdraw': 'Requests withdrawn',
  'approval.approve': 'Requests approved',
  'approval.reject': 'Requests rejected',
};

const FIELD_LABELS: Record<string, string> = {
  displayName: 'Name',
  userCode: 'Code',
  name: 'Store name',
  address: 'Address',
  contact: 'Contact',
  tin: 'TIN',
  receipt_footer: 'Receipt footer',
  sales_discount_limit: 'Discount limit',
  idle_lock_minutes: 'Lock after (min)',
  store_lat: 'Latitude',
  store_lng: 'Longitude',
  radius_m: 'Radius (m)',
  morning_clock_in: 'Morning clock-in',
  afternoon_clock_in: 'Afternoon clock-in',
  grace_minutes: 'Grace (min)',
  late_deduction: 'Late deduction',
  late_penalty: 'Flat amount',
  paid_minutes_per_day: 'Paid minutes per day',
  afternoon_day_credit: 'Afternoon-start day',
  owner_clocks_in: 'Owner clocks in',
};

const CATALOG_LABELS: Record<string, string> = {
  name: 'Name',
  contact_person: 'Contact person',
  phone: 'Phone',
  address: 'Address',
};

const PRODUCT_LABELS: Record<string, string> = {
  sku: 'SKU',
  name: 'Name',
  unit: 'Unit',
  sell_price: 'Price',
  reorder_level: 'Reorder level',
};

const ADJUSTMENT_WORDS: Record<string, string> = {
  damage: 'Damage',
  loss: 'Loss',
  expiry: 'Expiry',
  found: 'Found',
  store_use: 'Store use',
  other: 'Other',
};

/** "1 line", "2 lines". */
function plural(value: unknown, word: string): string {
  const count = Number(value);
  return `${text(value)} ${count === 1 ? word : `${word}s`}`;
}

const LATE_DEDUCTION_LABELS: Record<string, string> = {
  none: 'None',
  minutes: 'Minutes late',
  flat: 'Flat amount',
};

/** "06:00:00" as "6:00 AM". */
function clockTime(value: string): string {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

// Amounts in pesos: shown as "₱25.50", not "25.5" as the database sends them.
const MONEY_KEYS = new Set(['late_penalty', 'sales_discount_limit', 'sell_price']);

/** A settings value as the Owner would say it. */
function settingText(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key.endsWith('_clock_in') && typeof value === 'string') return clockTime(value);
  if (key === 'late_deduction' && typeof value === 'string')
    return LATE_DEDUCTION_LABELS[value] ?? value;
  if (key === 'afternoon_day_credit') return Number(value) === 1 ? 'Full day' : 'Half day';
  if (MONEY_KEYS.has(key) && Number.isFinite(Number(value))) return formatPeso(Number(value));
  return text(value);
}

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};

/** "Expiry −2 pack". */
function adjustmentText(type: unknown, qty: unknown, unit: unknown): string {
  const count = Number(qty);
  const sign = count > 0 ? '+' : '−';
  return `${ADJUSTMENT_WORDS[String(type)] ?? text(type)} ${sign}${Math.abs(count)}${unit ? ` ${text(unit)}` : ''}`;
}

interface LineValue {
  name: string;
  qty: number;
  cost: number;
}

/**
 * A stock-in correction in plain words: "Soda 1 L: 12 → 10", "Chips Classic: ₱34.00 → ₱32.00",
 * "Water 500 ml: 5 @ ₱8.00 → 6 @ ₱9.00", "Supplier: ABC Trading → XYZ Foods". `before` holds
 * the stock-in as recorded ({supplier_id, reference, lines: [{product_id, qty, unit_cost,
 * name?}]}); `wanted` the lines as corrected, as an array or keyed by product id.
 */
function correctionChanges(
  before: Json,
  after: { supplierId: unknown; reference: unknown; lines: unknown; deleted: boolean },
  names: Json,
  products: Json,
): string[] {
  const nameOf = (id: unknown) => text(names[String(id)] ?? (id ? 'Unknown' : '—'));
  const wanted = new Map<string, Json>();
  if (Array.isArray(after.lines)) {
    for (const line of after.lines) wanted.set(String(asObject(line).product_id), asObject(line));
  } else {
    for (const [id, line] of Object.entries(asObject(after.lines))) wanted.set(id, asObject(line));
  }
  const lines = (Array.isArray(before.lines) ? before.lines : []).map((raw) => {
    const line = asObject(raw);
    const id = String(line.product_id);
    const old: LineValue = {
      name: text(line.name ?? asObject(products[id]).name ?? 'Product'),
      qty: Number(line.qty),
      cost: Number(line.unit_cost),
    };
    const next = wanted.get(id);
    const qty = after.deleted ? 0 : Number(next?.qty ?? old.qty);
    const cost = Number(next?.unit_cost ?? old.cost);
    if (qty === old.qty && cost === old.cost) return '';
    if (cost === old.cost || qty === 0) return `${old.name}: ${old.qty} → ${qty}`;
    if (qty === old.qty) return `${old.name}: ${formatPeso(old.cost)} → ${formatPeso(cost)}`;
    return `${old.name}: ${old.qty} @ ${formatPeso(old.cost)} → ${qty} @ ${formatPeso(cost)}`;
  });
  if (after.deleted) return lines.filter(Boolean);
  return [
    ...(before.supplier_id !== after.supplierId
      ? [`Supplier: ${nameOf(before.supplier_id)} → ${nameOf(after.supplierId)}`]
      : []),
    ...((before.reference ?? null) !== (after.reference ?? null)
      ? [`Reference: ${text(before.reference)} → ${text(after.reference)}`]
      : []),
    ...lines.filter(Boolean),
  ];
}

/** A photo change in plain words (the keys themselves mean nothing to a person). */
function photoText(old: unknown, next: unknown): string {
  if (typeof next !== 'string') return 'Remove the photo';
  return typeof old === 'string' ? 'Replace the photo' : 'Add a photo';
}

/** What a request asks for, in plain words. */
function requestChanges(after: Json): string[] {
  const changes = asObject(after.changes);
  const before = asObject(after.before);
  const names = asObject(after.names);
  switch (after.type) {
    case 'stock_adjustment':
      return [adjustmentText(changes.type, changes.qty, after.unit)];
    case 'stock_in_correction':
      if (changes.delete === true) return ['Delete the stock-in'];
      return correctionChanges(
        before,
        {
          supplierId: changes.supplier_id,
          reference: changes.reference,
          lines: changes.lines,
          deleted: false,
        },
        names,
        asObject(after.products),
      );
    default:
      return Object.keys(changes).map((key) => {
        if (key === 'active') return changes.active === false ? 'Deactivate' : 'Reactivate';
        if (key === 'photo_key') return photoText(before.photo_key, changes.photo_key);
        if (key === 'category_id')
          return key in before
            ? `Category: ${text(names[String(before.category_id)])} → ${text(names[String(changes.category_id)])}`
            : 'Category';
        const label = PRODUCT_LABELS[key] ?? key;
        return key in before
          ? `${label}: ${settingText(key, before[key])} → ${settingText(key, changes[key])}`
          : `${label}: ${settingText(key, changes[key])}`;
      });
  }
}

function roleLabel(value: unknown): string {
  return typeof value === 'string' && value in ROLE_LABELS ? ROLE_LABELS[value as Role] : '—';
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
}

/** Turns an auditLogs entry (SYS-03) into a readable line. `target` is the affected user. */
export function describeAudit(entry: AuditRecord, target: string): AuditLine {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  switch (entry.action) {
    case 'auth.signIn':
      return { icon: LogIn, what: 'signed in', change: '' };
    case 'auth.passwordSet':
      return { icon: LockKeyhole, what: 'set their password', change: '' };
    case 'auth.twoStepOn':
      return { icon: ShieldPlus, what: 'turned on two-step sign-in', change: '' };
    case 'user.create':
      return { icon: UserPlus, what: `added ${target}`, change: roleLabel(after.role) };
    case 'user.update':
      return {
        icon: UserPen,
        what: `edited ${target}`,
        change: Object.keys(after)
          .map((key) => `${FIELD_LABELS[key] ?? key}: ${text(before[key])} → ${text(after[key])}`)
          .join(' · '),
      };
    case 'user.setRole':
      return {
        icon: ShieldCheck,
        what: `changed the role of ${target}`,
        change: `${roleLabel(before.role)} → ${roleLabel(after.role)}`,
      };
    case 'branch.update':
      return {
        icon: Store,
        what: 'changed store settings',
        change: Object.keys(after)
          .map(
            (key) =>
              `${FIELD_LABELS[key] ?? key}: ${settingText(key, before[key])} → ${settingText(key, after[key])}`,
          )
          .join(' · '),
      };
    case 'stock.in': {
      const reference = typeof after.reference === 'string' ? ` “${after.reference}”` : '';
      const supplier = typeof after.supplier === 'string' ? ` from ${after.supplier}` : '';
      return {
        icon: PackagePlus,
        what: `recorded a stock-in${reference}${supplier}`,
        change: `${plural(after.lines, 'line')} · ${plural(after.units, 'unit')} · ${settingText('sell_price', after.value)}`,
      };
    }
    case 'stock.adjust':
      return {
        icon: PackagePlus,
        what:
          `adjusted the stock of “${text(after.label)}”` +
          (after.via === 'approval' ? ' (approved request)' : ''),
        change: `${adjustmentText(after.type, after.qty, after.unit)} · now ${text(after.stock_after)}${entry.reason ? ` · ${entry.reason}` : ''}`,
      };
    case 'stock.correct': {
      const reference = typeof before.reference === 'string' ? ` “${before.reference}”` : '';
      const deleted = after.deleted === true;
      return {
        icon: PackagePlus,
        what:
          `${deleted ? 'deleted' : 'corrected'} the stock-in${reference}` +
          (after.via === 'approval' ? ' (approved request)' : ''),
        change: [
          ...correctionChanges(
            before,
            {
              supplierId: after.supplier_id,
              reference: after.reference,
              lines: after.lines,
              deleted,
            },
            asObject(after.names),
            {},
          ),
          entry.reason,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    }
    case 'approval.request':
    case 'approval.withdraw':
    case 'approval.approve':
    case 'approval.reject': {
      const product = `“${text(after.label)}”`;
      const what = {
        'approval.request': `requested a change to ${product}`,
        'approval.withdraw': `withdrew a request for ${product}`,
        'approval.approve': `approved a request for ${product}`,
        'approval.reject': `rejected a request for ${product}`,
      }[entry.action];
      return {
        icon: ClipboardCheck,
        what,
        change: [...requestChanges(after), entry.reason].filter(Boolean).join(' · '),
      };
    }
    case 'product.create':
      return {
        icon: Package,
        what: `added product “${text(after.name)}” (${text(after.sku)})`,
        change: `${settingText('sell_price', after.sell_price)} / ${text(after.unit)}`,
      };
    case 'product.update': {
      const fields = Object.keys(after).filter((key) => key !== 'active');
      const status =
        after.active === false ? 'Deactivated' : after.active === true ? 'Reactivated' : '';
      return {
        icon: Package,
        what:
          (status && fields.length === 0
            ? `${status.toLowerCase()} product “${text(before.label)}”`
            : `changed product “${text(before.label)}”`) +
          (before.via === 'approval' ? ' (approved request)' : ''),
        change: [
          ...fields.map((key) =>
            key === 'category_id'
              ? 'Category changed'
              : key === 'photo_key'
                ? ({ 'Remove the photo': 'Photo removed', 'Replace the photo': 'Photo replaced' }[
                    photoText(before.photo_key, after.photo_key)
                  ] ?? 'Photo added')
                : `${PRODUCT_LABELS[key] ?? key}: ${settingText(key, before[key])} → ${settingText(key, after[key])}`,
          ),
          ...(status && fields.length > 0 ? [status] : []),
        ].join(' · '),
      };
    }
    case 'products.export':
      return {
        icon: FileDown,
        what: 'exported the product list (CSV)',
        change: plural(after.rows, 'product'),
      };
    case 'category.create':
      return { icon: Tags, what: `added category “${text(after.name)}”`, change: '' };
    case 'supplier.create':
      return { icon: Truck, what: `added supplier “${text(after.name)}”`, change: '' };
    case 'category.update':
    case 'supplier.update': {
      const kind = entry.action === 'category.update' ? 'category' : 'supplier';
      const label = text(before.label ?? after.name);
      const fields = Object.keys(after).filter((key) => key !== 'active');
      const status =
        after.active === false ? 'deactivated' : after.active === true ? 'reactivated' : '';
      return {
        icon: kind === 'category' ? Tags : Truck,
        what:
          status && fields.length === 0
            ? `${status} ${kind} “${label}”`
            : `changed ${kind} “${label}”`,
        change: [
          ...fields.map(
            (key) => `${CATALOG_LABELS[key] ?? key}: ${text(before[key])} → ${text(after[key])}`,
          ),
          ...(status && fields.length > 0
            ? [status === 'deactivated' ? 'Deactivated' : 'Reactivated']
            : []),
        ].join(' · '),
      };
    }
    case 'user.deactivate':
      return { icon: UserX, what: `deactivated ${target}`, change: entry.reason ?? '' };
    case 'user.signOutEverywhere':
      return { icon: LogOut, what: `signed ${target} out of all devices`, change: '' };
    case 'user.passwordResetLink':
      return { icon: KeyRound, what: `made a password reset link for ${target}`, change: '' };
    default:
      return { icon: ScrollText, what: entry.action, change: '' };
  }
}
