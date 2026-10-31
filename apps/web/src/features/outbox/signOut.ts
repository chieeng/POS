import { create } from 'zustand';
import { signOutUser } from '@/features/auth/authService';
import { countWaiting } from '@/lib/outbox';
import { useSession } from '@/stores/session';

export const useBlocked = create<{ count: number }>(() => ({ count: 0 }));

/**
 * Every Sign out a person taps. While their sales are still waiting in the outbox they may
 * not sign out, so the sales are sent under their own name (the Owner's decision, Oct 31,
 * 2026). Sign-outs the app forces (deactivation, "sign out everywhere") still happen, and
 * the waiting sales stay on the device until that person signs in again.
 */
export async function requestSignOut(): Promise<void> {
  const uid = useSession.getState().user?.uid;
  const waiting = uid ? await countWaiting(uid) : 0;
  if (waiting > 0) useBlocked.setState({ count: waiting });
  else await signOutUser();
}

export function unsentMessage(count: number): string {
  return count === 1
    ? "1 sale hasn't been sent yet. Connect to the internet first."
    : `${count} sales haven't been sent yet. Connect to the internet first.`;
}
