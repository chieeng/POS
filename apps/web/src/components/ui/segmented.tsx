import { useId } from 'react';
import { cn } from '@/lib/utils';

interface SegmentedProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

/** The design system's segmented control, built on native radio buttons. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className,
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'flex overflow-hidden rounded-full border border-divider',
        disabled && 'opacity-45',
        className,
      )}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex min-h-[46px] flex-1 cursor-pointer items-center justify-center px-3 text-[14px]',
            'border-l border-divider first:border-l-0',
            'has-[:checked]:bg-accent has-[:checked]:text-bg has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-accent',
            !disabled && 'not-has-[:checked]:hover:bg-text/7',
            disabled && 'cursor-not-allowed',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
