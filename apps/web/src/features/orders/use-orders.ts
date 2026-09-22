import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateOrderInput, ParcelInput } from '@spv4/shared-types';
import { get, patch, post, type SearchParams } from '@/lib/api';
import type { HistoryEntry, Order, OrderImportRow, OrderRow, Paginated } from '@/lib/types';

export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (params: SearchParams) => [...orderKeys.lists(), params] as const,
  counts: () => [...orderKeys.all, 'counts'] as const,
  detail: (reference: string) => [...orderKeys.all, 'detail', reference] as const,
  history: (reference: string) => [...orderKeys.all, 'history', reference] as const,
};

export interface OrdersListParams extends SearchParams {
  status?: string;
  q?: string;
  since?: string;
  problem?: string;
  country?: string;
  page?: number;
  pageSize?: number;
  all?: boolean;
}

export function useOrders(params: OrdersListParams) {
  return useQuery({
    queryKey: orderKeys.list(params),
    queryFn: () => get<Paginated<OrderRow>>('/orders', params),
    placeholderData: (prev) => prev,
  });
}

export function useOrderCounts() {
  return useQuery({
    queryKey: orderKeys.counts(),
    queryFn: () => get<Record<string, number>>('/orders/counts'),
    refetchInterval: 60_000,
  });
}

export function useOrder(reference: string | undefined) {
  return useQuery({
    queryKey: orderKeys.detail(reference ?? ''),
    queryFn: () => get<Order>(`/orders/${encodeURIComponent(reference!)}`),
    enabled: !!reference,
  });
}

export function useOrderHistory(reference: string | undefined) {
  return useQuery({
    queryKey: orderKeys.history(reference ?? ''),
    queryFn: () => get<HistoryEntry[]>(`/orders/${encodeURIComponent(reference!)}/history`),
    enabled: !!reference,
  });
}

/** Invalidate everything about one order, plus lists and counts. */
export function useInvalidateOrder() {
  const qc = useQueryClient();
  return (reference?: string) => {
    qc.invalidateQueries({ queryKey: orderKeys.lists() });
    qc.invalidateQueries({ queryKey: orderKeys.counts() });
    if (reference) {
      qc.invalidateQueries({ queryKey: orderKeys.detail(reference) });
      qc.invalidateQueries({ queryKey: orderKeys.history(reference) });
    }
  };
}

export function useCreateOrder() {
  const invalidate = useInvalidateOrder();
  return useMutation({
    mutationFn: (input: CreateOrderInput) => post<Order>('/orders', input),
    onSettled: () => invalidate(),
  });
}

export function useUpdateOrder(reference: string) {
  const invalidate = useInvalidateOrder();
  return useMutation({
    mutationFn: (input: Partial<CreateOrderInput>) => patch<Order>(`/orders/${encodeURIComponent(reference)}`, input),
    onSettled: () => invalidate(reference),
  });
}

function orderAction<TBody = void>(path: string) {
  return function useAction(reference: string) {
    const invalidate = useInvalidateOrder();
    return useMutation({
      mutationFn: (body: TBody) => post<Order>(`/orders/${encodeURIComponent(reference)}/${path}`, body ?? undefined),
      onSettled: () => invalidate(reference),
    });
  };
}

export const useBuyLabel = orderAction<{ method?: string; courier?: string } | undefined>('label');
export const useSetParcels = orderAction<{ parcels: ParcelInput[] }>('parcels');
export const useCancelOrder = orderAction<{ reason?: string } | undefined>('cancel');
export const useMarkShipped = orderAction<undefined>('shipped');
export const useRelabel = orderAction<{ method: string }>('relabel');
export const useReturnLabel = orderAction<undefined>('return-label');
export const useRefreshTracking = orderAction<undefined>('refresh-tracking');

export function useAddNote(reference: string) {
  const invalidate = useInvalidateOrder();
  return useMutation({
    mutationFn: (note: string) => post<{ ok: true }>(`/orders/${encodeURIComponent(reference)}/notes`, { note }),
    onSettled: () => invalidate(reference),
  });
}

export function useResolveOrderProblem(reference: string) {
  const invalidate = useInvalidateOrder();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ problemId, resolution }: { problemId: string; resolution: string }) =>
      post<Order>(`/orders/${encodeURIComponent(reference)}/problems/${problemId}/resolve`, { resolution }),
    onSettled: () => {
      invalidate(reference);
      qc.invalidateQueries({ queryKey: ['problems'] });
    },
  });
}

export function useBatchOrders() {
  const invalidate = useInvalidateOrder();
  return useMutation({
    mutationFn: async ({ references, action }: { references: string[]; action: 'shipped' | 'cancel' }) => {
      const results = await Promise.allSettled(
        references.map((r) => post<Order>(`/orders/${encodeURIComponent(r)}/${action}`, action === 'cancel' ? {} : undefined)),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { done: results.length - failed, failed };
    },
    onSettled: () => invalidate(),
  });
}

export function useImportOrders() {
  const invalidate = useInvalidateOrder();
  return useMutation({
    mutationFn: (input: { csv: string; label?: boolean }) => post<{ results: OrderImportRow[] }>('/orders/import', input),
    onSettled: () => invalidate(),
  });
}
