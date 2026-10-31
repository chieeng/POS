import { CloudCheck, CloudOff, RefreshCw } from 'lucide-react';
import { useOnline } from '@/hooks/useOnline';
import { cn, ICON_STROKE } from '@/lib/utils';

type State = 'online' | 'offline' | 'pending';

const looks = {
  online: { icon: CloudCheck, color: 'bg-accent-2-100 text-accent-2-800' },
  offline: { icon: CloudOff, color: 'bg-pending-bg text-pending-fg' },
  pending: { icon: RefreshCw, color: 'bg-warn-bg text-warn-fg' },
};

function connectionLabels(state: State, pending: number) {
  if (state === 'pending') {
    const changes = pending === 1 ? 'change' : 'changes';
    return { short: `${pending} to sync`, long: `${pending} ${changes} waiting to sync` };
  }
  // "Offline · working locally" becomes true once checkout queues sales offline (build step 9).
  return state === 'online'
    ? { short: 'Online', long: 'Online' }
    : { short: 'Offline', long: 'Offline' };
}

interface ConnectionPillProps {
  variant: 'topbar' | 'sidebar' | 'rail';
  /** The signed-in user's changes waiting in the device outbox (SRS NFR-02). */
  pending?: number;
  className?: string;
}

/**
 * Online, offline or waiting to sync. Reads the browser's online/offline events only: no
 * polling and no network calls.
 */
export function ConnectionPill({ variant, pending = 0, className }: ConnectionPillProps) {
  const online = useOnline();
  const state: State = pending > 0 ? 'pending' : online ? 'online' : 'offline';
  const { icon: Icon, color } = looks[state];
  const labels = connectionLabels(state, pending);

  if (variant === 'rail') {
    return (
      <div
        role="status"
        title={labels.long}
        className={cn('relative grid size-11 place-items-center rounded-full', color, className)}
      >
        <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden />
        <span className="sr-only">{labels.long}</span>
        {state === 'pending' && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-text px-[5px] text-[10.5px] font-bold text-bg"
          >
            {pending > 99 ? '99+' : pending}
          </span>
        )}
      </div>
    );
  }

  const sidebar = variant === 'sidebar';
  return (
    <div
      role="status"
      className={cn(
        'flex items-center rounded-full font-semibold',
        sidebar
          ? 'min-h-[36px] gap-2 px-3 text-[12.5px]'
          : 'h-[30px] gap-1.5 px-[11px] text-[12px]',
        color,
        className,
      )}
    >
      <Icon size={sidebar ? 15 : 14} strokeWidth={ICON_STROKE} aria-hidden />
      <span>{sidebar ? labels.long : labels.short}</span>
    </div>
  );
}
