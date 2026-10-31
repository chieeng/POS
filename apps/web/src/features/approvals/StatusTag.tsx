import { TriangleAlert, Undo2, X } from 'lucide-react';
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import type { RequestStatus } from './data';

const LABELS: Record<RequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

const TONES: Record<RequestStatus, StatusTone> = {
  pending: 'pending',
  approved: 'ok',
  rejected: 'danger',
  withdrawn: 'pending',
};

// Approvals.dc.html: Pending (clock), Approved (check), Rejected (x).
const ICONS = { rejected: X, withdrawn: Undo2 };

export function StatusTag({
  status,
  outdated = false,
}: {
  status: RequestStatus;
  outdated?: boolean;
}) {
  if (outdated) {
    return (
      <StatusBadge tone="warn" icon={TriangleAlert}>
        Outdated
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone={TONES[status]} icon={ICONS[status as keyof typeof ICONS]}>
      {LABELS[status]}
    </StatusBadge>
  );
}
