import { Slot } from '@radix-ui/react-slot';
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
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {
  /** Styles its one child (a form, section or list item) as the card instead of a div. */
  asChild?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, size, tone, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return <Comp ref={ref} className={cn(cardVariants({ size, tone }), className)} {...props} />;
  },
);
Card.displayName = 'Card';
