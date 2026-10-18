import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';

// The Products list joins these tabs in the next step of the catalog.
const TABS = [
  { to: 'categories', label: 'Categories' },
  { to: 'suppliers', label: 'Suppliers' },
];

/** Products area (SRS 3.2): the Owner and Special Sales. */
export function CatalogLayout() {
  return (
    <div className="flex w-full max-w-[760px] flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      <h1 className="text-[28px] md:text-[30px]">Products</h1>
      <nav aria-label="Products" className="flex flex-wrap gap-[6px]">
        {TABS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex min-h-[40px] items-center rounded-full px-[16px] text-[14px] text-text no-underline',
                isActive ? 'bg-accent font-bold text-bg' : 'bg-surface hover:bg-text/7',
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
