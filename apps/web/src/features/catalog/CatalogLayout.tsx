import { NavLink, Outlet, useMatch } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useSession } from '@/stores/session';

/**
 * Products area (SRS 3.2). Everyone sees the product list; the Owner and Special Sales also
 * manage categories and suppliers. A product's page and Add product have their own header.
 */
export function CatalogLayout() {
  const role = useSession((s) => s.user?.role);
  const manages = role === 'owner' || role === 'special_sales';
  const atList = useMatch('/products') !== null;
  const atCategories = useMatch('/products/categories') !== null;
  const atSuppliers = useMatch('/products/suppliers') !== null;
  const showTabs = atList || atCategories || atSuppliers;

  const tabs = [
    { to: '/products', label: 'Products', end: true },
    ...(manages
      ? [
          { to: '/products/categories', label: 'Categories', end: false },
          { to: '/products/suppliers', label: 'Suppliers', end: false },
        ]
      : []),
  ];

  return (
    <div className="flex w-full max-w-[860px] flex-col gap-[14px] p-[14px] md:px-[26px] md:py-[22px] xl:py-[28px] xl:pl-[16px]">
      {showTabs && (
        <>
          <h1 className="text-[28px] md:text-[30px]">Products</h1>
          {tabs.length > 1 && (
            <nav aria-label="Products" className="flex flex-wrap gap-[6px]">
              {tabs.map(({ to, label, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
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
          )}
        </>
      )}
      <Outlet />
    </div>
  );
}
