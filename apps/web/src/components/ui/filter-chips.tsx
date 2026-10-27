import { ChevronDown, X, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { cn, ICON_STROKE } from '@/lib/utils';

/** A row of filter chips: scrolls sideways on phones, wraps on laptops. */
export function FilterChips({
  className,
  label,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { label: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        '-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] xl:mx-0 xl:flex-wrap xl:overflow-visible xl:px-0',
        className,
      )}
      {...props}
    />
  );
}

interface FilterChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  icon?: LucideIcon;
  count?: number;
  /** Shows a chevron: the chip opens a menu. */
  menu?: boolean;
  /** Shows an × on a selected chip; called instead of onClick when pressed. */
  onClear?: () => void;
}

export function FilterChip({
  selected = false,
  icon: Icon,
  count,
  menu = false,
  onClear,
  className,
  children,
  onClick,
  type = 'button',
  ...props
}: FilterChipProps) {
  const clearable = selected && onClear;
  return (
    <button
      type={type}
      aria-pressed={menu ? undefined : selected}
      onClick={clearable ? () => onClear() : onClick}
      className={cn(
        'flex h-10 flex-none items-center gap-1.5 rounded-full px-[14px] text-[14px] whitespace-nowrap',
        selected
          ? 'bg-text font-semibold text-bg'
          : 'border border-divider hover:bg-text/7 active:bg-text/14',
        className,
      )}
      {...props}
    >
      {Icon && <Icon size={15} strokeWidth={ICON_STROKE} aria-hidden />}
      {children}
      {count !== undefined && <span>{` · ${count}`}</span>}
      {menu && <ChevronDown size={14} strokeWidth={ICON_STROKE} aria-hidden />}
      {clearable && (
        <>
          <X size={14} strokeWidth={ICON_STROKE} aria-hidden />
          <span className="sr-only">, clear</span>
        </>
      )}
    </button>
  );
}
