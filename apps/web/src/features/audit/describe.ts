import {
  KeyRound,
  LockKeyhole,
  LogIn,
  LogOut,
  ScrollText,
  ShieldCheck,
  ShieldPlus,
  Store,
  UserPen,
  UserPlus,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { ROLE_LABELS, type Role } from '@/features/auth/roles';
import type { AuditRecord } from '@/features/users/data';

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
const MONEY_KEYS = new Set(['late_penalty', 'sales_discount_limit']);

const peso = (amount: number) =>
  `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A settings value as the Owner would say it. */
function settingText(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key.endsWith('_clock_in') && typeof value === 'string') return clockTime(value);
  if (key === 'late_deduction' && typeof value === 'string')
    return LATE_DEDUCTION_LABELS[value] ?? value;
  if (key === 'afternoon_day_credit') return Number(value) === 1 ? 'Full day' : 'Half day';
  if (MONEY_KEYS.has(key) && Number.isFinite(Number(value))) return peso(Number(value));
  return text(value);
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
