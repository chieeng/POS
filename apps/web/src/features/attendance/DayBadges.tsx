import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';
import type { DayParts } from './dayRow';

/** The one-tag row of a day (see dayRow.ts): its tags, "+N", and the details behind it. */

const moreClass =
  'inline-flex items-center rounded-[6px] border border-divider px-[7px] py-[2px] text-[12px] font-bold text-neutral-700';

/**
 * The tags and "+N". With `onToggle` the "+N" is a button that opens the details; without
 * it (a row that is itself a link) it is only a count.
 */
export function DayTags({
  parts,
  open = false,
  onToggle,
  label,
  className,
}: {
  parts: DayParts;
  open?: boolean;
  onToggle?: () => void;
  /** The day or person, for the button's name: "2 more for Sun, Nov 22". */
  label?: string;
  className?: string;
}) {
  const count = parts.more.length;
  if (parts.tags.length === 0 && count === 0) return null;
  const name = `${count} more${label ? ` for ${label}` : ''}`;
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-[6px]', className)}>
      {parts.tags.map((tag) => (
        <StatusBadge key={tag.text} tone={tag.tone}>
          {tag.text}
        </StatusBadge>
      ))}
      {count > 0 &&
        (onToggle ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={name}
            onClick={onToggle}
            className={cn(
              moreClass,
              // A 44 px tap target around the small chip.
              'relative cursor-pointer bg-transparent before:absolute before:-inset-[12px] before:content-[""] hover:bg-text/6',
              open && 'bg-text/6',
            )}
          >
            +{count}
          </button>
        ) : (
          <span className={moreClass} aria-label={name}>
            +{count}
          </span>
        ))}
    </span>
  );
}

/** The details behind "+N", one per line. */
export function DayMore({ parts, className }: { parts: DayParts; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-[10px] bg-text/6 px-[12px] py-[8px] text-[13px] leading-[1.5] break-words',
        className,
      )}
    >
      {parts.more.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
}
