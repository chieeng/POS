import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const tagVariants = cva(
  'inline-flex items-center gap-[5px] rounded-full px-[10px] py-[3px] text-[12px] font-bold tracking-[0.02em]',
  {
    variants: {
      variant: {
        accent: 'bg-accent-100 text-accent-800',
        'accent-2': 'bg-accent-2-100 text-accent-2-800',
        neutral: 'bg-neutral-100 text-neutral-800',
        muted: 'bg-neutral-300 text-neutral-900',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export function Tag({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof tagVariants>) {
  return <span className={cn(tagVariants({ variant }), className)} {...props} />;
}
