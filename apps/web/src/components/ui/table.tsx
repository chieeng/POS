import * as React from 'react';
import { cn } from '@/lib/utils';

/** The design system's data table. Put it inside a `Card size="panel"`. */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-[14px]', className)} {...props} />
    </div>
  );
}

export function TableHeader(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TableRow({
  className,
  selected = false,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        '[tbody_&]:hover:bg-text/4',
        selected && 'bg-accent-100 [tbody_&]:hover:bg-accent-100',
        className,
      )}
      {...props}
    />
  );
}

interface CellProps {
  /** Right-aligned with tabular figures, for money and counts. */
  numeric?: boolean;
}

export function TableHead({
  className,
  numeric = false,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-divider p-2 text-left align-middle text-[11px] font-normal tracking-[0.08em] text-text/60 uppercase',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  numeric = false,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <td
      className={cn(
        'border-b border-text/8 p-2 align-middle',
        numeric && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  );
}
