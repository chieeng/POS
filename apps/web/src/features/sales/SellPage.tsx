import {
  ChevronUp,
  CircleAlert,
  Minus,
  Plus,
  Scale,
  Search,
  Tags,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { FilterChip, FilterChips } from '@/components/ui/filter-chips';
import { InfoTip } from '@/components/ui/info-tip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadMore } from '@/components/ui/load-more';
import { Sheet, SheetContent, SheetTitle, WIDE_QUERY } from '@/components/ui/sheet';
import { useCategories, useProducts, type Product } from '@/features/catalog/data';
import { ProductPhoto } from '@/features/catalog/ProductPhoto';
import { useDrawerToday } from '@/features/drawer/data';
import { shortDay } from '@/features/drawer/format';
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
import { cartSummary, priceCart, type Pricing } from './pricing';
import { SaleSlip } from './SaleSlip';
import { itemCount, lineWarning, sellResults, stockState, type StockState } from './sell';
import { lineTotalCents } from './totals';
import { ClockPanel } from '@/features/attendance/AttendancePage';
import { useClockState } from '@/features/attendance/clock';

// Products drawn at a time; the rest come with "Load more" (SRS 7.2).
const PAGE = 60;

/**
 * Sell (POS-01, POS-02): find products by name, SKU or category and build the cart. Works
 * offline from the product list saved on this device (NFR-01, NFR-02); payment and the slip
 * too (POS-04, POS-07). No Hold yet (step 15), and no typed discounts: staff never type one
 * (POS-03); preset deals arrive later in step 9.
 */
/**
 * ATT-16: staff clock in before the first sale of the day. Until they do, Sell shows the clock
 * instead of the products; offline, a time in saved on the phone counts.
 */
export function SellPage() {
  const user = useSession((s) => s.user);
  const clockState = useClockState(user?.uid, user?.role === 'owner');
  // Only the first time on this phone: after that the day's state is kept on the phone.
  if (clockState.loading) {
    return (
      <p role="status" className="px-[16px] pt-[14px] text-neutral-700 md:px-[26px]">
        Loading…
      </p>
    );
  }
  if (clockState.canClock && !clockState.clockedIn) {
    return (
      <div className="flex w-full max-w-[560px] flex-col gap-[14px] px-[16px] pt-[14px] pb-[24px] md:px-[26px] md:pt-[22px]">
        <div>
          <h1 className="text-[28px] md:text-[30px]">Clock in first</h1>
          <p className="m-0 text-[14.5px] text-neutral-700">
            Clock in at the store to start selling today.
          </p>
        </div>
        <ClockPanel state={clockState} compact />
      </div>
    );
  }
  return <SellScreen />;
}

function SellScreen() {
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
    roundCash: settings.roundCash,
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
        {/* Round 3: the title, then search (beside it on a laptop); the product list is the
            working area, flat on the ground. */}
        <div className="flex flex-col gap-[10px] xl:flex-row xl:items-center xl:gap-[20px]">
          <h1 className="text-[24px] xl:flex-1 xl:text-[28px]">Sell</h1>
          <div className="relative xl:w-[min(520px,50%)]">
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
              className="min-h-[48px] rounded-[12px] border-transparent bg-neutral-200 pl-[44px] text-[15px]"
            />
          </div>
        </div>
        <DrawerBanner />
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
      {/* Round 3: the cart is the main thing, a raised card on the right. */}
      <aside
        aria-label="Cart"
        className="sticky top-0 hidden h-dvh w-[360px] flex-none py-[14px] pr-[14px] md:flex xl:w-[420px] xl:py-[18px] xl:pr-[18px]"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-[8px] rounded-[16px] bg-surface px-[16px] pt-[14px] pb-[16px] shadow-[var(--shadow-md)] xl:px-[18px]">
          <div className="flex items-baseline justify-between">
            <h2 className="font-body text-[18px] font-semibold">Cart</h2>
            {count > 0 && (
              <span className="text-[13px] text-neutral-700">
                {count} {count === 1 ? 'item' : 'items'}
              </span>
            )}
          </div>
          <CartContents {...cartProps} />
        </div>
      </aside>

      {/* Phone: a bar above the tabs that opens the cart as a sheet. */}
      {count > 0 && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          aria-label={`View cart · ${count} ${count === 1 ? 'item' : 'items'} · ${formatPeso(totalCents / 100)}`}
          className="fixed right-[12px] bottom-[88px] left-[12px] z-30 flex h-[60px] items-center gap-[10px] rounded-[14px] bg-text px-[18px] text-bg shadow-[var(--shadow-lg)] md:hidden"
        >
          <span className="text-[15px] font-semibold">
            {count} {count === 1 ? 'item' : 'items'}
          </span>
          <span className="flex-1" />
          <span className="font-heading text-[20px]">{formatPeso(totalCents / 100)}</span>
          <ChevronUp size={20} strokeWidth={ICON_STROKE} aria-hidden />
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
        className="relative flex min-h-[64px] w-full items-center gap-[12px] py-[8px] text-left hover:bg-text/5 md:min-h-[120px] md:flex-col md:items-stretch md:gap-[6px] md:rounded-[12px] md:bg-surface md:p-[12px] md:hover:bg-surface/70"
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
        <span className="font-heading text-[16px] whitespace-nowrap">
          {formatPeso(product.sellPrice)}
          {weighed && <span className="font-body text-[12.5px] font-normal">/{product.unit}</span>}
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
  roundCash,
  onPay,
}: {
  lines: CartLine[];
  byId: Map<string, Product>;
  rules: DiscountRule[];
  pricing: Pricing;
  roundCash: boolean;
  onPay: () => void;
}) {
  const { subtotalCents } = pricing;
  const summary = cartSummary(pricing, roundCash);
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
      <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto">
        {/* Round 3: flat hairline rows; each keeps −/+, Discount and remove (round 1). */}
        <ul aria-label="Cart lines" className="flex flex-col">
          {lines.map((line) => {
            const product = byId.get(line.productId);
            if (!product) return null;
            const weighed = isSoldByMeasure(product.unit);
            const warning = lineWarning(product, line.qty);
            const offers = rulesFor(rules, product);
            const price = pricing.perLine.get(line.productId);
            const inDealLine = price?.kind === 'deal';
            return (
              <li
                key={line.productId}
                aria-label={product.name}
                className="flex flex-col gap-[6px] border-b border-divider py-[10px] last:border-b-0"
              >
                <div className="flex items-start gap-[10px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] leading-[1.3] font-semibold md:text-[14.5px]">
                      {product.name}
                    </div>
                    <div className="text-[13px] text-neutral-700">
                      {formatPeso(product.sellPrice)} {weighed ? `per ${product.unit}` : 'each'}
                    </div>
                    {price && !inDealLine && price.amount > 0 && (
                      <div className="text-[13px] font-semibold text-accent-2-700">
                        {price.name} · −{formatPeso(price.amount)}
                      </div>
                    )}
                  </div>
                  <div className="font-heading text-[15.5px] whitespace-nowrap">
                    {formatPeso(lineTotalCents(line.qty, product.sellPrice) / 100)}
                  </div>
                </div>
                {warning && (
                  <div
                    className={cn(
                      'flex items-center gap-[6px] text-[12.5px] font-bold',
                      warning.kind === 'neg' ? 'text-danger-fg' : 'text-warn-fg',
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
                      className="min-h-[44px] bg-neutral-200 px-[14px]"
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
                        className="rounded-[10px] bg-neutral-200"
                        aria-label={`One less ${product.name}`}
                        disabled={line.qty <= 1}
                        onClick={() => cart.setQty(product.id, line.qty - 1)}
                      >
                        <Minus size={17} strokeWidth={ICON_STROKE} aria-hidden />
                      </Button>
                      <span
                        aria-label={`Quantity of ${product.name}`}
                        className="min-w-[32px] text-center text-[16px] font-bold"
                      >
                        {formatQty(line.qty)}
                      </span>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="rounded-[10px] bg-neutral-200"
                        aria-label={`One more ${product.name}`}
                        disabled={line.qty >= MAX_QTY}
                        onClick={() => user && cart.add(user.uid, product)}
                      >
                        <Plus size={17} strokeWidth={ICON_STROKE} aria-hidden />
                      </Button>
                    </>
                  )}
                  <span className="flex-1" />
                  {/* No double discount: a line in a deal takes no preset (the owner, Nov 27). */}
                  {inDealLine ? (
                    <span className="rounded-[6px] bg-accent-2-100 px-[8px] py-[3px] text-[12px] font-bold text-accent-2-800">
                      In deal
                    </span>
                  ) : (
                    offers.length > 0 && (
                      <Button
                        variant="ghost"
                        className="min-h-[44px] px-[8px] font-body text-[14px] font-semibold underline underline-offset-[3px]"
                        aria-label={`Discount for ${product.name}`}
                        onClick={() => setDiscounting(product.id)}
                      >
                        Discount
                      </Button>
                    )
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-neutral-700"
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
          <section aria-label="Deals" className="flex flex-col">
            <h3 className="flex items-center gap-[6px] font-body text-[15px] font-semibold">
              Deals
              <InfoTip label="About deals">
                A deal shows when the cart fits it. Tap Apply to use it; the app never adds one by
                itself.
              </InfoTip>
            </h3>
            {pricing.applied.map(({ rule, sets, saving }) => (
              <div
                key={rule.id}
                className="flex items-start gap-[10px] border-b border-divider py-[8px] last:border-b-0"
              >
                <Tags size={17} strokeWidth={ICON_STROKE} className="mt-[2px]" aria-hidden />
                <div className="min-w-0 flex-1 text-[13.5px] leading-[1.3]">
                  <b className="text-[14.5px]">{rule.name}</b>
                  <div className="text-neutral-700">
                    {sets} {sets === 1 ? 'set' : 'sets'}
                  </div>
                  <Button
                    variant="ghost"
                    className="-ml-[6px] min-h-[36px] px-[6px] font-body text-[13.5px] font-semibold underline underline-offset-[3px]"
                    aria-label={`Remove ${rule.name}`}
                    onClick={() => cart.removeDeal(rule.id)}
                  >
                    Remove
                  </Button>
                </div>
                <span className="font-heading text-[15.5px] whitespace-nowrap text-accent-2-700">
                  −{formatPeso(saving)}
                </span>
              </div>
            ))}
            {pricing.offers.map(({ rule, saving }) => (
              <div
                key={rule.id}
                className="flex items-center gap-[10px] border-b border-divider py-[8px] last:border-b-0"
              >
                <Tags size={17} strokeWidth={ICON_STROKE} aria-hidden />
                <div className="min-w-0 flex-1 text-[13.5px] leading-[1.3]">
                  <b className="text-[14.5px]">Deal: {rule.name}</b>
                  <div className="text-neutral-700">
                    {dealSummary(rule, (id) => byId.get(id)?.name)} · save {formatPeso(saving)}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  className="min-h-[44px] bg-neutral-200 px-[16px]"
                  aria-label={`Apply ${rule.name}`}
                  onClick={() => applyDeal(rule)}
                >
                  Apply
                </Button>
              </div>
            ))}
          </section>
        )}
      </div>
      <div className="flex flex-col gap-[3px] border-t border-divider pt-[8px]">
        {summary.dealsCents + summary.presetCents > 0 && (
          <div className="flex justify-between text-[13.5px] text-neutral-700">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatPeso(subtotalCents / 100)}</span>
          </div>
        )}
        {/* Deals and preset discounts on their own lines (the owner, Nov 27). */}
        {summary.dealsCents > 0 && (
          <div className="flex justify-between text-[13.5px] text-accent-2-700">
            <span>Deals</span>
            <span className="tabular-nums">−{formatPeso(summary.dealsCents / 100)}</span>
          </div>
        )}
        {summary.presetCents > 0 && (
          <div className="flex justify-between text-[13.5px] text-accent-2-700">
            <span>Discount</span>
            <span className="tabular-nums">−{formatPeso(summary.presetCents / 100)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="text-[16px] font-semibold">Total</span>
          <span className="font-heading text-[32px] md:text-[28px] xl:text-[32px]">
            {formatPeso(summary.totalCents / 100)}
          </span>
        </div>
        {summary.cashRoundingCents !== 0 && (
          <div className="flex justify-between text-[13px] text-neutral-700">
            <span>Rounding if paid in cash</span>
            <span className="tabular-nums">
              {summary.cashRoundingCents > 0 ? '+' : '−'}
              {formatPeso(Math.abs(summary.cashRoundingCents) / 100)} (cash{' '}
              {formatPeso((summary.totalCents + summary.cashRoundingCents) / 100)})
            </span>
          </div>
        )}
        <Button variant="money" className="mt-[6px] min-h-[56px] w-full text-[19px]" onClick={onPay}>
          Pay {formatPeso(summary.totalCents / 100)}
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
 * this product are offered; nothing is typed. Round 3 (pop-up set 1): flat rows, the chosen
 * one raised, the amount off in green; the rule sits behind (i).
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
        'flex min-h-[60px] w-full items-center gap-[12px] rounded-[14px] px-[14px] py-[10px] text-left',
        current === id ? 'bg-surface shadow-[var(--shadow-md)]' : 'hover:bg-text/5',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-[22px] flex-none rounded-full',
          current === id ? 'border-[7px] border-text' : 'border-2 border-neutral-600',
        )}
      />
      <span className="min-w-0 flex-1">
        <b className="block text-[15.5px]">{title}</b>
        <span className="block text-[13px] text-neutral-700">{detail}</span>
      </span>
      {off && (
        <span className="font-heading text-[17px] whitespace-nowrap text-accent-2-700">{off}</span>
      )}
    </button>
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle className="flex items-center gap-[8px]">
          Discount
          <InfoTip label="About discounts">
            Only the Owner’s discounts that fit this product are listed. Tap one to use it; it
            shows on the line and the slip.
          </InfoTip>
        </DialogTitle>
        <DialogDescription>
          {product.name} · {qtyWithUnit(line.qty, product.unit)} ·{' '}
          {formatPeso(lineTotalCents(line.qty, product.sellPrice) / 100)} before discount
        </DialogDescription>
        <div role="radiogroup" aria-label="Discounts" className="flex flex-col gap-[4px]">
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

/**
 * A product sold by weight or volume: "How many kg?" (PROD-01, up to 3 decimals). Round 3
 * (pop-up set 1): the line total is the big number; a wrong amount keeps its red line.
 */
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
          <div className="flex flex-col gap-[6px]">
            <span className="flex items-center gap-[6px]">
              <Label htmlFor="weigh-qty" className="text-[13px]">
                Amount ({unit})
              </Label>
              <InfoTip label="About the amount">Up to 3 decimals, for example 0.5 or 1.25.</InfoTip>
            </span>
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
              aria-describedby={error ? 'weigh-error' : ok ? 'weigh-total' : undefined}
              className="min-h-[60px] rounded-[12px] bg-neutral-200 font-heading text-[26px]"
            />
          </div>
          {error ? (
            <p
              id="weigh-error"
              className="m-0 rounded-[12px] bg-danger-bg px-[14px] py-[10px] text-[14px] font-semibold text-danger-fg"
            >
              {error}
            </p>
          ) : (
            ok &&
            qty !== null && (
              <div
                id="weigh-total"
                className="flex items-baseline justify-between rounded-[16px] bg-surface px-[16px] py-[14px] shadow-[var(--shadow-md)]"
              >
                <span className="font-semibold">{qtyWithUnit(qty, unit)}</span>
                <span className="font-heading text-[30px]">
                  {formatPeso(lineTotalCents(qty, product.sellPrice) / 100)}
                </span>
              </div>
            )
          )}
          <Button type="submit" className="min-h-[56px] w-full text-[17px]">
            {current > 0 ? 'Update cart' : 'Add to cart'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="mx-auto min-h-[44px] px-[12px] underline underline-offset-[3px]"
            onClick={onClose}
          >
            Cancel
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The action at the end of a one-line strip: a text button, 44 px tall for the thumb. */
const STRIP_LINK =
  '-my-[10px] inline-flex min-h-[44px] items-center px-[6px] font-bold text-current underline underline-offset-[3px]';

/**
 * POS-14: online with no drawer open, selling is allowed; a banner says so and opens one.
 * Offline the drawer can't be checked, so the banner says what happens to the sales instead
 * (the Nov 24, 2026 test: it disappeared offline). An earlier drawer still open is counted
 * first by those who can count (SHIFT-01): opening today's would close it uncounted.
 */
function DrawerBanner() {
  const online = useOnline();
  const drawer = useDrawerToday();
  const role = useSession((s) => s.user?.role);
  const canCount = role === 'owner' || role === 'special_sales';
  // Round 3: one short line; what it means sits behind (i). The line itself always shows.
  if (!online) {
    return (
      <Alert variant="offline">
        <span className="inline-flex items-center gap-[8px]">
          <b>Offline · you can still sell</b>
          <InfoTip label="About selling offline">
            Sales are kept on this phone and join the drawer when they’re sent.
          </InfoTip>
        </span>
      </Alert>
    );
  }
  if (drawer.loading || drawer.error || !drawer.data) return null;
  const session = drawer.data.session;
  if (session?.status === 'open') return null;
  if (session) {
    return (
      <Alert variant="info">
        <b>Today’s drawer is closed.</b> New sales go to the next drawer.
      </Alert>
    );
  }
  const stale = drawer.data.stale;
  if (stale && canCount) {
    const day = `${shortDay(stale.businessDate)}’s`;
    return (
      <Alert variant="warn">
        <span className="flex w-full items-center gap-[8px]">
          <b>{day} drawer was never counted</b>
          <InfoTip label="About the uncounted drawer">
            Count it, then open today’s. You can still sell meanwhile.
          </InfoTip>
          <span className="flex-1" />
          <Link to="/drawer/count" aria-label={`Count ${day} drawer`} className={STRIP_LINK}>
            Count it
          </Link>
        </span>
      </Alert>
    );
  }
  return (
    <Alert variant="warn">
      <span className="flex w-full items-center gap-[8px]">
        <b>Drawer not open</b>
        <InfoTip label="About the drawer">
          You can still sell. Open today’s drawer when you can.
        </InfoTip>
        <span className="flex-1" />
        <Link to="/drawer" aria-label="Open the drawer" className={STRIP_LINK}>
          Open
        </Link>
      </span>
    </Alert>
  );
}
