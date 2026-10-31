import { cva, type VariantProps } from 'class-variance-authority';
import { Minus, Plus } from 'lucide-react';
import { cn, ICON_STROKE } from '@/lib/utils';

const stepperVariants = cva('flex items-center justify-between rounded-full', {
  variants: {
    size: {
      default: 'h-11 w-[130px] border border-divider px-1 text-[16px] font-bold',
      // The adjust-stock sheet: one big number to get right.
      lg: 'h-16 w-full border-2 border-accent px-2 font-heading text-[30px]',
    },
    // Where the stepper sits: on the page it is a surface pill, inside a card a page-color one.
    on: {
      page: 'bg-surface',
      card: 'bg-bg',
    },
  },
  defaultVariants: { size: 'default', on: 'page' },
});

const buttonSizes = { default: 'size-9', lg: 'size-12 bg-bg' };

interface StepperProps extends VariantProps<typeof stepperVariants> {
  /** What is being counted, e.g. "Pieces"; names the control for screen readers. */
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}

/** A − value + control for whole quantities. */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  disabled = false,
  size,
  on,
  className,
}: StepperProps) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  const buttonClass = cn(
    'grid flex-none place-items-center rounded-full hover:bg-text/7 active:bg-text/14 disabled:cursor-not-allowed disabled:opacity-45',
    buttonSizes[size ?? 'default'],
  );
  const iconSize = size === 'lg' ? 18 : 15;
  return (
    <div
      className={cn(stepperVariants({ size, on }), disabled && 'opacity-45', className)}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
          event.preventDefault();
          set(value + 1);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
          event.preventDefault();
          set(value - 1);
        }
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Less ${label.toLowerCase()}`}
        disabled={disabled || value <= min}
        onClick={() => set(value - 1)}
        className={buttonClass}
      >
        <Minus size={iconSize} strokeWidth={ICON_STROKE} aria-hidden />
      </button>
      <span
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max === Number.MAX_SAFE_INTEGER ? undefined : max}
        aria-disabled={disabled || undefined}
        className="min-w-[2ch] rounded-full px-1 text-center tabular-nums"
      >
        {value}
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`More ${label.toLowerCase()}`}
        disabled={disabled || value >= max}
        onClick={() => set(value + 1)}
        className={buttonClass}
      >
        <Plus size={iconSize} strokeWidth={ICON_STROKE} aria-hidden />
      </button>
    </div>
  );
}
