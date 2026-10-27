import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const inputVariants = cva(
  [
    'w-full rounded-full border border-divider bg-surface text-text caret-accent',
    'hover:border-text/45 focus-visible:border-accent focus-visible:outline-offset-0',
    'aria-invalid:border-2 aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-45',
  ],
  {
    variants: {
      size: {
        default: 'min-h-[36px] px-[14px] py-[6px] text-[14px]',
        // Phone and tablet forms.
        touch: 'min-h-[48px] px-4 py-[6px] text-[15px]',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

export interface InputProps
  extends
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', size, ...props }, ref) => (
    <input ref={ref} type={type} className={cn(inputVariants({ size }), className)} {...props} />
  ),
);
Input.displayName = 'Input';

export { Input };
