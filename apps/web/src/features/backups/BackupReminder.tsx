import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { backupStatus, describeDaysAgo, REMIND_AFTER_DAYS, useBackups } from './data';

/**
 * SYS-04: on the Owner's home, a reminder when the last manual backup is more than 7 days
 * old, or there has never been one. Silent while loading or if the list cannot be read.
 */
export function BackupReminder() {
  const backups = useBackups(10);
  if (backups.loading || backups.error) return null;
  const status = backupStatus(backups.data);
  if (!status.overdue) return null;

  return (
    <Alert variant="warn" className="max-w-[560px]">
      <span>
        <b>
          {status.lastManual && status.manualDaysAgo !== null
            ? `Your last backup was ${describeDaysAgo(status.manualDaysAgo)}.`
            : 'You have not made a backup yet.'}
        </b>{' '}
        Make one at least every {REMIND_AFTER_DAYS} days.{' '}
        <Link to="/settings/backups">Backups</Link>
      </span>
    </Alert>
  );
}
