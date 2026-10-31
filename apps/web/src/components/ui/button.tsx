import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { useOnline } from '@/hooks/useOnline';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-transparent font-heading text-[14px] leading-[1.2] text-text no-underline disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-bg hover:bg-accent-600 active:bg-accent-700',
        secondary: 'border-divider hover:bg-text/7 active:bg-text/14',
        ghost: 'text-accent hover:bg-accent/10 active:bg-accent/18',
        // Secondary with red text, for Reject. Quiet buttons take `text-danger-fg` instead.
        danger: 'border-divider text-danger-fg hover:bg-text/7 active:bg-text/14',
        // Text-style action in the body face, as used under the sign-in and lock forms.
        quiet:
          'font-body font-semibold text-accent-700 hover:bg-accent/10 active:bg-accent/18 text-[15px]',
      },
      size: {
        default: 'px-[15.84px] py-2',
        // The 44 px touch target the screens use for toolbar and row actions.
        md: 'min-h-11 px-4',
        lg: 'min-h-[56px] w-full px-6 text-[19px]',
        // Quiet text actions only: a 44 px target with almost no padding.
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
  /**
   * The action needs the server (NFR-02: only checkout, clock-in and product search work
   * offline). Offline, the button is disabled and says "Needs internet" beside it.
   */
  needsInternet?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, needsInternet = false, type, ...props }, ref) => {
    const online = useOnline();
    const hintId = React.useId();
    if (needsInternet && !online) {
      // A link styled as a button becomes a disabled button with the same label.
      const { children, ...rest } = props;
      const label =
        asChild && React.isValidElement<{ children?: React.ReactNode }>(children)
          ? children.props.children
          : children;
      return (
        <span className="contents">
          <button
            ref={ref}
            {...(asChild ? {} : rest)}
            type="button"
            disabled
            aria-describedby={hintId}
            className={cn(buttonVariants({ variant, size }), className)}
          >
            {label}
          </button>
          <span id={hintId} className="text-[12.5px] text-neutral-700">
            Needs internet
          </span>
        </span>
      );
    }
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
