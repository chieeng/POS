import type { Category, Product } from '@/features/catalog/data';
import { ProductPhoto } from '@/features/catalog/ProductPhoto';
import { formatPeso } from '@/lib/money';
import { currentValue, type ApprovalRequest } from './data';

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  sku: 'SKU',
  category_id: 'Category',
  unit: 'Unit',
  sell_price: 'Price',
  reorder_level: 'Reorder level',
  active: 'Status',
  photo_key: 'Photo',
};

const ORDER = [
  'name',
  'sku',
  'category_id',
  'unit',
  'sell_price',
  'reorder_level',
  'active',
  'photo_key',
];

/** A request field's value as the store would say it. */
function fieldText(key: string, value: unknown, categories: Category[]): string {
  if (value === null || value === undefined) return '—';
  if (key === 'sell_price') return formatPeso(Number(value));
  if (key === 'active') return value === true ? 'Active' : 'Inactive';
  if (key === 'category_id') {
    const category = categories.find((row) => row.id === value);
    return category ? `${category.name}${category.active ? '' : ' (inactive)'}` : '—';
  }
  return String(value);
}

/**
 * What a request changes, field by field: now and requested, plus the value when the request
 * was made if the product changed since (outdated).
 */
export function RequestChanges({
  request,
  product,
  categories,
  outdated,
}: {
  request: ApprovalRequest;
  product: Product | undefined;
  categories: Category[];
  outdated: boolean;
}) {
  const keys = ORDER.filter((key) => key in request.after);
  const decided = request.status !== 'pending';
  const cell = (key: string, value: unknown) =>
    key === 'photo_key' ? (
      typeof value === 'string' ? (
        <ProductPhoto
          productId={request.productId}
          photoKey={value}
          size={200}
          className="size-[56px] rounded-[12px]"
          alt="Photo"
        />
      ) : (
        'No photo'
      )
    ) : (
      fieldText(key, value, categories)
    );
  return (
    <table className="w-full border-collapse text-left text-[14px]">
      <thead>
        <tr className="text-[12px] text-neutral-700">
          <th scope="col" className="py-[4px] pr-[10px] font-semibold">
            Field
          </th>
          <th scope="col" className="py-[4px] pr-[10px] font-semibold">
            {decided ? 'Was' : outdated ? 'When asked' : 'Now'}
          </th>
          {outdated && !decided && (
            <th scope="col" className="py-[4px] pr-[10px] font-semibold">
              Now
            </th>
          )}
          <th scope="col" className="py-[4px] font-semibold">
            Requested
          </th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key} className="border-t border-text/8 align-top">
            <th scope="row" className="py-[6px] pr-[10px] font-normal text-neutral-700">
              {FIELD_LABELS[key] ?? key}
            </th>
            <td className="py-[6px] pr-[10px]">{cell(key, request.before[key])}</td>
            {outdated && !decided && (
              <td className="py-[6px] pr-[10px] font-semibold text-warn-fg">
                {product ? cell(key, currentValue(product, key)) : '—'}
              </td>
            )}
            <td className="py-[6px] font-semibold">{cell(key, request.after[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
