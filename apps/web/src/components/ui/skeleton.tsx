import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  /** `secondary` is the fainter second line. */
  level?: 'primary' | 'secondary';
  /** On a surface card the bars are neutral; straight on the page they are surface. */
  on?: 'card' | 'page';
}

/** A static placeholder bar; the design shows no shimmer. Size it with className. */
export function Skeleton({ className, level = 'primary', on = 'card' }: SkeletonProps) {
  const color =
    level === 'secondary' ? 'bg-neutral-200' : on === 'card' ? 'bg-neutral-300' : 'bg-surface';
  return <span aria-hidden className={cn('block h-3 rounded-full', color, className)} />;
}

/** A list of placeholder rows while a list loads, announced once as "Loading". */
export function SkeletonList({
  rows = 5,
  on = 'card',
  className,
}: {
  rows?: number;
  on?: 'card' | 'page';
  className?: string;
}) {
  const row =
    on === 'card'
      ? 'flex items-center gap-3 rounded-[24px] bg-surface px-[14px] py-3'
      : 'flex items-center gap-3 py-[7px]';
  return (
    <div role="status" className={cn('flex flex-col gap-2', className)}>
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={row}>
          <Skeleton on={on} className="size-11 flex-none" />
          <span className="flex flex-1 flex-col gap-[7px]">
            <Skeleton on={on} className="w-[70%]" />
            <Skeleton on={on} level="secondary" className="h-[10px] w-[45%]" />
          </span>
        </div>
      ))}
    </div>
  );
}
