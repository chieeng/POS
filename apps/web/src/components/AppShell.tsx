import {
  ClipboardCheck,
  CloudCheck,
  CloudOff,
  LayoutDashboard,
  LogOut,
  Package,
  PackagePlus,
  Settings,
  ShoppingCart,
  Inbox,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { signOutUser } from '@/features/auth/authService';
import { useApprovalRequests } from '@/features/approvals/data';
import { ROLE_HOME, ROLE_LABELS, type Role } from '@/features/auth/roles';
import { useBranch } from '@/features/store/data';
import { useOnline } from '@/hooks/useOnline';
import { env } from '@/lib/supabase';
import { cn, ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { Avatar } from './Avatar';

interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: LucideIcon;
  /** A count shown on the item, for example pending approvals. */
  badge?: number;
}

/** Only screens that exist are listed; more arrive with each phase. */
function navItems(role: Role, pending: number): NavItem[] {
  if (role === 'owner') {
    return [
      { to: ROLE_HOME.owner, label: 'Dashboard', short: 'Home', icon: LayoutDashboard },
      {
        to: '/approvals',
        label: 'Approvals',
        short: 'Approvals',
        icon: ClipboardCheck,
        badge: pending,
      },
      { to: '/products', label: 'Products', short: 'Products', icon: Package },
      { to: '/stock-in', label: 'Stock-in', short: 'Stock-in', icon: PackagePlus },
      { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings },
    ];
  }
  if (role === 'special_sales') {
    return [
      { to: ROLE_HOME[role], label: 'Sell', short: 'Sell', icon: ShoppingCart },
      { to: '/products', label: 'Products', short: 'Products', icon: Package },
      { to: '/stock-in', label: 'Stock-in', short: 'Stock-in', icon: PackagePlus },
      { to: '/requests', label: 'My requests', short: 'Requests', icon: Inbox, badge: pending },
    ];
  }
  return [
    { to: ROLE_HOME[role], label: 'Sell', short: 'Sell', icon: ShoppingCart },
    { to: '/products', label: 'Products', short: 'Products', icon: Package },
  ];
}

/** A small count on a menu item; read out as "N pending" by screen readers. */
function Badge({ count, className }: { count?: number; className?: string }) {
  if (!count) return null;
  return (
    <span
      className={cn(
        'absolute grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-[5px] text-[11px] leading-none font-bold text-bg',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
      <span className="sr-only"> pending</span>
    </span>
  );
}

function SyncPill({ compact = false }: { compact?: boolean }) {
  const online = useOnline();
  const Icon = online ? CloudCheck : CloudOff;
  const label = online ? 'Online' : compact ? 'Offline' : 'Offline · working locally';
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-[8px] rounded-full text-[12.5px] font-semibold',
        compact ? 'h-[30px] px-[11px]' : 'min-h-[36px] px-[12px]',
        online ? 'bg-accent-2-100 text-accent-2-800' : 'bg-pending-bg text-pending-fg',
      )}
    >
      <Icon size={15} strokeWidth={ICON_STROKE} aria-hidden />
      <span className={cn(compact && 'max-xl:md:sr-only')}>{label}</span>
    </div>
  );
}

/**
 * Navigation frame from the design's Nav component: top bar and bottom tabs on phones, an
 * icon rail on tablets and a full sidebar on laptops. Navigation only; access is enforced
 * by Row Level Security and server functions.
 */
export function AppShell() {
  // SYS-01: the name the Owner set; the build's name until the branch has loaded.
  const storeName = useBranch().branch?.name ?? env.storeName;
  const user = useSession((s) => s.user);
  // SRS 3.9: the Owner's pending approvals, or the requester's own pending requests, live.
  // Row Level Security decides which requests each user can see.
  const requests = useApprovalRequests(1);
  const pending = requests.data.filter((request) => request.status === 'pending').length;
  if (!user) return null;
  const items = navItems(user.role, pending);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Phone: top bar */}
      <header className="flex h-[56px] flex-none items-center gap-[10px] px-[16px] md:hidden">
        <div className="mr-auto font-heading text-[24px] leading-none">POS</div>
        <SyncPill compact />
        <Avatar name={user.displayName} />
      </header>

      {/* Tablet: rail. Laptop: sidebar. */}
      <nav
        aria-label="Main"
        className="sticky top-0 hidden h-dvh flex-none flex-col gap-[13px] bg-surface py-[13px] md:flex md:w-[76px] md:items-center xl:w-[248px] xl:items-stretch xl:gap-[18px] xl:px-[13px] xl:py-[18px]"
      >
        <div className="flex flex-col gap-[2px] xl:px-[9px]">
          <div className="font-heading text-[17px] leading-none xl:text-[28px]">POS</div>
          {storeName && (
            <div className="hidden text-[12px] text-neutral-700 xl:block">{storeName}</div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-[4px] overflow-auto md:items-center xl:items-stretch xl:gap-[2px]">
          {items.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[44px] items-center gap-[12px] rounded-full text-[14px] text-text no-underline md:w-[48px] md:justify-center xl:w-auto xl:justify-start xl:px-[14px]',
                  isActive ? 'bg-accent font-semibold text-bg' : 'hover:bg-text/7',
                )
              }
            >
              <span className="relative">
                <Icon size={19} strokeWidth={ICON_STROKE} aria-hidden />
                <Badge count={badge} className="-top-[9px] -right-[12px]" />
              </span>
              <span className="hidden xl:inline">{label}</span>
            </NavLink>
          ))}
        </div>
        <div className="flex flex-col gap-[9px] md:items-center xl:items-stretch">
          <SyncPill compact />
          <div className="flex items-center gap-[10px] xl:p-[6px]">
            <Avatar name={user.displayName} className="size-[38px] text-[14px]" />
            <div className="hidden min-w-0 flex-1 flex-col leading-[1.25] xl:flex">
              <span className="truncate text-[13.5px] font-semibold">{user.displayName}</span>
              <span className="text-[12px] text-neutral-700">{ROLE_LABELS[user.role]}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => signOutUser()}
            title="Sign out"
            className="flex min-h-[44px] items-center gap-[12px] rounded-full text-[14px] hover:bg-text/7 md:w-[48px] md:justify-center xl:w-auto xl:justify-start xl:px-[14px]"
          >
            <LogOut size={18} strokeWidth={ICON_STROKE} className="text-neutral-700" aria-hidden />
            <span className="hidden xl:inline">Sign out</span>
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>

      {/* Phone: bottom tabs, once there is more than one place to go */}
      {items.length > 1 && (
        <nav
          aria-label="Main"
          className="sticky bottom-0 flex h-[76px] flex-none items-stretch justify-around bg-surface px-[6px] pt-[6px] pb-[14px] md:hidden"
        >
          {items.map(({ to, short, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'group flex flex-1 flex-col items-center justify-center gap-[3px] text-[11.5px] no-underline',
                  isActive ? 'font-bold text-accent-800' : 'text-neutral-800',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'relative grid h-[30px] w-[56px] place-items-center rounded-full',
                      isActive && 'bg-accent-200',
                    )}
                  >
                    <Icon size={19} strokeWidth={ICON_STROKE} aria-hidden />
                    <Badge count={badge} className="-top-[4px] right-[6px]" />
                  </span>
                  {short}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
