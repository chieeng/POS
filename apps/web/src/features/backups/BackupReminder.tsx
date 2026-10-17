import { DatabaseBackup } from 'lucide-react';
import { ICON_STROKE } from '@/lib/utils';
import { backupStatus, useBackups } from './data';

/**
 * SYS-04: a calm note on the Owner's home when the last manual backup is more than 7 days
 * old. Backups are made by the developer who maintains the system, and heartbeat.yml has
 * already emailed them; the Owner has nothing to do. Silent while loading or on an error.
 */
export function BackupReminder() {
  const backups = useBackups(10);
  if (backups.loading || backups.error) return null;
  if (!backupStatus(backups.data).overdue) return null;

  return (
    <p
      role="status"
      className="flex max-w-[560px] items-center gap-[10px] rounded-[20px] bg-surface px-4 py-3 text-[14px] leading-[1.4] text-neutral-800"
    >
      <DatabaseBackup
        size={18}
        strokeWidth={ICON_STROKE}
        className="flex-none text-neutral-700"
        aria-hidden
      />
      Data backup is overdue. Your system administrator has been notified.
    </p>
  );
}
