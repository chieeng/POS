import type { Role } from '@/features/auth/roles';
import { useLiveRows } from '@/hooks/useLiveRows';
import { supabase } from '@/lib/supabase';

export interface UserRecord {
  uid: string;
  displayName: string;
  email: string;
  role: Role;
  userCode: string;
  active: boolean;
}

export interface DeviceRecord {
  uid: string;
  deviceTag: string;
  label: string;
  lastSeenAt: Date | null;
}

export interface AuditRecord {
  id: string;
  action: string;
  actorId: string;
  targetId: string;
  deviceTag: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAt: Date | null;
}

type Row = Record<string, unknown>;

const toDate = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const toUser = (row: Row): UserRecord => ({
  uid: String(row.id ?? ''),
  displayName: String(row.display_name ?? ''),
  email: String(row.email ?? ''),
  role: row.role as Role,
  userCode: String(row.user_code ?? ''),
  active: row.active === true,
});

const toDevice = (row: Row): DeviceRecord => ({
  uid: String(row.user_id ?? ''),
  deviceTag: String(row.device_tag ?? ''),
  label: String(row.label ?? ''),
  lastSeenAt: toDate(row.last_seen_at),
});

const toAudit = (row: Row): AuditRecord => ({
  id: String(row.id ?? ''),
  action: String(row.action ?? ''),
  actorId: String(row.actor_id ?? ''),
  targetId: String(row.target_id ?? ''),
  deviceTag: typeof row.device_tag === 'string' ? row.device_tag : null,
  before: toObject(row.before),
  after: toObject(row.after),
  reason: typeof row.reason === 'string' ? row.reason : null,
  createdAt: toDate(row.created_at),
});

// Each query asks only for what Row Level Security gives the Owner anyway: their own branch.

export function useUsers(branchId: string) {
  return useLiveRows({
    table: 'profiles',
    queryKey: branchId,
    load: () =>
      supabase
        .from('profiles')
        .select('id, display_name, email, role, user_code, active')
        .eq('branch_id', branchId)
        .limit(100),
    map: toUser,
  });
}

// `devices` has no branch column: the policy limits the Owner to the users of their branch.
export function useDevices(branchId: string) {
  return useLiveRows({
    table: 'devices',
    queryKey: branchId,
    load: () =>
      supabase.from('devices').select('user_id, device_tag, label, last_seen_at').limit(300),
    map: toDevice,
  });
}

export const AUDIT_PAGE_SIZE = 100;
export const AUDIT_MAX = 200;

export function useAuditLogs(branchId: string, count: number) {
  const size = Math.min(count, AUDIT_MAX);
  return useLiveRows({
    table: 'audit_logs',
    queryKey: `${branchId}:${size}`,
    load: () =>
      supabase
        .from('audit_logs')
        .select('id, action, actor_id, target_id, device_tag, before, after, reason, created_at')
        .eq('branch_id', branchId)
        .order('created_at', { ascending: false })
        .limit(size),
    map: toAudit,
  });
}

/**
 * "Active now", "12 min ago", "3 hr ago", "Yesterday", "Aug 30". A deactivated user is signed
 * out everywhere, so they are never "Active now", however recently they were seen.
 */
export function describeLastSeen(
  when: Date | null,
  { now = new Date(), active = true }: { now?: Date; active?: boolean } = {},
): string {
  if (!when) return 'Never';
  const minutes = Math.floor((now.getTime() - when.getTime()) / 60_000);
  if (minutes < 5 && active) return 'Active now';
  if (minutes < 60) return `${Math.max(minutes, 1)} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} hr ago`;
  if (minutes < 48 * 60) return 'Yesterday';
  return when.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

export function latestSeen(devices: DeviceRecord[]): Date | null {
  return devices.reduce<Date | null>(
    (latest, device) =>
      device.lastSeenAt && (!latest || device.lastSeenAt > latest) ? device.lastSeenAt : latest,
    null,
  );
}

export function sortUsers(users: UserRecord[]): UserRecord[] {
  return [...users].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      Number(b.role === 'owner') - Number(a.role === 'owner') ||
      a.displayName.localeCompare(b.displayName),
  );
}
