import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CloudOff, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
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
        // A neutral notice, e.g. "This will be sent to the Owner for approval."
        info: 'rounded-[22px] bg-neutral-200 text-text',
      },
    },
    defaultVariants: { variant: 'danger' },
  },
);

const icons = { danger: CircleAlert, warn: TriangleAlert, offline: CloudOff, info: Info };

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  /** Replaces the variant's icon. */
  icon?: LucideIcon;
  /** A button under the message, such as Retry. */
  action?: React.ReactNode;
}

export function Alert({ className, variant, icon, action, children, ...props }: AlertProps) {
  const Icon = icon ?? icons[variant ?? 'danger'];
  // Info notices are not urgent, so they are not announced as alerts.
  const role = variant === 'info' ? 'status' : 'alert';
  return (
    <div role={role} className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon size={18} strokeWidth={ICON_STROKE} className="mt-px flex-none" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-[10px]">
        <span>{children}</span>
        {action}
      </div>
    </div>
  );
}

/** The Retry-style button inside an Alert: outlined in the alert's own color. */
export function AlertAction({
  className,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full border border-current px-4 font-body text-[14px] font-bold hover:bg-text/7 disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}
