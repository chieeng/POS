import {
  ChevronRight,
  DatabaseBackup,
  LogOut,
  ScrollText,
  Store,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet, useMatch } from 'react-router-dom';
import { signOutUser } from '@/features/auth/authService';
import { cn, ICON_STROKE } from '@/lib/utils';

interface Section {
  to: string;
  label: string;
  sub: string;
  icon: LucideIcon;
}

// Attendance, appearance and notifications join this list as they are built.
const SECTIONS: Section[] = [
  { to: 'store', label: 'Store', sub: 'Details, receipts and location', icon: Store },
  { to: 'users', label: 'Users', sub: 'Accounts, roles and devices', icon: Users },
  { to: 'audit-log', label: 'Audit log', sub: 'Every change, who and when', icon: ScrollText },
  { to: 'backups', label: 'Backups', sub: 'Last backup and how to make one', icon: DatabaseBackup },
];

/**
 * Owner settings (design 15). Phones get a list of sections that opens each page; tablets
 * and laptops keep the section list beside the page.
 */
export function SettingsLayout() {
  const atIndex = useMatch('/settings') !== null;

  return (
    <div className="flex min-w-0 flex-1 flex-col md:flex-row">
      <aside
        className={cn(
          'flex-none flex-col gap-[2px] md:flex md:w-[220px] md:pt-[18px] md:pr-[8px] md:pl-[14px] xl:w-[230px] xl:pt-[28px] xl:pl-[18px]',
          atIndex ? 'flex' : 'hidden',
        )}
      >
        <h1 className="px-[18px] pt-[2px] pb-[12px] text-[28px] md:px-[8px] md:pb-[8px] md:text-[24px] xl:px-[12px] xl:pb-[10px] xl:text-[28px]">
          Settings
        </h1>

        {/* Phone: grouped rows */}
        <div className="flex flex-col gap-[12px] px-[14px] md:hidden">
          <div className="flex flex-col rounded-[24px] bg-surface py-[4px]">
            {SECTIONS.map(({ to, label, sub, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className="flex min-h-[56px] items-center gap-[12px] px-[16px] text-text no-underline"
              >
                <Icon size={18} strokeWidth={ICON_STROKE} className="text-accent-700" aria-hidden />
                <div className="flex-1 leading-[1.3]">
                  <div className="text-[15px]">{label}</div>
                  <div className="text-[12.5px] text-neutral-700">{sub}</div>
                </div>
                <ChevronRight
                  size={16}
                  strokeWidth={ICON_STROKE}
                  className="text-neutral-700"
                  aria-hidden
                />
              </NavLink>
            ))}
          </div>
          <button
            type="button"
            onClick={() => signOutUser()}
            className="flex min-h-[56px] items-center gap-[12px] rounded-[24px] bg-surface px-[16px] text-left text-[15px]"
          >
            <LogOut size={18} strokeWidth={ICON_STROKE} className="text-accent-700" aria-hidden />
            Sign out
          </button>
        </div>

        {/* Tablet and laptop: pill tabs */}
        <nav aria-label="Settings" className="hidden flex-col gap-[2px] md:flex">
          {SECTIONS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[42px] items-center gap-[8px] rounded-full px-[12px] text-[14px] text-text no-underline',
                  isActive ? 'bg-accent font-bold text-bg' : 'hover:bg-text/7',
                )
              }
            >
              <Icon size={15} strokeWidth={ICON_STROKE} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className={cn('min-w-0 flex-1 flex-col', atIndex ? 'hidden md:flex' : 'flex')}>
        <Outlet />
      </div>
    </div>
  );
}
