import { Check, ChevronRight, UserPlus, UserX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/Avatar';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { ROLE_LABELS, type Role } from '@/features/auth/roles';
import { PageHeader } from '@/features/settings/PageHeader';
import { cn, ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { describeLastSeen, latestSeen, sortUsers, useDevices, useUsers } from './data';

const ROLE_TAG: Record<Role, 'accent' | 'accent-2' | 'neutral'> = {
  owner: 'accent',
  specialSales: 'accent-2',
  sales: 'neutral',
};

export function RoleTag({ role }: { role: Role }) {
  return <Tag variant={ROLE_TAG[role]}>{ROLE_LABELS[role]}</Tag>;
}

export function StatusTag({ active }: { active: boolean }) {
  const Icon = active ? Check : UserX;
  return (
    <Tag variant={active ? 'accent-2' : 'muted'}>
      <Icon size={12} strokeWidth={ICON_STROKE} aria-hidden />
      {active ? 'Active' : 'Deactivated'}
    </Tag>
  );
}

const HEAD = ['Name', 'Role', 'Devices', 'Last active', 'Status'];
const GRID = 'md:grid md:grid-cols-[1.6fr_1fr_0.8fr_1fr_1fr_28px] md:items-center md:gap-0';

/** Settings > Users (design 15e, AUTH-02). Reads are limited to the Owner by the rules. */
export function UsersPage() {
  const branchId = useSession((s) => s.user?.branchId ?? '');
  const users = useUsers(branchId);
  const devices = useDevices(branchId);
  const sorted = sortUsers(users.data);
  const activeCount = sorted.filter((user) => user.active).length;

  return (
    <div className="flex flex-col gap-[16px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pr-[32px] xl:pl-[16px]">
      <PageHeader
        title={users.loading ? 'Users' : `Users · ${sorted.length}`}
        backTo="/settings"
        backLabel="Back to settings"
      >
        {!users.loading && (
          <span className="hidden h-[42px] items-center rounded-full border border-divider px-[14px] text-[14px] sm:flex">
            Active · {activeCount}
          </span>
        )}
        <Button asChild className="min-h-[44px]">
          <Link to="new">
            <UserPlus size={16} strokeWidth={ICON_STROKE} aria-hidden />
            Add user
          </Link>
        </Button>
      </PageHeader>

      {users.error && (
        <Alert variant="danger">
          <b>Couldn&apos;t load users.</b> Check your connection and reload.
        </Alert>
      )}

      {users.loading ? (
        <p className="text-neutral-700" role="status">
          Loading users…
        </p>
      ) : (
        <div className="overflow-hidden rounded-[30px] bg-surface px-[8px] py-[6px] md:px-[20px]">
          <div className={cn('hidden', GRID)} aria-hidden>
            {HEAD.map((label) => (
              <div
                key={label}
                className="border-b border-divider px-[8px] py-[12px] text-[11px] tracking-[0.08em] text-neutral-700 uppercase"
              >
                {label}
              </div>
            ))}
            <div className="self-stretch border-b border-divider" />
          </div>
          <ul>
            {sorted.map((user) => {
              const own = devices.data.filter((device) => device.uid === user.uid);
              const deviceCount = `${own.length} ${own.length === 1 ? 'device' : 'devices'}`;
              return (
                <li key={user.uid} className="border-b border-text/8 last:border-b-0">
                  <Link
                    to={user.uid}
                    className={cn(
                      'flex items-center gap-[10px] rounded-[20px] px-[8px] py-[10px] text-[14px] text-text no-underline hover:bg-text/4 md:rounded-none md:px-0',
                      GRID,
                    )}
                  >
                    <div
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-[10px] md:px-[8px]',
                        !user.active && 'opacity-55',
                      )}
                    >
                      <Avatar name={user.displayName} className="size-[34px] text-[12px]" />
                      <div className="min-w-0 leading-[1.25]">
                        <div className="truncate font-semibold">{user.displayName}</div>
                        <div className="truncate text-[12.5px] text-neutral-700">{user.email}</div>
                        <div className="mt-[4px] flex flex-wrap gap-[6px] md:hidden">
                          <RoleTag role={user.role} />
                          <StatusTag active={user.active} />
                        </div>
                      </div>
                    </div>
                    <div
                      className={cn('hidden md:block md:px-[8px]', !user.active && 'opacity-55')}
                    >
                      <RoleTag role={user.role} />
                    </div>
                    <div
                      className={cn('hidden md:block md:px-[8px]', !user.active && 'opacity-55')}
                    >
                      {deviceCount}
                    </div>
                    <div
                      className={cn('hidden md:block md:px-[8px]', !user.active && 'opacity-55')}
                    >
                      {describeLastSeen(latestSeen(own))}
                    </div>
                    <div className="hidden md:block md:px-[8px]">
                      <StatusTag active={user.active} />
                    </div>
                    <ChevronRight
                      size={17}
                      strokeWidth={ICON_STROKE}
                      className="flex-none text-neutral-700"
                      aria-hidden
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
