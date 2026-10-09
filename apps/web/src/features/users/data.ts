import {
  collection,
  collectionGroup,
  limit,
  orderBy,
  query,
  where,
  type DocumentData,
  type Timestamp,
} from 'firebase/firestore';
import { useMemo } from 'react';
import type { Role } from '@/features/auth/roles';
import { useQuerySnapshot } from '@/hooks/useQuerySnapshot';
import { db } from '@/lib/firebase';

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

const toDate = (value: unknown): Date | null =>
  value && typeof (value as Timestamp).toDate === 'function' ? (value as Timestamp).toDate() : null;

const toUser = (uid: string, data: DocumentData): UserRecord => ({
  uid,
  displayName: String(data.displayName ?? ''),
  email: String(data.email ?? ''),
  role: data.role as Role,
  userCode: String(data.userCode ?? ''),
  active: data.active === true,
});

const toDevice = (_id: string, data: DocumentData): DeviceRecord => ({
  uid: String(data.uid ?? ''),
  deviceTag: String(data.deviceTag ?? ''),
  label: String(data.label ?? ''),
  lastSeenAt: toDate(data.lastSeenAt),
});

const toAudit = (id: string, data: DocumentData): AuditRecord => ({
  id,
  action: String(data.action ?? ''),
  actorId: String(data.actorId ?? ''),
  targetId: String(data.targetId ?? ''),
  deviceTag: typeof data.deviceTag === 'string' ? data.deviceTag : null,
  before: (data.before as Record<string, unknown> | undefined) ?? null,
  after: (data.after as Record<string, unknown> | undefined) ?? null,
  reason: typeof data.reason === 'string' ? data.reason : null,
  createdAt: toDate(data.createdAt),
});

// Each query mirrors a Security Rule: own branch only, with the limit the rule demands.

export function useUsers(branchId: string) {
  const q = useMemo(
    () => query(collection(db, 'users'), where('branchId', '==', branchId), limit(100)),
    [branchId],
  );
  return useQuerySnapshot(q, toUser);
}

export function useDevices(branchId: string) {
  const q = useMemo(
    () => query(collectionGroup(db, 'devices'), where('branchId', '==', branchId), limit(300)),
    [branchId],
  );
  return useQuerySnapshot(q, toDevice);
}

export const AUDIT_PAGE_SIZE = 100;
export const AUDIT_MAX = 200;

export function useAuditLogs(branchId: string, count: number) {
  const q = useMemo(
    () =>
      query(
        collection(db, 'auditLogs'),
        where('branchId', '==', branchId),
        orderBy('createdAt', 'desc'),
        limit(Math.min(count, AUDIT_MAX)),
      ),
    [branchId, count],
  );
  return useQuerySnapshot(q, toAudit);
}

/** "Active now", "12 min ago", "3 hr ago", "Yesterday", "Aug 30". */
export function describeLastSeen(when: Date | null, now: Date = new Date()): string {
  if (!when) return 'Never';
  const minutes = Math.floor((now.getTime() - when.getTime()) / 60_000);
  if (minutes < 5) return 'Active now';
  if (minutes < 60) return `${minutes} min ago`;
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
