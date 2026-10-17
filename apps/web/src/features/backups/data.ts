import { useLiveRows } from '@/hooks/useLiveRows';
import { supabase } from '@/lib/supabase';

/**
 * SYS-04: a backup is overdue when the last manual one is older than this. The developer who
 * maintains the system makes them; heartbeat.yml emails them on the same rule.
 */
export const REMIND_AFTER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupRecord {
  id: string;
  createdAt: Date;
  /** manual: made by the developer and saved offline. nightly: kept on GitHub only. */
  kind: 'manual' | 'nightly';
}

type Row = Record<string, unknown>;

const toBackup = (row: Row): BackupRecord => ({
  id: String(row.id ?? ''),
  createdAt: new Date(String(row.created_at)),
  kind: row.kind === 'nightly' ? 'nightly' : 'manual',
});

/** The latest backups, newest first. Row Level Security shows them to an Owner only. */
export function useBackups(count = 20) {
  return useLiveRows({
    table: 'backup_log',
    queryKey: String(count),
    load: () =>
      supabase
        .from('backup_log')
        .select('id, created_at, kind')
        .order('created_at', { ascending: false })
        .limit(count),
    map: toBackup,
  });
}

export interface BackupStatus {
  lastManual: BackupRecord | null;
  lastNightly: BackupRecord | null;
  /** Whole days since the last manual backup; null if there has never been one. */
  manualDaysAgo: number | null;
  /** No manual backup yet, or the last one is older than REMIND_AFTER_DAYS. */
  overdue: boolean;
}

/**
 * Only manual backups count: they are the ones the developer saves offline. A nightly file
 * stays on GitHub for 7 days and is then gone.
 */
export function backupStatus(backups: BackupRecord[], now: Date = new Date()): BackupStatus {
  const newest = (kind: BackupRecord['kind']) =>
    backups
      .filter((backup) => backup.kind === kind)
      .reduce<BackupRecord | null>(
        (latest, backup) => (!latest || backup.createdAt > latest.createdAt ? backup : latest),
        null,
      );
  const lastManual = newest('manual');
  const ageMs = lastManual ? now.getTime() - lastManual.createdAt.getTime() : null;
  return {
    lastManual,
    lastNightly: newest('nightly'),
    manualDaysAgo: ageMs === null ? null : Math.max(0, Math.floor(ageMs / DAY_MS)),
    overdue: ageMs === null || ageMs > REMIND_AFTER_DAYS * DAY_MS,
  };
}

/** "today", "yesterday", "9 days ago". */
export function describeDaysAgo(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export const formatBackupTime = (when: Date) =>
  when.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
