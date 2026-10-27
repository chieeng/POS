import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import * as React from 'react';
import { cn, ICON_STROKE } from '@/lib/utils';

/** A 24 px rounded square: accent fill when checked, neutral-500 outline when not. */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'grid size-6 flex-none cursor-pointer place-items-center rounded-sm border-[1.5px] border-neutral-500 text-bg',
      'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
      'disabled:cursor-not-allowed disabled:opacity-45',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator>
      <Check size={15} strokeWidth={ICON_STROKE} aria-hidden />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

/** A checkbox with its label, sized to a 44 px touch target. */
export function CheckboxField({
  label,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { label: React.ReactNode }) {
  const id = React.useId();
  return (
    <div className={cn('flex min-h-11 items-center gap-[10px] text-[14.5px]', className)}>
      <Checkbox id={id} {...props} />
      <label htmlFor={id} className="cursor-pointer">
        {label}
      </label>
    </div>
  );
}

export { Checkbox };
