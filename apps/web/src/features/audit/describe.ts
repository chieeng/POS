import {
  KeyRound,
  LogIn,
  LogOut,
  ScrollText,
  ShieldCheck,
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
  'user.create': 'Users added',
  'user.update': 'User edits',
  'user.setRole': 'Role changes',
  'user.deactivate': 'Deactivations',
  'user.signOutEverywhere': 'Sign-outs of all devices',
  'user.passwordResetLink': 'Password reset links',
};

const FIELD_LABELS: Record<string, string> = { displayName: 'Name', userCode: 'Code' };

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
