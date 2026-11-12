import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isSoldByMeasure, MAX_QTY } from '@/lib/quantity';

/**
 * The cart on the Sell screen (POS-01, POS-02). One line per product: tapping a product again
 * adds one more; a product sold by weight or volume asks how much instead. Kept for this
 * browser tab (sessionStorage), so the "Update ready" reload in the middle of a sale keeps it,
 * and tied to the user who filled it, so the next person on a shared device starts empty.
 */
export interface CartLine {
  productId: string;
  qty: number;
  /** POS-03: the preset discount staff picked for this line, if any. */
  discountId?: string;
  /** POS-03: the package deal staff applied to this line, if any. Never with a preset. */
  dealId?: string;
}

interface CartState {
  uid: string | null;
  lines: CartLine[];
  /** Adds one unit, or sets the amount of a weighed product. */
  add: (uid: string, product: { id: string; unit: string }, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  /** Picks a preset for the line, or none. */
  setDiscount: (productId: string, discountId: string | null) => void;
  /** Puts these lines in the deal (taking any preset or other deal off them). */
  applyDeal: (dealId: string, productIds: string[]) => void;
  /** Takes the deal off every line. */
  removeDeal: (dealId: string) => void;
  clear: () => void;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      uid: null,
      lines: [],
      add: (uid, product, qty) =>
        set((state) => {
          const lines = state.uid === uid ? state.lines : [];
          const at = lines.findIndex((line) => line.productId === product.id);
          const weighed = isSoldByMeasure(product.unit);
          if (at < 0) {
            return { uid, lines: [...lines, { productId: product.id, qty: round3(qty ?? 1) }] };
          }
          const next = weighed && qty !== undefined ? qty : lines[at]!.qty + (qty ?? 1);
          return {
            uid,
            lines: lines.map((line, i) =>
              i === at ? { ...line, qty: Math.min(round3(next), MAX_QTY) } : line,
            ),
          };
        }),
      setQty: (productId, qty) =>
        set((state) => ({
          lines:
            qty > 0
              ? state.lines.map((line) =>
                  line.productId === productId
                    ? { ...line, qty: Math.min(round3(qty), MAX_QTY) }
                    : line,
                )
              : state.lines.filter((line) => line.productId !== productId),
        })),
      remove: (productId) =>
        set((state) => ({ lines: state.lines.filter((line) => line.productId !== productId) })),
      setDiscount: (productId, discountId) =>
        set((state) => ({
          lines: state.lines.map((line) => {
            if (line.productId !== productId) return line;
            const rest = { productId: line.productId, qty: line.qty };
            return discountId ? { ...rest, discountId } : rest;
          }),
        })),
      applyDeal: (dealId, productIds) =>
        set((state) => ({
          lines: state.lines.map((line) =>
            productIds.includes(line.productId)
              ? { productId: line.productId, qty: line.qty, dealId }
              : line,
          ),
        })),
      removeDeal: (dealId) =>
        set((state) => ({
          lines: state.lines.map((line) =>
            line.dealId === dealId ? { productId: line.productId, qty: line.qty } : line,
          ),
        })),
      clear: () => set({ lines: [] }),
    }),
    {
      name: 'pos.cart',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ uid: state.uid, lines: state.lines }),
    },
  ),
);

/** The cart of this user: someone else's cart on a shared tab is never shown. */
export const cartLinesFor = (state: Pick<CartState, 'uid' | 'lines'>, uid: string | undefined) =>
  uid && state.uid === uid ? state.lines : [];
