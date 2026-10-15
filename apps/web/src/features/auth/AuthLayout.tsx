import type { ReactNode } from 'react';
import { env } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface AuthLayoutProps {
  children: ReactNode;
  /** Phone only: show the big POS wordmark above the form (sign-in), or not (code steps). */
  phoneBrand?: boolean;
}

/**
 * Sign-in frame from the design: on phones a single column with the wordmark on top and the
 * form at the bottom; from tablet width up, a brand panel on the left and the form on the right.
 */
export function AuthLayout({ children, phoneBrand = false }: AuthLayoutProps) {
  const storeName = env.storeName;
  const storeAddress = env.storeAddress;

  return (
    <div className="min-h-dvh bg-bg md:grid md:grid-cols-2">
      {/* Tablet and laptop: brand panel */}
      <aside className="relative hidden flex-col justify-end overflow-hidden bg-surface p-[48px] md:flex">
        <div
          aria-hidden
          className="absolute top-[-80px] left-[-80px] size-[360px] rounded-full bg-accent-200"
        />
        <div
          aria-hidden
          className="absolute top-[200px] right-[60px] size-[140px] rounded-full bg-accent-2-200"
        />
        <div className="relative font-heading text-[88px] leading-none">POS</div>
        {(storeName || storeAddress) && (
          <div className="relative mt-[8px] text-[17px] text-neutral-800">
            {storeName}
            {storeName && storeAddress && <br />}
            {storeAddress}
          </div>
        )}
      </aside>

      <main
        className={cn(
          'relative flex min-h-dvh flex-col overflow-hidden px-[24px] pb-[28px]',
          'md:justify-center md:px-[64px] md:py-[48px]',
          !phoneBrand && 'pt-[24px]',
        )}
      >
        {phoneBrand && (
          <div className="md:hidden">
            <div
              aria-hidden
              className="absolute top-[-70px] right-[-90px] size-[280px] rounded-full bg-accent-200"
            />
            <div
              aria-hidden
              className="absolute top-[120px] right-[40px] size-[90px] rounded-full bg-accent-2-200"
            />
            <div className="relative mt-[clamp(96px,26dvh,220px)] font-heading text-[64px] leading-none">
              POS
            </div>
            {storeName && (
              <div className="relative mt-[6px] text-[15px] text-neutral-700">{storeName}</div>
            )}
          </div>
        )}
        <div className="relative flex w-full flex-1 flex-col md:mx-auto md:max-w-[480px] md:flex-none">
          {children}
        </div>
      </main>
    </div>
  );
}
