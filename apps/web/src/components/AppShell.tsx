import { ChevronRight, LogOut, Menu } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useApprovalRequests } from '@/features/approvals/data';
import { ROLE_LABELS } from '@/features/auth/roles';
import { requestSignOut } from '@/features/outbox/signOut';
import { useOutboxCounts } from '@/features/outbox/useOutboxCounts';
import { useBranch } from '@/features/store/data';
import { env } from '@/lib/supabase';
import { cn, ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { Avatar } from './Avatar';
import { isAtItem, navItems, phoneNav, type NavGroup, type NavItem } from './nav';
import { Alert } from './ui/alert';
import { ConnectionPill } from './ui/connection-pill';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';

const badgeText = (count: number) => (count > 99 ? '99+' : count);

/**
 * A count on a menu item, in ink; read out as "N pending". The rail and bottom bar overlay
 * it on the icon, the sidebar puts it at the end of the row.
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

/** Sign out: a quiet row, last in the phone's sheets. */
function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void requestSignOut()}
      className="flex min-h-[56px] items-center gap-[12px] px-[4px] text-[16px] text-neutral-700 hover:text-text"
    >
      <LogOut size={19} strokeWidth={ICON_STROKE} aria-hidden />
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

/** The phone's More sheet: the items that don't fit the bar as hairline rows, then Sign out. */
function MoreSheet({
  items,
  pathname,
  name,
  roleLabel,
  open,
  onOpenChange,
}: {
  items: NavItem[];
  pathname: string;
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
        <nav aria-label="More" className="flex flex-col">
          {items.map((item) => {
            const { to, label, icon: Icon, badge } = item;
            return (
              <Link
                key={to}
                to={to}
                aria-current={isAtItem(pathname, item) ? 'page' : undefined}
                onClick={() => onOpenChange(false)}
                className="flex min-h-[56px] items-center gap-[12px] border-b border-divider px-[4px] text-[16px] text-text no-underline aria-[current=page]:font-semibold"
              >
                <Icon size={19} strokeWidth={ICON_STROKE} aria-hidden />
                <span className="flex-1">{label}</span>
                <Badge count={badge} className="h-[22px] min-w-[22px] px-[7px] text-[12px]" />
                <ChevronRight
                  size={16}
                  strokeWidth={ICON_STROKE}
                  className="text-neutral-700"
                  aria-hidden
                />
              </Link>
            );
          })}
          <SignOutButton />
        </nav>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Navigation frame (round 3, SRS 7.2): top bar and bottom tabs on phones, an icon rail on
 * tablets and a grouped sidebar on laptops. Navigation only; access is enforced by Row Level
 * Security and server functions.
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
  // The counts of items in More show on the More tab (the owner's answer, Nov 27, 2026).
  const moreBadge = phone.more.reduce((sum, item) => sum + (item.badge ?? 0), 0);
  const atMore = phone.more.some((item) => isAtItem(pathname, item));
  // Laptop and tablet: the Owner's Settings sits at the bottom, apart from the rest.
  const top = items.filter((item) => item.key !== 'settings');
  const bottom = items.filter((item) => item.key === 'settings');

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

      {/* Tablet: rail. Laptop: sidebar. Both sit on the page ground. */}
      <nav
        aria-label="Main"
        className="sticky top-0 hidden h-dvh flex-none flex-col gap-[13px] py-[13px] md:flex md:w-[76px] md:items-center xl:w-[248px] xl:items-stretch xl:gap-[18px] xl:px-[13px] xl:py-[18px]"
      >
        <div className="flex flex-col gap-[2px] xl:px-[9px]">
          <div className="font-heading text-[17px] leading-none xl:text-[28px]">POS</div>
          {storeName && (
            <div className="hidden text-[12px] text-neutral-700 xl:block">{storeName}</div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-[4px] overflow-auto md:items-center xl:items-stretch xl:gap-[2px]">
          {top.map((item, index) => (
            <SideItem
              key={item.to}
              item={item}
              active={isAtItem(pathname, item)}
              heading={item.group !== top[index - 1]?.group ? item.group : undefined}
            />
          ))}
        </div>
        <div className="flex flex-col gap-[9px] md:items-center xl:items-stretch">
          {bottom.map((item) => (
            <SideItem key={item.to} item={item} active={isAtItem(pathname, item)} />
          ))}
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
            className="flex min-h-[44px] items-center gap-[12px] rounded-[10px] text-[14px] text-neutral-700 hover:bg-text/7 hover:text-text md:w-[48px] md:justify-center xl:w-auto xl:justify-start xl:px-[14px]"
          >
            <LogOut size={18} strokeWidth={ICON_STROKE} aria-hidden />
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
          className="sticky bottom-0 flex h-[76px] flex-none items-stretch justify-around border-t border-divider bg-surface px-[6px] pt-[6px] pb-[14px] md:hidden"
        >
          {phone.bar.map((item) => {
            const active = isAtItem(pathname, item);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={tabClass(active)}
              >
                <TabContent
                  active={active}
                  icon={item.icon}
                  badge={item.badge}
                  label={item.short}
                />
              </Link>
            );
          })}
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
          pathname={pathname}
          name={user.displayName}
          roleLabel={ROLE_LABELS[user.role]}
          open={moreOpen}
          onOpenChange={setMoreOpen}
        />
      )}
    </div>
  );
}

/**
 * One sidebar item. On a laptop a group's first item carries its heading (Money, Stock,
 * People, Mine); the tablet rail shows icons only. The open page is a raised white chip.
 */
function SideItem({
  item: { to, label, icon: Icon, badge },
  active,
  heading,
}: {
  item: NavItem;
  active: boolean;
  heading?: NavGroup;
}) {
  return (
    <>
      {heading && (
        <div className="hidden px-[14px] pt-[14px] pb-[4px] text-[11.5px] font-semibold tracking-[0.06em] text-neutral-700 uppercase xl:block">
          {heading}
        </div>
      )}
      <Link
        to={to}
        title={label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex min-h-[44px] items-center gap-[12px] rounded-[10px] text-[14px] no-underline md:w-[48px] md:justify-center xl:w-auto xl:justify-start xl:px-[14px]',
          active
            ? 'bg-surface font-semibold text-text shadow-sm'
            : 'text-neutral-700 hover:bg-text/7 hover:text-text',
        )}
      >
        <Icon size={19} strokeWidth={ICON_STROKE} aria-hidden />
        <span className="hidden flex-1 xl:inline">{label}</span>
        {/* Rail: on the icon. Sidebar: at the end of the row. */}
        <Badge
          count={badge}
          className="absolute top-[2px] right-[2px] h-[18px] min-w-[18px] px-[5px] text-[10.5px] xl:hidden"
        />
        <Badge
          count={badge}
          className="hidden h-[22px] min-w-[22px] px-[7px] text-[12px] xl:grid"
        />
      </Link>
    </>
  );
}

function tabClass(active: boolean) {
  return cn(
    'flex flex-1 flex-col items-center justify-center gap-[3px] text-[11.5px] no-underline',
    active ? 'font-semibold text-text' : 'text-neutral-700',
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
          'relative grid h-[30px] w-[56px] place-items-center rounded-[15px]',
          active && 'bg-neutral-200',
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
