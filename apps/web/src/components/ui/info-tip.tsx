import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Round 3 (SRS 7.2): help, rules and explanations sit behind a small (i). Tap to open, tap
 * again, outside or Escape to close. Never for amounts, red warnings, unsent sales or Fix
 * buttons: those stay on screen.
 */
export function InfoTip({
  label,
  children,
  align = 'start',
  className,
}: {
  /** What the help is about, read out with the button ("About deals"). */
  label: string;
  children: ReactNode;
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className={cn('relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        className="-m-[10px] grid size-[42px] place-items-center rounded-full font-body text-neutral-700 hover:text-text"
      >
        <span
          aria-hidden
          className="grid size-[22px] place-items-center rounded-full border-[1.5px] border-current text-[12px] leading-none font-bold"
        >
          i
        </span>
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className={cn(
            'absolute top-full z-40 mt-[8px] w-[min(270px,calc(100vw-40px))] rounded-[12px] bg-text px-[14px] py-[12px] text-left font-body text-[13.5px] leading-[1.45] font-normal tracking-normal text-bg normal-case shadow-[var(--shadow-lg)]',
            align === 'end' ? 'right-[-10px]' : 'left-[-10px]',
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
