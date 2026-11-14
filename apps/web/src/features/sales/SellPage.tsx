import {
  ChevronUp,
  CircleAlert,
  Minus,
  Percent,
  Plus,
  Scale,
  Search,
  ShoppingBasket,
  Tags,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, AlertAction } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { FilterChip, FilterChips } from '@/components/ui/filter-chips';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadMore } from '@/components/ui/load-more';
import { Sheet, SheetContent, SheetTitle, WIDE_QUERY } from '@/components/ui/sheet';
import { useCategories, useProducts, type Product } from '@/features/catalog/data';
import { ProductPhoto } from '@/features/catalog/ProductPhoto';
import { useDrawerToday } from '@/features/drawer/data';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useOnline } from '@/hooks/useOnline';
import { formatPeso } from '@/lib/money';
import { formatQty, isSoldByMeasure, MAX_QTY, minQty, parseQty, qtyWithUnit } from '@/lib/quantity';
import { cn, ICON_STROKE } from '@/lib/utils';
import { useSession } from '@/stores/session';
import { useBranch, usePaymentAccounts } from '@/features/store/data';
import { useDeals } from '@/features/deals/data';
import { dealSummary, inDeal, type DealRule } from '@/features/deals/rules';
import { useDiscounts } from '@/features/discounts/data';
import {
  discountCents,
  lineDiscount,
  ruleAmount,
  rulesFor,
  type DiscountRule,
} from '@/features/discounts/rules';
import { cartLinesFor, useCart, type CartLine } from './cart';
import {
  rememberedSettings,
  rememberSettings,
  settingsFrom,
  type Slip,
  type SoldLine,
} from './checkout';
import { PaymentSheet } from './PaymentSheet';
import { priceCart, type Pricing } from './pricing';
import { SaleSlip } from './SaleSlip';
import { itemCount, lineWarning, sellResults, stockState, type StockState } from './sell';
import { lineTotalCents } from './totals';

// Products drawn at a time; the rest come with "Load more" (SRS 7.2).
const PAGE = 60;

/**
 * Sell (POS-01, POS-02): find products by name, SKU or category and build the cart. Works
 * offline from the product list saved on this device (NFR-01, NFR-02); payment and the slip
 * too (POS-04, POS-07). No Hold yet (step 15), and no typed discounts: staff never type one
 * (POS-03); preset deals arrive later in step 9.
 */
export function SellPage() {
  const user = useSession((s) => s.user);
  const products = useProducts({ live: true });
  const categories = useCategories();
  const wide = useMediaQuery(WIDE_QUERY);
  const cart = useCart();
  const lines = cartLinesFor(cart, user?.uid);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [weighing, setWeighing] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [slip, setSlip] = useState<Slip | null>(null);
  const { branch } = useBranch();
  const accounts = usePaymentAccounts();
  const discounts = useDiscounts();
  const deals = useDeals();

  // A new search or category starts again from the top.
  const changeSearch = (value: string) => {
    setSearch(value);
    setShown(PAGE);
  };
  const changeCategory = (value: string | null) => {
    setCategoryId(value);
    setShown(PAGE);
  };

  const byId = useMemo(
    () => new Map(products.data.map((product) => [product.id, product])),
    [products.data],
  );
  const results = useMemo(
    () => sellResults(products.data, search, categoryId),
    [products.data, search, categoryId],
  );
  // Only categories that have something to sell.
  const chips = useMemo(() => {
    const used = new Set(products.data.filter((p) => p.active).map((p) => p.categoryId));
    return categories.data
      .filter((category) => used.has(category.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }, [categories.data, products.data]);

  const qtyInCart = (productId: string) =>
    lines.find((line) => line.productId === productId)?.qty ?? 0;

  const tap = (product: Product) => {
    if (!user) return;
    // The first item of a new cart only adds; the cart sheet stays shut until staff open it
    // (it may still be marked open from the last cart, emptied or paid from the sheet).
    if (lines.length === 0) setCartOpen(false);
    if (isSoldByMeasure(product.unit)) setWeighing(product);
    else cart.add(user.uid, product);
  };

  const count = itemCount(lines, (id) => byId.get(id)?.unit);

  // POS-03, POS-04, POS-07: the store's settings, accounts, preset discounts and deals, live
  // while online and remembered on the device for offline sales.
  const live =
    branch &&
    !accounts.loading &&
    !accounts.error &&
    !discounts.loading &&
    !discounts.error &&
    !deals.loading &&
    !deals.error;
  const settings = useMemo(
    () =>
      live ? settingsFrom(branch, accounts.data, discounts.data, deals.data) : rememberedSettings(),
    [live, branch, accounts.data, discounts.data, deals.data],
  );
  useEffect(() => {
    if (live) rememberSettings(settings);
  }, [live, settings]);

  const pricing = priceCart(lines, byId, settings.discounts, settings.deals);
  const sold: SoldLine[] = lines.flatMap((line) => {
    const product = byId.get(line.productId);
    if (!product) return [];
    const discount = pricing.perLine.get(line.productId);
    return [{ product, qty: line.qty, ...(discount ? { discount } : {}) }];
  });
  const totalCents = pricing.subtotalCents - pricing.discountCents;
  const cartProps = {
    lines,
    byId,
    rules: settings.discounts,
    pricing,
    totalCents,
    onPay: () => startPayment(),
  };
  const startPayment = () => {
    setCartOpen(false);
    setPaying(true);
  };

  if (slip) {
    return (
      <SaleSlip
        slip={slip}
        onNewSale={() => {
          setSlip(null);
          setCartOpen(false);
          changeSearch('');
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-[10px] px-[16px] pt-[2px] pb-[160px] md:px-[20px] md:pt-[16px] md:pb-[20px] xl:px-[24px] xl:pt-[22px]">
        <DrawerBanner />
        <div className="relative">
          <Search
            size={19}
            strokeWidth={ICON_STROKE}
            className="pointer-events-none absolute top-1/2 left-[16px] -translate-y-1/2 text-neutral-700"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search name or SKU"
            placeholder="Search name or SKU"
            autoFocus={wide}
            autoComplete="off"
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
            className="min-h-[48px] rounded-full border-[1.5px] border-accent bg-surface pl-[44px] text-[15px]"
          />
        </div>
        {chips.length > 0 && (
          <FilterChips label="Categories">
            <FilterChip selected={categoryId === null} onClick={() => changeCategory(null)}>
              All
            </FilterChip>
            {chips.map((category) => (
              <FilterChip
                key={category.id}
                selected={categoryId === category.id}
                onClick={() => changeCategory(category.id)}
              >
                {category.name}
              </FilterChip>
            ))}
          </FilterChips>
        )}

        {products.loading && products.data.length === 0 ? (
          <p role="status" className="py-[20px] text-neutral-700">
            Loading products…
          </p>
        ) : products.error && products.data.length === 0 ? (
          <Alert variant="danger">
            <b>Couldn&apos;t load the products.</b> Check your connection and reload.
          </Alert>
        ) : results.length === 0 ? (
          <p role="status" className="py-[20px] text-neutral-700">
            {search.trim() ? `No product matches “${search.trim()}”.` : 'No products to sell yet.'}
          </p>
        ) : (
          <>
            <ul
              aria-label="Products"
              className="flex flex-col md:grid md:grid-cols-3 md:gap-[10px] xl:grid-cols-4 xl:gap-[12px]"
            >
              {results.slice(0, shown).map((product) => (
                <ProductItem
                  key={product.id}
                  product={product}
                  inCart={qtyInCart(product.id)}
                  onTap={() => tap(product)}
                />
              ))}
            </ul>
            <LoadMore
              shown={Math.min(shown, results.length)}
              total={results.length}
              onLoadMore={() => setShown((value) => value + PAGE)}
            />
          </>
        )}
      </div>

      {/* Tablet and laptop: the cart beside the products. */}
      <aside
        aria-label="Cart"
        className="sticky top-0 hidden h-dvh w-[360px] flex-none flex-col gap-[10px] bg-neutral-100 px-[16px] pt-[16px] pb-[18px] md:flex xl:w-[400px] xl:px-[20px] xl:pt-[20px]"
      >
        <h2 className="font-heading text-[22px]">Cart{count > 0 ? ` · ${count}` : ''}</h2>
        <CartContents {...cartProps} />
      </aside>

      {/* Phone: a bar above the tabs that opens the cart as a sheet. */}
      {count > 0 && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="fixed right-[12px] bottom-[88px] left-[12px] z-30 flex h-[60px] items-center gap-[12px] rounded-full bg-text pr-[10px] pl-[22px] text-bg shadow-[var(--shadow-lg)] md:hidden"
        >
          <ShoppingBasket size={20} strokeWidth={ICON_STROKE} aria-hidden />
          <span className="flex-1 text-left text-[15px]">
            <b>
              {count} {count === 1 ? 'item' : 'items'}
            </b>{' '}
            · {formatPeso(totalCents / 100)}
          </span>
          <span className="flex h-[44px] items-center gap-[6px] rounded-full bg-accent px-[18px] font-heading text-[16px]">
            View cart
            <ChevronUp size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </span>
        </button>
      )}
      {!wide && (
        <Sheet open={cartOpen && count > 0} onOpenChange={setCartOpen}>
          <SheetContent aria-describedby={undefined} className="max-h-[calc(100dvh-60px)]">
            <SheetTitle>
              Cart · {count} {count === 1 ? 'item' : 'items'}
            </SheetTitle>
            <CartContents {...cartProps} />
          </SheetContent>
        </Sheet>
      )}

      {weighing && (
        <WeighDialog
          key={weighing.id}
          product={weighing}
          current={qtyInCart(weighing.id)}
          onClose={() => setWeighing(null)}
          onSave={(qty) => {
            if (user) {
              if (qtyInCart(weighing.id) > 0) cart.setQty(weighing.id, qty);
              else cart.add(user.uid, weighing, qty);
            }
            setWeighing(null);
          }}
        />
      )}

      {paying && (
        <PaymentSheet
          open
          onOpenChange={(open) => !open && setPaying(false)}
          lines={sold}
          settings={settings}
          onDone={(done) => {
            cart.clear();
            setPaying(false);
            setSlip(done);
          }}
        />
      )}
    </div>
  );
}

function ProductItem({
  product,
  inCart,
  onTap,
}: {
  product: Product;
  inCart: number;
  onTap: () => void;
}) {
  const state = stockState(product.stockQty, product.reorderLevel);
  const weighed = isSoldByMeasure(product.unit);
  return (
    <li className="border-b border-text/8 md:border-b-0">
      <button
        type="button"
        onClick={onTap}
        aria-label={`${product.name}, ${formatPeso(product.sellPrice)}${weighed ? ` per ${product.unit}` : ''}`}
        className="relative flex min-h-[64px] w-full items-center gap-[12px] py-[8px] text-left hover:bg-text/5 md:min-h-[132px] md:flex-col md:items-stretch md:gap-[6px] md:rounded-[24px] md:bg-surface md:p-[12px] md:hover:bg-surface/70"
      >
        <ProductPhoto
          productId={product.id}
          photoKey={product.photoKey}
          size={200}
          className="size-[40px] rounded-full md:size-[36px]"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
          <span className="truncate text-[15px] font-semibold md:whitespace-normal md:text-[14px] md:leading-[1.25]">
            {product.name}
          </span>
          <span className="flex items-center gap-[6px] text-[12.5px] text-neutral-700">
            <span className="md:hidden">{product.sku} ·</span>
            <StockNote product={product} state={state} />
          </span>
        </span>
        <span className="text-[15px] font-bold whitespace-nowrap">
          {formatPeso(product.sellPrice)}
          {weighed && <span className="text-[12.5px] font-normal">/{product.unit}</span>}
        </span>
        {inCart > 0 && (
          <span
            aria-label={`${formatQty(inCart)} in the cart`}
            className="grid h-[28px] min-w-[28px] place-items-center rounded-full bg-accent px-[8px] text-[13px] font-bold text-bg md:absolute md:top-[10px] md:right-[10px] md:h-[30px] md:min-w-[30px] md:text-[14px]"
          >
            {formatQty(inCart)}
          </span>
        )}
      </button>
    </li>
  );
}

function StockNote({ product, state }: { product: Product; state: StockState }) {
  if (state === 'out') {
    return (
      <span className="inline-flex items-center gap-[3px] font-bold text-danger-fg">
        <CircleAlert size={12} strokeWidth={ICON_STROKE} aria-hidden />
        Out of stock
      </span>
    );
  }
  const text = `${qtyWithUnit(product.stockQty, product.unit)} left`;
  if (state === 'low') {
    return (
      <span className="inline-flex items-center gap-[3px] font-bold text-warn-fg">
        <TriangleAlert size={12} strokeWidth={ICON_STROKE} aria-hidden />
        {text}
      </span>
    );
  }
  return <span>{text}</span>;
}

function CartContents({
  lines,
  byId,
  rules,
  pricing,
  totalCents,
  onPay,
}: {
  lines: CartLine[];
  byId: Map<string, Product>;
  rules: DiscountRule[];
  pricing: Pricing;
  totalCents: number;
  onPay: () => void;
}) {
  const { subtotalCents, discountCents } = pricing;
  // POS-03: staff apply a deal the cart offers; the app never adds one by itself.
  const applyDeal = (rule: DealRule) =>
    cart.applyDeal(
      rule.id,
      lines.flatMap((line) => {
        const product = byId.get(line.productId);
        return product &&
          inDeal(rule, product) &&
          pricing.perLine.get(line.productId)?.kind !== 'deal'
          ? [line.productId]
          : [];
      }),
    );
  const user = useSession((s) => s.user);
  const cart = useCart();
  const [weighing, setWeighing] = useState<Product | null>(null);
  const [discounting, setDiscounting] = useState<string | null>(null);
  const discountingLine = lines.find((line) => line.productId === discounting);
  const discountingProduct = discounting ? byId.get(discounting) : undefined;

  if (lines.length === 0) {
    return (
      <p className="py-[20px] text-[14px] text-neutral-700">
        The cart is empty. Tap a product to add it.
      </p>
    );
  }

  return (
    <>
      <ul
        aria-label="Cart lines"
        className="flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto"
      >
        {lines.map((line) => {
          const product = byId.get(line.productId);
          if (!product) return null;
          const weighed = isSoldByMeasure(product.unit);
          const warning = lineWarning(product, line.qty);
          const offers = rulesFor(rules, product);
          const discount = pricing.perLine.get(line.productId);
          const gross = lineTotalCents(line.qty, product.sellPrice);
          return (
            <li
              key={line.productId}
              aria-label={product.name}
              className="flex flex-col gap-[8px] rounded-[22px] bg-surface px-[14px] py-[12px] md:rounded-none md:border-b md:border-text/8 md:bg-transparent md:px-0 md:py-[10px]"
            >
              <div className="flex items-start gap-[10px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] leading-[1.3] font-semibold md:text-[14px]">
                    {product.name}
                  </div>
                  <div className="text-[13px] text-neutral-700 md:text-[12.5px]">
                    {formatPeso(product.sellPrice)} {weighed ? `per ${product.unit}` : 'each'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-bold md:text-[14px]">
                    {formatPeso((gross - Math.round((discount?.amount ?? 0) * 100)) / 100)}
                  </div>
                  {discount && discount.amount > 0 && (
                    <div className="text-[12.5px] font-semibold text-accent-2-700">
                      −{formatPeso(discount.amount)} · {discount.name}
                    </div>
                  )}
                  {discount && discount.amount === 0 && (
                    <div className="text-[12.5px] text-neutral-700">
                      In {discount.name}, regular price
                    </div>
                  )}
                </div>
              </div>
              {warning && (
                <div
                  className={cn(
                    'flex items-center gap-[6px] rounded-[12px] px-[10px] py-[6px] text-[12.5px] font-semibold md:rounded-none md:bg-transparent md:p-0 md:text-[12px] md:font-bold',
                    warning.kind === 'neg'
                      ? 'bg-danger-bg text-danger-fg'
                      : 'bg-warn-bg text-warn-fg',
                  )}
                >
                  {warning.kind === 'neg' ? (
                    <CircleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  ) : (
                    <TriangleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  )}
                  {warning.text}
                </div>
              )}
              <div className="flex items-center gap-[6px]">
                {weighed ? (
                  <Button
                    variant="secondary"
                    className="min-h-[44px] bg-bg px-[14px]"
                    onClick={() => setWeighing(product)}
                    aria-label={`Change the amount of ${product.name}`}
                  >
                    <Scale size={16} strokeWidth={ICON_STROKE} aria-hidden />
                    {qtyWithUnit(line.qty, product.unit)}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="bg-bg"
                      aria-label={`One less ${product.name}`}
                      disabled={line.qty <= 1}
                      onClick={() => cart.setQty(product.id, line.qty - 1)}
                    >
                      <Minus size={17} strokeWidth={ICON_STROKE} aria-hidden />
                    </Button>
                    <span
                      aria-label={`Quantity of ${product.name}`}
                      className="min-w-[36px] text-center text-[17px] font-bold"
                    >
                      {formatQty(line.qty)}
                    </span>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="bg-bg"
                      aria-label={`One more ${product.name}`}
                      disabled={line.qty >= MAX_QTY}
                      onClick={() => user && cart.add(user.uid, product)}
                    >
                      <Plus size={17} strokeWidth={ICON_STROKE} aria-hidden />
                    </Button>
                  </>
                )}
                <span className="flex-1" />
                {offers.length > 0 && (
                  <Button
                    variant="ghost"
                    className="min-h-[44px] px-[10px] font-body text-[13.5px] font-semibold text-accent-700"
                    aria-label={`Discount for ${product.name}`}
                    onClick={() => setDiscounting(product.id)}
                  >
                    <Percent size={15} strokeWidth={ICON_STROKE} aria-hidden />
                    Discount
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-neutral-800"
                  aria-label={`Remove ${product.name}`}
                  onClick={() => cart.remove(product.id)}
                >
                  <Trash2 size={18} strokeWidth={ICON_STROKE} aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {(pricing.applied.length > 0 || pricing.offers.length > 0) && (
        <section aria-label="Deals" className="flex flex-col gap-[6px]">
          {pricing.applied.map(({ rule, sets, saving }) => (
            <div
              key={rule.id}
              className="flex items-center gap-[10px] rounded-[18px] bg-accent-2-100 px-[14px] py-[8px] text-accent-2-800"
            >
              <Tags size={16} strokeWidth={ICON_STROKE} aria-hidden />
              <span className="min-w-0 flex-1 text-[13.5px] leading-[1.3]">
                <b>{rule.name}</b>
                <br />
                {sets} {sets === 1 ? 'set' : 'sets'} · −{formatPeso(saving)}
              </span>
              <Button
                variant="ghost"
                className="min-h-[44px] px-[10px] font-body text-[13.5px] font-semibold"
                aria-label={`Remove ${rule.name}`}
                onClick={() => cart.removeDeal(rule.id)}
              >
                Remove
              </Button>
            </div>
          ))}
          {pricing.offers.map(({ rule, saving }) => (
            <div
              key={rule.id}
              className="flex items-center gap-[10px] rounded-[18px] bg-accent-100 px-[14px] py-[8px]"
            >
              <Tags size={16} strokeWidth={ICON_STROKE} className="text-accent-700" aria-hidden />
              <span className="min-w-0 flex-1 text-[13.5px] leading-[1.3]">
                <b>Deal: {rule.name}</b>
                <br />
                {dealSummary(rule, (id) => byId.get(id)?.name)} · save {formatPeso(saving)}
              </span>
              <Button
                variant="secondary"
                className="min-h-[44px] px-[14px]"
                aria-label={`Apply ${rule.name}`}
                onClick={() => applyDeal(rule)}
              >
                Apply
              </Button>
            </div>
          ))}
        </section>
      )}
      <div className="flex flex-col gap-[6px] pt-[6px]">
        {discountCents > 0 && (
          <>
            <div className="flex justify-between text-[14px]">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatPeso(subtotalCents / 100)}</span>
            </div>
            <div className="flex justify-between text-[14px] text-accent-2-700">
              <span>Discount</span>
              <span className="tabular-nums">−{formatPeso(discountCents / 100)}</span>
            </div>
          </>
        )}
        <div className="flex items-baseline justify-between">
          <span className="text-[16px] font-bold">Total</span>
          <span className="font-heading text-[30px] md:text-[28px] xl:text-[32px]">
            {formatPeso(totalCents / 100)}
          </span>
        </div>
        <Button variant="money" className="min-h-[56px] w-full text-[20px]" onClick={onPay}>
          Pay {formatPeso(totalCents / 100)}
        </Button>
      </div>
      {weighing && (
        <WeighDialog
          key={weighing.id}
          product={weighing}
          current={lines.find((l) => l.productId === weighing.id)?.qty ?? 0}
          onClose={() => setWeighing(null)}
          onSave={(qty) => {
            cart.setQty(weighing.id, qty);
            setWeighing(null);
          }}
        />
      )}
      {discountingLine && discountingProduct && (
        <DiscountPicker
          product={discountingProduct}
          line={discountingLine}
          rules={rulesFor(rules, discountingProduct)}
          onPick={(id) => {
            cart.setDiscount(discountingProduct.id, id);
            setDiscounting(null);
          }}
          onClose={() => setDiscounting(null)}
        />
      )}
    </>
  );
}

/**
 * POS-03: staff pick one of the Owner's presets for a line, or none. Only the presets that fit
 * this product are offered; nothing is typed.
 */
function DiscountPicker({
  product,
  line,
  rules,
  onPick,
  onClose,
}: {
  product: Product;
  line: CartLine;
  rules: DiscountRule[];
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const current = lineDiscount(rules, line, product)?.id ?? null;
  const option = (id: string | null, title: string, detail: string, off: string | null) => (
    <button
      key={id ?? 'none'}
      type="button"
      role="radio"
      aria-checked={current === id}
      onClick={() => onPick(id)}
      className={cn(
        'flex min-h-[56px] w-full items-center gap-[12px] rounded-[20px] px-[16px] py-[10px] text-left',
        current === id ? 'bg-accent-100 ring-[1.5px] ring-accent' : 'bg-surface hover:bg-text/5',
      )}
    >
      <span className="min-w-0 flex-1">
        <b className="block text-[15px]">{title}</b>
        <span className="block text-[13px] text-neutral-700">{detail}</span>
      </span>
      {off && <span className="font-bold whitespace-nowrap text-accent-2-700">{off}</span>}
    </button>
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Discount for {product.name}</DialogTitle>
        <DialogDescription>
          {qtyWithUnit(line.qty, product.unit)} ·{' '}
          {formatPeso(lineTotalCents(line.qty, product.sellPrice) / 100)} before any discount
        </DialogDescription>
        <div role="radiogroup" aria-label="Discounts" className="flex flex-col gap-[8px]">
          {option(null, 'No discount', 'The regular price', null)}
          {rules.map((rule) =>
            option(
              rule.id,
              rule.name,
              ruleAmount(rule, product.unit),
              `−${formatPeso(discountCents(rule, line.qty, product.sellPrice) / 100)}`,
            ),
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A product sold by weight or volume: "How many kg?" (PROD-01, up to 3 decimals). */
function WeighDialog({
  product,
  current,
  onClose,
  onSave,
}: {
  product: Product;
  current: number;
  onClose: () => void;
  onSave: (qty: number) => void;
}) {
  // Re-mounted for each product (its key), so it starts from that product's amount.
  const [value, setValue] = useState(current > 0 ? formatQty(current) : '');
  const [error, setError] = useState<string | null>(null);
  const unit = product.unit;
  const qty = parseQty(value, unit);
  const ok = qty !== null && qty >= minQty(unit) && qty <= MAX_QTY;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ok || qty === null) {
      setError(`Enter the amount in ${unit}, up to 3 decimals, for example 1.25.`);
      return;
    }
    onSave(qty);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogTitle>How many {unit}?</DialogTitle>
        <DialogDescription>
          {product.name} · {formatPeso(product.sellPrice)} per {unit}
        </DialogDescription>
        <form onSubmit={submit} noValidate className="flex flex-col gap-[12px]">
          <div>
            <Label htmlFor="weigh-qty" className="text-[13px]">
              Amount ({unit})
            </Label>
            <Input
              id="weigh-qty"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              placeholder="1.25"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              aria-invalid={!!error || undefined}
              aria-describedby={error ? 'weigh-error' : 'weigh-total'}
              className="min-h-[48px] bg-surface text-[15px]"
            />
            {error ? (
              <p id="weigh-error" className="mt-[5px] text-[13px] text-danger-fg">
                {error}
              </p>
            ) : (
              <p id="weigh-total" className="mt-[5px] text-[13px] text-neutral-700">
                {ok && qty !== null
                  ? `${qtyWithUnit(qty, unit)} = ${formatPeso(lineTotalCents(qty, product.sellPrice) / 100)}`
                  : 'Up to 3 decimals, for example 0.5 or 1.25.'}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-[10px]">
            <Button type="submit" className="min-h-[48px] px-[22px]">
              {current > 0 ? 'Update cart' : 'Add to cart'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-[48px] px-[18px]"
              onClick={onClose}
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * POS-14: online with no drawer open, selling is allowed; a banner says so and opens one.
 * Offline the drawer can't be checked, so nothing is said.
 */
function DrawerBanner() {
  const online = useOnline();
  const drawer = useDrawerToday();
  if (!online || drawer.loading || drawer.error || !drawer.data) return null;
  const session = drawer.data.session;
  if (session?.status === 'open') return null;
  if (session) {
    return (
      <Alert variant="info">
        Today&apos;s drawer is closed. New sales go into the next drawer that opens.
      </Alert>
    );
  }
  return (
    <Alert
      variant="warn"
      action={
        <AlertAction asChild>
          <Link to="/drawer">Open the drawer</Link>
        </AlertAction>
      }
    >
      <b>No drawer is open today.</b> You can still sell: the sales join the drawer once it opens.
    </Alert>
  );
}
