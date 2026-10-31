import { cva, type VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn, ICON_STROKE } from '@/lib/utils';

const circleVariants = cva('grid flex-none place-items-center rounded-full', {
  variants: {
    tone: {
      // Nothing here yet.
      neutral: 'bg-accent-100 text-accent-700',
      // All done, e.g. "All caught up".
      positive: 'bg-accent-2-100 text-accent-2-700',
      // Couldn't load.
      error: 'bg-danger-bg text-danger-fg',
    },
    compact: {
      false: 'size-[110px]',
      true: 'size-24',
    },
  },
  defaultVariants: { tone: 'neutral', compact: false },
});

interface EmptyStateProps extends VariantProps<typeof circleVariants> {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  /** Buttons, e.g. Add product or Try again. */
  actions?: ReactNode;
  className?: string;
}

/** Empty, all-done and error states: a soft circle, a heading, a line and the next step. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
  tone,
  compact,
  className,
}: EmptyStateProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'flex flex-1 flex-col items-start justify-center gap-3 px-[28px] py-6',
        className,
      )}
    >
      <div className={circleVariants({ tone, compact })}>
        <Icon size={compact ? 40 : 46} strokeWidth={ICON_STROKE} aria-hidden />
      </div>
      <h2
        className={cn('m-0 font-heading leading-[1.15]', compact ? 'text-[26px]' : 'text-[28px]')}
      >
        {title}
      </h2>
      {children && <p className="m-0 text-[15px] text-neutral-800">{children}</p>}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
