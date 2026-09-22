import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FILTER, isChipActive, OPEN_STATUSES, ordersQueryFor, scanMatch, toggleStatus, type OrdersFilterState } from './order-status';
import { buildUrl, get } from './api';

describe('orders list default filter', () => {
  it('sends no status param by default so the API returns its open set', () => {
    expect(ordersQueryFor(DEFAULT_FILTER)).toEqual({});
  });

  it('shows the four open chips as active when nothing is chosen', () => {
    for (const s of OPEN_STATUSES) expect(isChipActive(DEFAULT_FILTER, s)).toBe(true);
    expect(isChipActive(DEFAULT_FILTER, 'SHIPPED')).toBe(false);
  });

  it('removing a chip from the default set keeps the other three', () => {
    const next = toggleStatus(DEFAULT_FILTER, 'NEW');
    expect(next.statuses.sort()).toEqual(['LABEL_GENERATED', 'PROBLEM', 'UPDATE_PRODUCT']);
    expect(ordersQueryFor(next)).toEqual({ status: next.statuses.join(',') });
    expect(isChipActive(next, 'NEW')).toBe(false);
  });

  it('"Show all" sends all=true and clears the chips', () => {
    const all: OrdersFilterState = { statuses: [], showAll: true };
    expect(ordersQueryFor(all)).toEqual({ all: true });
    expect(isChipActive(all, 'PROBLEM')).toBe(false);
    // Toggling a chip leaves "show all" and starts again from the open set.
    const next = toggleStatus(all, 'PROBLEM');
    expect(next.showAll).toBe(false);
    expect(next.statuses).toEqual(['NEW', 'UPDATE_PRODUCT', 'LABEL_GENERATED']);
  });
});

describe('orders list request', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('omits status and all for the default view', async () => {
    await get('/orders', { ...ordersQueryFor(DEFAULT_FILTER), page: 1, pageSize: 50 });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/v4/orders');
    expect(url.searchParams.has('status')).toBe(false);
    expect(url.searchParams.has('all')).toBe(false);
    expect(url.searchParams.get('page')).toBe('1');
  });

  it('sends a comma-separated status list when chips are chosen', async () => {
    await get('/orders', ordersQueryFor({ statuses: ['PROBLEM', 'NEW'], showAll: false }));
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get('status')).toBe('PROBLEM,NEW');
  });

  it('drops blank search params', () => {
    const url = new URL(buildUrl('/orders', { q: '', status: undefined, page: 2 }));
    expect([...url.searchParams.keys()]).toEqual(['page']);
  });
});

describe('scan-and-enter', () => {
  const rows = [
    { orderNumber: 'WEB-1001', trackingNumber: 'JD 0001 2345 GB' },
    { orderNumber: 'WEB-1002', trackingNumber: null },
  ];

  it('matches a reference ignoring spaces, dashes and case', () => {
    expect(scanMatch(rows, 'web 1001')?.orderNumber).toBe('WEB-1001');
    expect(scanMatch(rows, 'WEB1002')?.orderNumber).toBe('WEB-1002');
  });

  it('matches a tracking number the same way', () => {
    expect(scanMatch(rows, 'jd000123-45gb')?.orderNumber).toBe('WEB-1001');
  });

  it('opens the only search result even when the text is a partial match', () => {
    expect(scanMatch([rows[0]!], '1001')?.orderNumber).toBe('WEB-1001');
  });

  it('does nothing when the typed value is ambiguous or empty', () => {
    expect(scanMatch(rows, 'WEB')).toBeNull();
    expect(scanMatch(rows, '   ')).toBeNull();
  });
});
