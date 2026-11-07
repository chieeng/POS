import { ROLE_LABELS } from '@/features/auth/roles';
import { BackupReminder } from '@/features/backups/BackupReminder';
import { LowStockCard } from '@/features/stock/LowStockCard';
import { useSession } from '@/stores/session';

/**
 * The Owner's home until the dashboard (build step 13). Staff start on Sell instead. On a
 * phone, signing out is in the avatar's Account sheet, so there is no Sign out button here.
 */
export function HomePage() {
  const user = useSession((s) => s.user);
  if (!user) return null;

  return (
    <main className="flex flex-1 flex-col items-start gap-[12px] p-[24px] md:p-[48px]">
      <h1 className="text-[34px]">Owner home</h1>
      <p className="text-neutral-800">
        Signed in as <b>{user.displayName}</b> · {ROLE_LABELS[user.role]}
      </p>
      <p className="text-neutral-700">
        The dashboard will appear here. Sell, approvals, products and stock-in are in the menu;
        users and the audit log under Settings.
      </p>
      <BackupReminder />
      <LowStockCard />
    </main>
  );
}
