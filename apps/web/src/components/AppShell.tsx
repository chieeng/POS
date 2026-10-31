import { ChevronRight, LogOut, Menu } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApprovalRequests } from '@/features/approvals/data';
import { ROLE_LABELS } from '@/features/auth/roles';
import { requestSignOut } from '@/features/outbox/signOut';
import { useOutboxCounts } from '@/features/outbox/useOutboxCounts';
import { useBranch } from '@/features/store/data';
import { env } from '@/lib/supabase';
import { cn, ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { Avatar } from './Avatar';
import { isAtItem, navItems, phoneNav, type NavItem } from './nav';
import { Alert } from './ui/alert';
import { ConnectionPill } from './ui/connection-pill';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';

const badgeText = (count: number) => (count > 99 ? '99+' : count);

/**
 * A count on a menu item, in the design's accent; read out as "N pending". The rail and
 * bottom bar overlay it on the icon, the sidebar puts it at the end of the row.
 */
function Badge({ count, className }: { count?: number; className?: string }) {
  if (!count) return null;
  return (
    <span
      className={cn(
        'grid place-items-center rounded-full bg-accent leading-none font-bold text-bg',
        className,
      )}
    >
      {badgeText(count)}
      <span className="sr-only"> pending</span>
    </span>
  );
}

/** Who is signed in, at the top of the phone's Account and More sheets. */
function AccountHeader({ name, roleLabel }: { name: string; roleLabel: string }) {
  return (
    <div className="flex items-center gap-[10px] px-[4px]">
      <Avatar name={name} className="size-[40px] text-[14px]" />
      <div className="flex min-w-0 flex-col leading-[1.25]">
        <span className="truncate text-[15px] font-semibold">{name}</span>
        <span className="text-[12.5px] text-neutral-700">{roleLabel}</span>
      </div>
    </div>
  );
}

function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void requestSignOut()}
      className="flex min-h-[56px] items-center gap-[12px] rounded-[24px] bg-surface px-[16px] text-[15px] hover:bg-text/7"
    >
      <LogOut size={18} strokeWidth={ICON_STROKE} className="text-accent-700" aria-hidden />
      Sign out
    </button>
  );
}

/**
 * The phone's Account sheet, from the avatar in the top bar: who is signed in, and Sign out
 * on every page (staff hand phones over at shift change).
 */
function AccountSheet({
  name,
  roleLabel,
  open,
  onOpenChange,
}: {
  name: string;
  roleLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <SheetTitle className="sr-only">Account</SheetTitle>
        <AccountHeader name={name} roleLabel={roleLabel} />
        <SignOutButton />
      </SheetContent>
    </Sheet>
  );
}

/** The phone's More sheet: the items that don't fit the bar, then Sign out. */
function MoreSheet({
  items,
  name,
  roleLabel,
  open,
  onOpenChange,
}: {
  items: NavItem[];
  name: string;
  roleLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <SheetTitle className="sr-only">More</SheetTitle>
        <AccountHeader name={name} roleLabel={roleLabel} />
        <nav aria-label="More" className="flex flex-col rounded-[24px] bg-surface py-[4px]">
          {items.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => onOpenChange(false)}
              className="flex min-h-[56px] items-center gap-[12px] px-[16px] text-[15px] text-text no-underline hover:bg-text/7 aria-[current=page]:font-semibold"
            >
              <Icon size={18} strokeWidth={ICON_STROKE} className="text-accent-700" aria-hidden />
              <span className="flex-1">{label}</span>
              <Badge count={badge} className="h-[22px] min-w-[22px] px-[7px] text-[12px]" />
              <ChevronRight
                size={16}
                strokeWidth={ICON_STROKE}
                className="text-neutral-700"
                aria-hidden
              />
            </NavLink>
          ))}
        </nav>
        <SignOutButton />
      </SheetContent>
    </Sheet>
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
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // SRS 3.9: the Owner's pending approvals, or the requester's own pending requests, live.
  // Row Level Security decides which requests each user can see.
  const requests = useApprovalRequests(1);
  const pending = requests.data.filter((request) => request.status === 'pending').length;
  // NFR-02: what this user made offline and has not reached the server yet.
  const outbox = useOutboxCounts();
  if (!user) return null;
  const items = navItems(user.role, pending);
  const phone = phoneNav(user.role, items);
  const moreBadge = phone.more.reduce((sum, item) => sum + (item.badge ?? 0), 0);
  const atMore = phone.more.some((item) => isAtItem(pathname, item));

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Phone: top bar */}
      <header className="flex h-[56px] flex-none items-center gap-[10px] px-[16px] md:hidden">
        <div className="mr-auto font-heading text-[24px] leading-none">POS</div>
        <ConnectionPill variant="topbar" pending={outbox.waiting} />
        <button
          type="button"
          aria-label="Account"
          aria-haspopup="dialog"
          onClick={() => setAccountOpen(true)}
          className="-m-[4px] grid size-[44px] place-items-center rounded-full hover:bg-text/7"
        >
          <Avatar name={user.displayName} />
        </button>
      </header>
      <AccountSheet
        name={user.displayName}
        roleLabel={ROLE_LABELS[user.role]}
        open={accountOpen}
        onOpenChange={setAccountOpen}
      />

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
                  'relative flex min-h-[44px] items-center gap-[12px] rounded-full text-[14px] no-underline md:w-[48px] md:justify-center xl:w-auto xl:justify-start xl:px-[14px]',
                  isActive
                    ? 'bg-accent font-semibold text-bg'
                    : 'text-neutral-800 hover:bg-text/7 xl:text-text',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={19}
                    strokeWidth={ICON_STROKE}
                    className={cn(!isActive && 'xl:text-neutral-700')}
                    aria-hidden
                  />
                  <span className="hidden flex-1 xl:inline">{label}</span>
                  {/* Rail: on the icon. Sidebar: at the end, inverted on the active item. */}
                  <Badge
                    count={badge}
                    className="absolute top-[2px] right-[2px] h-[18px] min-w-[18px] px-[5px] text-[10.5px] xl:hidden"
                  />
                  <Badge
                    count={badge}
                    className={cn(
                      'hidden h-[22px] min-w-[22px] px-[7px] text-[12px] xl:grid',
                      isActive && 'bg-bg text-accent-800',
                    )}
                  />
                </>
              )}
            </NavLink>
          ))}
        </div>
        <div className="flex flex-col gap-[9px] md:items-center xl:items-stretch">
          <ConnectionPill variant="rail" pending={outbox.waiting} className="xl:hidden" />
          <ConnectionPill variant="sidebar" pending={outbox.waiting} className="hidden xl:flex" />
          <div className="flex items-center gap-[10px] xl:p-[6px]">
            <Avatar name={user.displayName} className="size-[40px] text-[14px] xl:size-[38px]" />
            <div className="hidden min-w-0 flex-1 flex-col leading-[1.25] xl:flex">
              <span className="truncate text-[13.5px] font-semibold">{user.displayName}</span>
              <span className="text-[12px] text-neutral-700">{ROLE_LABELS[user.role]}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void requestSignOut()}
            title="Sign out"
            className="flex min-h-[44px] items-center gap-[12px] rounded-full text-[14px] hover:bg-text/7 md:w-[48px] md:justify-center xl:w-auto xl:justify-start xl:px-[14px]"
          >
            <LogOut size={18} strokeWidth={ICON_STROKE} className="text-neutral-700" aria-hidden />
            <span className="hidden xl:inline">Sign out</span>
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {outbox.needsAttention > 0 && (
          <Alert variant="warn" className="mx-[16px] mt-[12px] md:mx-[24px]">
            {outbox.needsAttention === 1
              ? "1 sale on this device couldn't be saved. It's kept here, and the Owner sees it in the audit log."
              : `${outbox.needsAttention} sales on this device couldn't be saved. They're kept here, and the Owner sees them in the audit log.`}
          </Alert>
        )}
        <Outlet />
      </div>

      {/* Phone: bottom tabs, once there is more than one place to go */}
      {items.length > 1 && (
        <nav
          aria-label="Main"
          className="sticky bottom-0 flex h-[76px] flex-none items-stretch justify-around bg-surface px-[6px] pt-[6px] pb-[14px] md:hidden"
        >
          {phone.bar.map(({ to, short, icon: Icon, badge }) => (
            <NavLink key={to} to={to} className={({ isActive }) => tabClass(isActive)}>
              {({ isActive }) => (
                <TabContent active={isActive} icon={Icon} badge={badge} label={short} />
              )}
            </NavLink>
          ))}
          {phone.more.length > 0 && (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-current={atMore ? 'page' : undefined}
              onClick={() => setMoreOpen(true)}
              className={tabClass(atMore)}
            >
              <TabContent active={atMore} icon={Menu} badge={moreBadge} label="More" />
            </button>
          )}
        </nav>
      )}
      {phone.more.length > 0 && (
        <MoreSheet
          items={phone.more}
          name={user.displayName}
          roleLabel={ROLE_LABELS[user.role]}
          open={moreOpen}
          onOpenChange={setMoreOpen}
        />
      )}
    </div>
  );
}

function tabClass(active: boolean) {
  return cn(
    'flex flex-1 flex-col items-center justify-center gap-[3px] text-[11.5px] no-underline',
    active ? 'font-bold text-accent-800' : 'text-neutral-800',
  );
}

function TabContent({
  active,
  icon: Icon,
  badge,
  label,
}: {
  active: boolean;
  icon: NavItem['icon'];
  badge?: number;
  label: string;
}) {
  return (
    <>
      <span
        className={cn(
          'relative grid h-[30px] w-[56px] place-items-center rounded-full',
          active && 'bg-accent-200',
        )}
      >
        <Icon size={19} strokeWidth={ICON_STROKE} aria-hidden />
        <Badge
          count={badge}
          className="absolute -top-[2px] right-[8px] h-[17px] min-w-[17px] px-[5px] text-[10px]"
        />
      </span>
      {label}
    </>
  );
}
