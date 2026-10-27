import { cva } from 'class-variance-authority';
import { Check, CircleAlert, Clock, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { cn, ICON_STROKE } from '@/lib/utils';

export type StatusTone = 'ok' | 'warn' | 'danger' | 'pending' | 'accent';

const badgeVariants = cva(
  'inline-flex items-center gap-[5px] rounded-full px-[10px] py-[3px] text-[12px] font-bold whitespace-nowrap',
  {
    variants: {
      tone: {
        ok: 'bg-accent-2-100 text-accent-2-800',
        warn: 'bg-warn-bg text-warn-fg',
        danger: 'bg-danger-bg text-danger-fg',
        pending: 'bg-pending-bg text-pending-fg',
        accent: 'bg-accent-100 text-accent-800',
      },
    },
  },
);

const defaultIcons: Partial<Record<StatusTone, LucideIcon>> = {
  ok: Check,
  warn: TriangleAlert,
  danger: CircleAlert,
  pending: Clock,
};

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  /** Replaces the tone's icon; the accent tone has none by default. */
  icon?: LucideIcon;
}

/** A status or type chip: color, icon and words together, never color alone. */
export function StatusBadge({ tone, icon, className, children, ...props }: StatusBadgeProps) {
  const Icon = icon ?? defaultIcons[tone];
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {Icon && <Icon size={12} strokeWidth={ICON_STROKE} aria-hidden />}
      {children}
    </span>
  );
}
