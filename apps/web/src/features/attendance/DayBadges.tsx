import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import { formatPeso } from '@/lib/money';
import { flagText } from './clock';
import { flatDeduction, stateLabel, type DayState, type PersonDay } from './report';

const TONES: Record<DayState, StatusTone> = {
  done: 'ok',
  in: 'ok',
  no_out: 'danger',
  absent: 'danger',
  rest: 'pending',
  not_in: 'pending',
  none: 'pending',
};

/** One day in badges: what it is, then what to look at. They wrap on a phone. */
export function DayBadges({ state, row }: Pick<PersonDay, 'state' | 'row'>) {
  const worked = row?.kind === 'worked' ? row : null;
  const deduction = flatDeduction(row);
  return (
    <span className="flex min-w-0 flex-wrap gap-[6px]">
      <StatusBadge tone={TONES[state]}>{stateLabel({ state, row })}</StatusBadge>
      {worked && worked.lateMinutes > 0 && (
        <StatusBadge tone="warn">Late by {worked.lateMinutes} min</StatusBadge>
      )}
      {deduction > 0 && (
        <StatusBadge tone="warn">Late deduction {formatPeso(deduction)}</StatusBadge>
      )}
      {worked && worked.earlyMinutes > 0 && (
        <StatusBadge tone="warn">Early out {worked.earlyMinutes} min</StatusBadge>
      )}
      {worked && worked.overtimeMinutes > 0 && (
        <StatusBadge tone="accent">Overtime {worked.overtimeMinutes} min</StatusBadge>
      )}
      {worked?.flags.map((flag) => (
        <StatusBadge
          key={flag}
          tone={flag === 'edited' ? 'accent' : 'warn'}
          className="max-w-full whitespace-normal"
        >
          {flagText(flag, worked)}
        </StatusBadge>
      ))}
    </span>
  );
}
