import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn, ICON_STROKE } from '@/lib/utils';

interface PageHeaderProps {
  title: ReactNode;
  /** Where the back button goes. On tablets and laptops it shows only if `alwaysBack`. */
  backTo: string;
  backLabel: string;
  alwaysBack?: boolean;
  children?: ReactNode;
}

export function PageHeader({ title, backTo, backLabel, alwaysBack, children }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-[10px]">
      <Button
        asChild
        variant="secondary"
        size="icon"
        className={cn('flex-none', !alwaysBack && 'md:hidden')}
      >
        <Link to={backTo} aria-label={backLabel}>
          <ArrowLeft size={18} strokeWidth={ICON_STROKE} aria-hidden />
        </Link>
      </Button>
      <h1 className="min-w-0 flex-1 text-[24px] md:text-[26px] xl:text-[30px]">{title}</h1>
      {children}
    </div>
  );
}
