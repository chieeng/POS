import { Link } from 'react-router-dom';
import { useProducts } from '@/features/catalog/data';
import { isLowStock } from './data';

const SHOWN = 10;

/** INV-05: on the Owner's home, the products at or below their reorder level, lowest first. */
export function LowStockCard() {
  const products = useProducts();
  if (products.loading || products.error) return null;
  const low = products.data
    .filter(isLowStock)
    .sort((a, b) => a.stockQty - a.reorderLevel - (b.stockQty - b.reorderLevel));

  return (
    <section
      aria-labelledby="low-stock"
      className="flex w-full max-w-[560px] flex-col gap-[8px] rounded-[30px] bg-surface px-[18px] py-[16px]"
    >
      <h2
        id="low-stock"
        className="font-body text-[12px] font-bold tracking-[0.08em] text-neutral-700 uppercase"
      >
        Low stock · {low.length}
      </h2>
      {low.length === 0 ? (
        <p className="text-[14px] text-neutral-700">Nothing is at or below its reorder level.</p>
      ) : (
        <>
          <ul className="flex flex-col">
            {low.slice(0, SHOWN).map((product) => (
              <li
                key={product.id}
                className="flex items-baseline gap-[10px] border-b border-text/8 py-[7px] text-[14px] last:border-b-0"
              >
                <Link to={`/products/${product.id}`} className="min-w-0 flex-1 truncate">
                  {product.name}
                </Link>
                <span className="font-semibold">
                  {product.stockQty} {product.unit}
                </span>
                <span className="text-[12.5px] text-neutral-700">
                  reorder at {product.reorderLevel}
                </span>
              </li>
            ))}
          </ul>
          {low.length > SHOWN && (
            <Link to="/products?low=1" className="text-[14px]">
              All {low.length} low-stock products
            </Link>
          )}
        </>
      )}
    </section>
  );
}
