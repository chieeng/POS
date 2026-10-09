import { Button } from '@/components/ui/button';
import { signOutUser } from '@/features/auth/authService';
import { ROLE_LABELS, type Role } from '@/features/auth/roles';
import { useSession } from '@/stores/session';

const HOME_COPY: Record<Role, { title: string; body: string }> = {
  owner: {
    title: 'Owner home',
    body: 'The dashboard and approvals will appear here. Users and the audit log are under Settings.',
  },
  specialSales: {
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
      <Button
        variant="secondary"
        className="mt-[12px] min-h-11 px-6 md:hidden"
        onClick={() => signOutUser()}
      >
        Sign out
      </Button>
    </main>
  );
}
