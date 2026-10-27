import { useLiveRows } from '@/hooks/useLiveRows';
import { getDeviceTag } from '@/lib/device';
import { supabase } from '@/lib/supabase';
import type { Product } from '@/features/catalog/data';
import { deletePhotoFiles } from '@/features/catalog/photos';

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type RequestType = 'product_edit' | 'stock_adjustment' | 'stock_in_correction';

/** SRS 3.9: one approval request. */
export interface ApprovalRequest {
  id: string;
  type: RequestType;
  /** The product (product_edit, stock_adjustment) or stock-in (stock_in_correction). */
  targetId: string;
  /** The product, for the types that target one; empty for a stock-in correction. */
  productId: string;
  /** The requested fields as they were when the request was made. */
  before: Record<string, unknown>;
  /** The same fields as requested. */
  after: Record<string, unknown>;
  reason: string;
  requestedBy: string;
  status: RequestStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  ownerNote: string | null;
  createdAt: Date;
}

type Row = Record<string, unknown>;

const toObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const TYPES: RequestType[] = ['product_edit', 'stock_adjustment', 'stock_in_correction'];

const toRequest = (row: Row): ApprovalRequest => ({
  id: String(row.id ?? ''),
  type: TYPES.includes(row.type as RequestType) ? (row.type as RequestType) : 'product_edit',
  targetId: String(row.target_id ?? ''),
  productId: row.target_type === 'stock_receipt' ? '' : String(row.target_id ?? ''),
  before: toObject(row.before),
  after: toObject(row.after),
  reason: String(row.reason ?? ''),
  requestedBy: String(row.requested_by ?? ''),
  status: (row.status as RequestStatus) ?? 'pending',
  decidedBy: typeof row.decided_by === 'string' ? row.decided_by : null,
  decidedAt: typeof row.decided_at === 'string' ? new Date(row.decided_at) : null,
  ownerNote: typeof row.owner_note === 'string' ? row.owner_note : null,
  createdAt: new Date(String(row.created_at)),
});

/**
 * The requests this user may see, newest first: every request of the branch for the Owner,
 * their own for anyone else (Row Level Security decides). Pending ones are always loaded.
 */
export function useApprovalRequests(count = 100) {
  return useLiveRows({
    table: 'approval_requests',
    queryKey: String(count),
    load: async () => {
      const columns =
        'id, type, target_type, target_id, before, after, reason, requested_by, status, decided_by, decided_at, owner_note, created_at';
      const pending = await supabase
        .from('approval_requests')
        .select(columns)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(300);
      if (pending.error) return { data: null, error: pending.error };
      const decided = await supabase
        .from('approval_requests')
        .select(columns)
        .neq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(count);
      if (decided.error) return { data: null, error: decided.error };
      return { data: [...(pending.data as Row[]), ...(decided.data as Row[])], error: null };
    },
    map: toRequest,
  });
}

/** The product's value for a request field, in the same form the request stores it. */
export function currentValue(product: Product, key: string): unknown {
  switch (key) {
    case 'sku':
      return product.sku;
    case 'name':
      return product.name;
    case 'category_id':
      return product.categoryId;
    case 'unit':
      return product.unit;
    case 'sell_price':
      return product.sellPrice;
    case 'reorder_level':
      return product.reorderLevel;
    case 'active':
      return product.active;
    case 'photo_key':
      return product.photoKey;
    default:
      return undefined;
  }
}

const same = (a: unknown, b: unknown) =>
  typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : a === b;

/**
 * The Owner can only reject an outdated request. A product edit is outdated when a requested
 * field changed since; a stock-in correction when that stock-in was corrected since. An
 * adjustment never is (the server checks the stock again when it is approved).
 */
export function isOutdated(
  request: ApprovalRequest,
  product: Product | undefined,
  receiptCorrected = false,
): boolean {
  if (request.type === 'stock_in_correction') return receiptCorrected;
  if (request.type !== 'product_edit' || !product) return false;
  return Object.keys(request.before).some(
    (key) => !same(currentValue(product, key), request.before[key]),
  );
}

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, { ...args, p_device_tag: getDeviceTag() });
  if (error) throw error;
  return data;
}

/** PROD-04: Special Sales asks the Owner to change a product. Nothing changes until decided. */
export const requestProductChange = (
  productId: string,
  changes: Record<string, unknown>,
  reason: string,
) =>
  call('request_product_change', {
    p_product_id: productId,
    p_changes: changes,
    p_reason: reason,
  });

export const withdrawRequest = (id: string) => call('withdraw_request', { p_id: id });

/** APPR-03, APPR-04: the Owner approves (applies the change) or rejects, with a note. */
export const decideApproval = (id: string, approve: boolean, note: string) =>
  call('decide_approval', { p_id: id, p_approve: approve, p_note: note.trim() || null });

/**
 * After a product change request is closed, deletes the photo files nothing shows any more:
 * the replaced photo when approved, the proposed one when rejected or withdrawn (PROD-07).
 */
export function cleanUpRequestPhoto(
  request: ApprovalRequest,
  outcome: 'approved' | 'rejected' | 'withdrawn',
): void {
  if (request.type !== 'product_edit' || !('photo_key' in request.after)) return;
  void deletePhotoFiles(
    request.productId,
    outcome === 'approved' ? request.before.photo_key : request.after.photo_key,
  );
}

export function describeApprovalError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  switch (message) {
    case 'no_change':
      return 'Change at least one thing, or close the form.';
    case 'request_pending':
      return 'You already have a pending request for this product. Withdraw it first to make a new one.';
    case 'request_outdated':
      return 'This changed since the request was made, so it can only be rejected.';
    case 'stock_negative':
      return 'Approving this would take stock below zero. Reject it, or adjust the stock first.';
    case 'request_closed':
      return 'This request was already decided or withdrawn.';
    case 'sku_taken':
      return 'Another product already uses this SKU.';
    case 'category_inactive':
      return 'This category is inactive. Choose an active one.';
    case 'invalid_input':
      return 'Some details are not valid. Check the form.';
    case 'photo_missing':
      return 'The new photo didn’t finish uploading. Try again.';
    case 'not_found':
      return 'This request or product no longer exists. Reload the page.';
  }
  if (code === '42501') return 'This account cannot do that.';
  if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'No internet connection. This needs to be online; try again.';
  }
  return 'Something went wrong. Try again.';
}

export const formatWhen = (when: Date) =>
  when.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
