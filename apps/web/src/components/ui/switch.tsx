import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as React from 'react';
import { cn } from '@/lib/utils';

/** 52 × 30 track, accent when on. The off state isn't drawn in the design: neutral-400. */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'relative inline-flex h-[30px] w-[52px] flex-none cursor-pointer items-center rounded-full bg-neutral-400 data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-45',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-6 translate-x-[3px] rounded-full bg-bg shadow-sm transition-transform data-[state=checked]:translate-x-[25px] motion-reduce:transition-none" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

export { Switch };
