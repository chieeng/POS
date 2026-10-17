import { useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/features/settings/PageHeader';
import { AUDIT_MAX, AUDIT_PAGE_SIZE, useAuditLogs, useUsers } from '@/features/users/data';
import { ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { ACTION_LABELS, describeAudit } from './describe';

const selectClass =
  'h-[40px] rounded-full border border-divider bg-bg px-[14px] text-[14px] text-text hover:border-text/45';

const formatWhen = (when: Date | null) =>
  when
    ? when.toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Just now';

/**
 * Settings > Audit log (design 15f, SYS-03). Read-only; the rules allow the Owner only. Rows are
 * one line of columns only from xl up: below that, beside the side menus, the columns would
 * leave the sentence too little room and every row would wrap.
 */
export function AuditLogPage() {
  const branchId = useSession((s) => s.user?.branchId ?? '');
  const [count, setCount] = useState(AUDIT_PAGE_SIZE);
  const [person, setPerson] = useState('');
  const [action, setAction] = useState('');
  const logs = useAuditLogs(branchId, count);
  const users = useUsers(branchId);

  const names = useMemo(
    () => new Map(users.data.map((user) => [user.uid, user.displayName])),
    [users.data],
  );
  const nameOf = (uid: string) => names.get(uid) ?? 'Unknown user';

  const shown = logs.data.filter(
    (entry) =>
      (!person || entry.actorId === person || entry.targetId === person) &&
      (!action || entry.action === action),
  );
  const canLoadMore = logs.data.length >= count && count < AUDIT_MAX;

  return (
    <div className="flex flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pr-[32px] xl:pl-[16px]">
      <PageHeader title="Audit log" backTo="/settings" backLabel="Back to settings" />

      <div className="flex flex-wrap gap-[8px]">
        <select
          aria-label="Person"
          className={selectClass}
          value={person}
          onChange={(event) => setPerson(event.target.value)}
        >
          <option value="">Everyone</option>
          {users.data.map((user) => (
            <option key={user.uid} value={user.uid}>
              {user.displayName}
            </option>
          ))}
        </select>
        <select
          aria-label="Action"
          className={selectClass}
          value={action}
          onChange={(event) => setAction(event.target.value)}
        >
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {logs.error && (
        <Alert variant="danger">
          <b>Couldn&apos;t load the audit log.</b> Check your connection and reload.
        </Alert>
      )}

      {logs.loading ? (
        <p className="text-neutral-700" role="status">
          Loading…
        </p>
      ) : shown.length === 0 ? (
        <p className="text-neutral-700">Nothing to show for this filter.</p>
      ) : (
        <ul className="rounded-[30px] bg-surface px-[14px] py-[8px] md:px-[22px]">
          {shown.map((entry) => {
            const line = describeAudit(entry, nameOf(entry.targetId));
            const Icon = line.icon;
            return (
              <li
                key={entry.id}
                className="grid min-h-[56px] grid-cols-[34px_1fr] items-center gap-x-[12px] gap-y-[2px] border-b border-text/8 py-[8px] text-[14px] last:border-b-0 xl:grid-cols-[132px_34px_minmax(0,1fr)_minmax(0,200px)_84px]"
              >
                <span className="order-3 col-start-2 text-[12.5px] whitespace-nowrap text-neutral-700 xl:order-none xl:col-start-auto xl:text-[14px]">
                  {formatWhen(entry.createdAt)}
                </span>
                <span className="row-span-3 grid size-[32px] place-items-center self-start rounded-full bg-bg xl:row-span-1 xl:self-center">
                  <Icon
                    size={15}
                    strokeWidth={ICON_STROKE}
                    className="text-accent-700"
                    aria-hidden
                  />
                </span>
                <span>
                  <b>{nameOf(entry.actorId)}</b> {line.what}
                </span>
                <span className="col-start-2 text-neutral-800 xl:col-start-auto">
                  {line.change}
                </span>
                <span className="col-start-2 text-[12.5px] text-neutral-700 xl:col-start-auto">
                  {entry.deviceTag ? `Device ${entry.deviceTag}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {canLoadMore && (
        <Button
          variant="secondary"
          className="min-h-[44px] self-center px-[20px]"
          onClick={() => setCount(AUDIT_MAX)}
        >
          Show older entries
        </Button>
      )}
      {!logs.loading && logs.data.length >= AUDIT_MAX && (
        <p className="text-center text-[12.5px] text-neutral-700">
          Showing the latest {AUDIT_MAX} entries.
        </p>
      )}
    </div>
  );
}
