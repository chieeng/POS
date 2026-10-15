import { initialsOf } from '@/features/auth/roles';
import { cn } from '@/lib/utils';

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-[36px] flex-none place-items-center rounded-full bg-accent-2-300 text-[13px] font-bold text-accent-2-900',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
