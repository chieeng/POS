import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'min-h-[36px] w-full rounded-full border border-divider bg-surface px-[14px] py-[6px] text-[14px] text-text caret-accent',
        'hover:border-text/45 focus-visible:border-accent focus-visible:outline-offset-0',
        'aria-invalid:border-2 aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
