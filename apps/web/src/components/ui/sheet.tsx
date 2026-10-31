import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { DialogContent, DialogOverlay } from './dialog';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

/** Tailwind's `md` breakpoint, where the phone layout ends. */
export const WIDE_QUERY = '(min-width: 48rem)';

/**
 * A bottom sheet on phones and a centered dialog from tablet width up, so one component
 * serves both layouts the screens show.
 */
const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const wide = useMediaQuery(WIDE_QUERY);
  if (wide) {
    return (
      <DialogContent ref={ref} className={className} {...props}>
        {children}
      </DialogContent>
    );
  }
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-24px)] flex-col gap-[14px] overflow-y-auto rounded-t-[32px] border border-b-0 border-overlay-edge bg-bg px-[18px] pb-[22px] shadow-[var(--shadow-lg)]',
          className,
        )}
        {...props}
      >
        <div
          aria-hidden
          className="mx-auto mt-[10px] h-[5px] w-[44px] flex-none rounded-full bg-neutral-400"
        />
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
SheetContent.displayName = 'SheetContent';

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-heading text-[24px] leading-[1.15]', className)}
    {...props}
  />
));
SheetTitle.displayName = 'SheetTitle';

export { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger };
export { DialogActions as SheetActions, DialogDescription as SheetDescription } from './dialog';
