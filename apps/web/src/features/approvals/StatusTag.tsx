import { Tag } from '@/components/ui/tag';
import type { RequestStatus } from './data';

const LABELS: Record<RequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

const VARIANTS: Record<RequestStatus, 'accent' | 'accent-2' | 'neutral' | 'muted'> = {
  pending: 'accent',
  approved: 'accent-2',
  rejected: 'neutral',
  withdrawn: 'muted',
};

export function StatusTag({
  status,
  outdated = false,
}: {
  status: RequestStatus;
  outdated?: boolean;
}) {
  return (
    <Tag variant={outdated ? 'neutral' : VARIANTS[status]}>
      {outdated ? 'Outdated' : LABELS[status]}
    </Tag>
  );
}
