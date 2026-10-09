import * as React from 'react';
import { cn } from '@/lib/utils';

const LENGTH = 6;

interface CodeInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}

/**
 * Six code boxes backed by one real input, so paste, autofill and screen readers behave
 * like a normal text field.
 */
export const CodeInput = React.forwardRef<HTMLInputElement, CodeInputProps>(
  ({ value, onChange, invalid = false, className, onFocus, onBlur, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false);
    const activeIndex = Math.min(value.length, LENGTH - 1);

    return (
      <div className={cn('relative flex gap-[8px]', className)}>
        {Array.from({ length: LENGTH }, (_, index) => (
          <div
            key={index}
            aria-hidden
            className={cn(
              'grid h-[62px] flex-1 place-items-center rounded-[20px] border border-divider bg-surface font-heading text-[28px]',
              focused && index === activeIndex && 'border-2 border-accent',
              invalid && 'border-2 border-danger',
            )}
          >
            {value[index] ?? ''}
          </div>
        ))}
        <input
          ref={ref}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, LENGTH))}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d*"
          maxLength={LENGTH}
          aria-invalid={invalid || undefined}
          className="absolute inset-0 size-full cursor-text rounded-[20px] opacity-0"
          {...props}
        />
      </div>
    );
  },
);
CodeInput.displayName = 'CodeInput';
