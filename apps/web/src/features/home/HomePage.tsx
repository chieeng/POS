import { Button } from '@/components/ui/button';
import { ROLE_LABELS, type Role } from '@/features/auth/roles';
import { BackupReminder } from '@/features/backups/BackupReminder';
import { requestSignOut } from '@/features/outbox/signOut';
import { LowStockCard } from '@/features/stock/LowStockCard';
import { useSession } from '@/stores/session';

const HOME_COPY: Record<Role, { title: string; body: string }> = {
  owner: {
    title: 'Owner home',
    body: 'The dashboard will appear here. Approvals, products and stock-in are in the menu; users and the audit log under Settings.',
  },
  special_sales: {
    title: 'Special Sales home',
    body: 'Selling and inventory check-in will appear here.',
  },
  sales: {
    title: 'Sales home',
    body: 'The selling screen will appear here.',
  },
};

/** Placeholder landing page per role. Real screens arrive in later phases. */
export function HomePage({ role }: { role: Role }) {
  const user = useSession((s) => s.user);
  if (!user) return null;
  const copy = HOME_COPY[role];

  return (
    <main className="flex flex-1 flex-col items-start gap-[12px] p-[24px] md:p-[48px]">
      <h1 className="text-[34px]">{copy.title}</h1>
      <p className="text-neutral-800">
        Signed in as <b>{user.displayName}</b> · {ROLE_LABELS[user.role]}
      </p>
      <p className="text-neutral-700">{copy.body}</p>
      {role === 'owner' && <BackupReminder />}
      {role === 'owner' && <LowStockCard />}
      <Button
        variant="secondary"
        className="mt-[12px] min-h-11 px-6 md:hidden"
        onClick={() => void requestSignOut()}
      >
        Sign out
      </Button>
    </main>
  );
}
