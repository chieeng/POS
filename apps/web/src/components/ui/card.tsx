import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const cardVariants = cva('flex flex-col', {
  variants: {
    size: {
      // List items and phone sections.
      default: 'gap-2 rounded-[24px] px-[14px] py-3',
      // Tables and laptop containers.
      panel: 'rounded-card px-5 py-2',
    },
    tone: {
      surface: 'bg-surface',
      // A card nested inside a surface card or panel.
      inset: 'bg-bg',
    },
  },
  defaultVariants: { size: 'default', tone: 'surface' },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, size, tone, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ size, tone }), className)} {...props} />
  ),
);
Card.displayName = 'Card';
