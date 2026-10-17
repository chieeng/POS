import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/features/settings/PageHeader';
import { backupStatus, describeDaysAgo, formatBackupTime, useBackups } from './data';

/**
 * Settings > Backups (SYS-04), read-only. Backups are made and kept by the developer who
 * maintains the system, on GitHub; the store's Owner has no GitHub access. This page only
 * shows the Owner when the last ones were made.
 */
export function BackupsPage() {
  const backups = useBackups();
  const status = backupStatus(backups.data);

  return (
    <div className="flex flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pr-[32px] xl:pl-[16px]">
      <PageHeader title="Backups" backTo="/settings" backLabel="Back to settings" />

      {backups.error && (
        <Alert variant="danger">
          <b>Couldn&apos;t load the backups.</b> Check your connection and reload.
        </Alert>
      )}

      {backups.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : (
        !backups.error && (
          <section className="flex flex-col gap-[6px] rounded-[30px] bg-surface px-[18px] py-[16px] md:px-[22px]">
            <h2 className="font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase">
              Last backup
            </h2>
            {status.lastManual ? (
              <p className="text-[18px]">
                {formatBackupTime(status.lastManual.createdAt)}{' '}
                <span className="text-neutral-700">
                  · {describeDaysAgo(status.manualDaysAgo ?? 0)}
                </span>
              </p>
            ) : (
              <p className="text-[18px]">No backup yet</p>
            )}
            {status.overdue && (
              <p className="text-[14px] text-neutral-800" role="status">
                Data backup is overdue. Your system administrator has been notified.
              </p>
            )}
            {status.lastNightly && (
              <p className="text-[13px] text-neutral-700">
                Last automatic nightly copy: {formatBackupTime(status.lastNightly.createdAt)}.
              </p>
            )}
          </section>
        )
      )}

      <p className="text-[13px] leading-[1.5] text-neutral-700">
        Backups of all the store&apos;s data are made and kept safe by your system administrator.
        There is nothing you need to do here.
      </p>
    </div>
  );
}
