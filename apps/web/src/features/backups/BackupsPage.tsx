import { ExternalLink } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/features/settings/PageHeader';
import { ICON_STROKE } from '@/lib/utils';
import {
  BACKUP_WORKFLOW_URL,
  backupStatus,
  describeDaysAgo,
  formatBackupTime,
  formatSize,
  REMIND_AFTER_DAYS,
  RESTORE_GUIDE_URL,
  useBackups,
} from './data';

const STEPS = [
  'Open the Backup workflow on GitHub and press Run workflow. Keep branch main and target production.',
  'Wait about 2 minutes for the green tick, open the run, and download the file under Artifacts.',
  'Save the file to your PC and to Google Drive. GitHub deletes its copy after 1 day.',
  'Delete the artifact on GitHub once it is saved.',
];

/**
 * Settings > Backups (SYS-04). Backups are made on GitHub, never in the browser: a full
 * backup holds every password hash, which the app must never be able to read. This page
 * only shows what the Backup workflow recorded and how to make the next one.
 */
export function BackupsPage() {
  const backups = useBackups();
  const status = backupStatus(backups.data);
  const now = new Date();

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
              Last saved backup
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
              <Alert variant="warn" className="mt-[6px]">
                <span>
                  <b>
                    {status.lastManual
                      ? `Your last backup is more than ${REMIND_AFTER_DAYS} days old.`
                      : 'There is no backup yet.'}
                  </b>{' '}
                  Make one now and save it to your PC and Google Drive.
                </span>
              </Alert>
            )}
            {status.lastNightly && (
              <p className="text-[13px] text-neutral-700">
                Last nightly backup: {formatBackupTime(status.lastNightly.createdAt)}. Nightly files
                stay on GitHub for 7 days and do not count for the reminder.
              </p>
            )}
          </section>
        )
      )}

      <section className="flex flex-col gap-[10px] rounded-[30px] bg-surface px-[18px] py-[16px] md:px-[22px]">
        <h2 className="font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase">
          Make a backup
        </h2>
        <ol className="flex list-decimal flex-col gap-[6px] pl-[20px] text-[14.5px] leading-[1.45]">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="text-[13px] text-neutral-700">
          The file is encrypted. Opening it needs the backup key, which you keep offline. To
          restore, follow the{' '}
          <a href={RESTORE_GUIDE_URL} target="_blank" rel="noopener noreferrer">
            restore guide
          </a>
          .
        </p>
        <Button asChild className="min-h-[46px] self-start px-[20px]">
          <a href={BACKUP_WORKFLOW_URL} target="_blank" rel="noopener noreferrer">
            Open the Backup workflow on GitHub
            <ExternalLink size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </a>
        </Button>
      </section>

      {backups.data.length > 0 && (
        <section className="flex flex-col gap-[4px]">
          <h2 className="px-[4px] font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase">
            Recent backups
          </h2>
          <ul className="rounded-[30px] bg-surface px-[14px] py-[6px] md:px-[22px]">
            {backups.data.map((backup) => {
              const onGitHub = backup.expiresAt > now;
              return (
                <li
                  key={backup.id}
                  className="flex min-h-[56px] flex-wrap items-center gap-x-[12px] gap-y-[2px] border-b border-text/8 py-[8px] text-[14px] last:border-b-0"
                >
                  <span className="min-w-0 flex-1">
                    <b>{formatBackupTime(backup.createdAt)}</b>{' '}
                    <span className="text-neutral-700">
                      · {backup.kind === 'manual' ? 'Manual' : 'Nightly'} ·{' '}
                      {formatSize(backup.sizeBytes)}
                    </span>
                  </span>
                  {onGitHub ? (
                    <a
                      href={backup.runUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px]"
                    >
                      Download until {formatBackupTime(backup.expiresAt)}
                    </a>
                  ) : (
                    <span className="text-[13px] text-neutral-700">No longer on GitHub</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
