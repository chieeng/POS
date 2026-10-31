import { cn } from '@/lib/utils';
import { Button } from './button';

interface LoadMoreProps {
  /** Rows shown so far. */
  shown: number;
  /** All matching rows, from the first page's count; unknown while loading. */
  total?: number;
  loading?: boolean;
  onLoadMore: () => void;
  className?: string;
}

/**
 * The end of a paged list. Lists load in pages (the API returns at most 300 rows), so
 * every list ends with this instead of silently stopping.
 */
export function LoadMore({ shown, total, loading = false, onLoadMore, className }: LoadMoreProps) {
  const more = total === undefined || shown < total;
  if (total !== undefined && total === 0) return null;
  return (
    <div className={cn('flex flex-col items-center gap-2 py-3', className)}>
      {total !== undefined && (
        <p role="status" className="m-0 text-[13px] text-neutral-700">
          Showing {shown.toLocaleString('en-PH')} of {total.toLocaleString('en-PH')}
        </p>
      )}
      {more && (
        <Button
          variant="secondary"
          size="md"
          disabled={loading}
          onClick={onLoadMore}
          className="w-full md:w-auto"
        >
          {loading ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
