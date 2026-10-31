import { useEffect, useState } from 'react';
import { watchOutbox, type OutboxCounts } from '@/lib/outbox';
import { useSession } from '@/stores/session';

const NONE: OutboxCounts = { waiting: 0, needsAttention: 0 };

/** The signed-in user's outbox, live: for the connection pill and the sign-out check. */
export function useOutboxCounts(): OutboxCounts {
  const uid = useSession((s) => s.user?.uid);
  const [latest, setLatest] = useState<{ uid: string; counts: OutboxCounts } | null>(null);
  useEffect(() => {
    if (!uid) return;
    return watchOutbox(uid, (counts) => setLatest({ uid, counts }));
  }, [uid]);
  // Counts read for another user (before a sign-in changed) are not shown.
  return latest && latest.uid === uid ? latest.counts : NONE;
}
