import type { OrderStatus } from '@spv4/shared-types';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'New',
  UPDATE_PRODUCT: 'Update product',
  LABEL_GENERATED: 'Label generated',
  SHIPPED: 'Shipped',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  PROBLEM: 'Problem',
  CANCELLED: 'Cancelled',
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return STATUS_LABELS[status as OrderStatus] ?? status;
}

/** The statuses the API lists when no filter is given — problems first. */
export const OPEN_STATUSES: OrderStatus[] = ['PROBLEM', 'NEW', 'UPDATE_PRODUCT', 'LABEL_GENERATED'];

/** The filter chips, in the order they appear. */
export const CHIP_STATUSES: OrderStatus[] = ['PROBLEM', 'NEW', 'UPDATE_PRODUCT', 'LABEL_GENERATED'];

export interface OrdersFilterState {
  statuses: OrderStatus[];
  showAll: boolean;
}

export const DEFAULT_FILTER: OrdersFilterState = { statuses: [], showAll: false };

/**
 * The query the list sends for a chip selection.
 *
 * No chips and "Show all" off → no status param, so the API returns its
 * default open set. Chips chosen → those statuses only. "Show all" → every
 * status, ignoring chips.
 */
export function ordersQueryFor(state: OrdersFilterState): { status?: string; all?: boolean } {
  if (state.showAll) return { all: true };
  if (state.statuses.length === 0) return {};
  return { status: state.statuses.join(',') };
}

export function toggleStatus(state: OrdersFilterState, status: OrderStatus): OrdersFilterState {
  // Toggling from the implicit default set starts from that set, so removing
  // "New" from the default shows the other three rather than everything.
  const base = state.showAll || state.statuses.length === 0 ? OPEN_STATUSES : state.statuses;
  const has = base.includes(status);
  const statuses = has ? base.filter((s) => s !== status) : [...base, status];
  return { showAll: false, statuses };
}

/** Which chips read as active: with nothing chosen, the default open set is. */
export function isChipActive(state: OrdersFilterState, status: OrderStatus): boolean {
  if (state.showAll) return false;
  if (state.statuses.length === 0) return OPEN_STATUSES.includes(status);
  return state.statuses.includes(status);
}

/** Scan-friendly comparison: spaces and dashes are ignored, case too. */
export function normaliseScan(value: string): string {
  return value.replace(/[\s-]+/g, '').toLowerCase();
}

/**
 * Which order a scanned value opens: exactly one row whose reference or
 * tracking number matches the typed value, else none.
 */
export function scanMatch<T extends { orderNumber: string; trackingNumber?: string | null }>(items: T[], typed: string): T | null {
  const wanted = normaliseScan(typed);
  if (!wanted) return null;
  const hits = items.filter(
    (o) => normaliseScan(o.orderNumber) === wanted || (o.trackingNumber && normaliseScan(o.trackingNumber) === wanted),
  );
  if (hits.length === 1) return hits[0]!;
  if (hits.length === 0 && items.length === 1) return items[0]!;
  return null;
}
