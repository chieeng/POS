import { useLiveRows } from '@/hooks/useLiveRows';
import { supabase } from '@/lib/supabase';

/** Where the Owner makes a backup (.github/workflows/backup.yml). The repository is public. */
export const BACKUP_WORKFLOW_URL = 'https://github.com/chieeng/POS/actions/workflows/backup.yml';
export const RESTORE_GUIDE_URL = 'https://github.com/chieeng/POS/blob/main/docs/RESTORE.md';

/** SYS-04: the Owner is reminded when the last manual backup is older than this. */
export const REMIND_AFTER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupRecord {
  id: string;
  createdAt: Date;
  /** manual: made by the Owner, to be saved offline. nightly: kept on GitHub only. */
  kind: 'manual' | 'nightly';
  fileName: string;
  sizeBytes: number;
  runUrl: string;
  expiresAt: Date;
}

type Row = Record<string, unknown>;

const toBackup = (row: Row): BackupRecord => ({
  id: String(row.id ?? ''),
  createdAt: new Date(String(row.created_at)),
  kind: row.kind === 'nightly' ? 'nightly' : 'manual',
  fileName: String(row.file_name ?? ''),
  sizeBytes: Number(row.size_bytes ?? 0),
  runUrl: String(row.run_url ?? ''),
  expiresAt: new Date(String(row.expires_at)),
});

/** The latest backups, newest first. Row Level Security shows them to an Owner only. */
export function useBackups(count = 20) {
  return useLiveRows({
    table: 'backup_log',
    queryKey: String(count),
    load: () =>
      supabase
        .from('backup_log')
        .select('id, created_at, kind, file_name, size_bytes, run_url, expires_at')
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
 * Only manual backups count for the reminder: they are the ones the Owner saves to their PC
 * or Google Drive. A nightly file stays on GitHub for 7 days and is then gone.
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

export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
