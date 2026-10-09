import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CloudOff, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import { cn, ICON_STROKE } from '@/lib/utils';

const alertVariants = cva(
  'flex items-start gap-[10px] rounded-[20px] px-4 py-3 text-[14px] leading-[1.4]',
  {
    variants: {
      variant: {
        danger: 'bg-danger-bg text-danger-fg',
        warn: 'bg-warn-bg text-warn-fg',
        offline: 'bg-pending-bg text-pending-fg',
      },
    },
    defaultVariants: { variant: 'danger' },
  },
);

const icons = { danger: CircleAlert, warn: TriangleAlert, offline: CloudOff };

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, children, ...props }: AlertProps) {
  const Icon = icons[variant ?? 'danger'];
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon size={18} strokeWidth={ICON_STROKE} className="mt-px flex-none" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
