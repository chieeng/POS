import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-transparent font-heading text-[14px] leading-[1.2] text-text no-underline disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-bg hover:bg-accent-600 active:bg-accent-700',
        secondary: 'border-divider hover:bg-text/7 active:bg-text/14',
        ghost: 'text-accent hover:bg-accent/10 active:bg-accent/18',
        // Text-style action in the body face, as used under the sign-in and lock forms.
        quiet:
          'font-body font-semibold text-accent-700 hover:bg-accent/10 active:bg-accent/18 text-[15px]',
      },
      size: {
        default: 'px-[15.84px] py-2',
        lg: 'min-h-[56px] w-full px-6 text-[19px]',
        touch: 'min-h-11 px-1',
        icon: 'size-11 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button };
