import * as React from 'react';
import { cn } from '@/lib/utils';

interface PesoInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** lg: the opening cash (66 px); md: an amount in the cash in/out sheet (62 px). */
  size?: 'lg' | 'md';
  /** A warning border, e.g. an opening cash that differs from the last count. */
  warn?: boolean;
}

/** Cash Drawer.dc.html: a big amount in the heading face, with the peso sign in front. */
export const PesoInput = React.forwardRef<HTMLInputElement, PesoInputProps>(
  ({ size = 'lg', warn = false, className, ...props }, ref) => (
    <div
      className={cn(
        'flex items-center gap-[6px] rounded-full border-2 bg-surface px-[22px] font-heading has-[:focus-visible]:border-accent',
        size === 'lg' ? 'h-[66px] text-[32px]' : 'h-[62px] text-[30px]',
        warn ? 'border-warn-fg' : 'border-transparent',
        className,
      )}
    >
      <span aria-hidden>₱</span>
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        className="w-full min-w-0 bg-transparent outline-none placeholder:text-neutral-500"
        {...props}
      />
    </div>
  ),
);
PesoInput.displayName = 'PesoInput';
