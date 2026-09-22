import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, fetchText, get, patch, post, put } from '@/lib/api';
import type { Band, Quote, ShippingMethod } from '@/lib/types';

export const methodKeys = {
  all: ['methods'] as const,
  bands: (id: string) => ['methods', id, 'bands'] as const,
};

export function useMethods() {
  return useQuery({ queryKey: methodKeys.all, queryFn: () => get<ShippingMethod[]>('/methods') });
}

export function useMethodBands(id: string | undefined) {
  return useQuery({
    queryKey: methodKeys.bands(id ?? ''),
    queryFn: () => get<Band[]>(`/methods/${id}/bands`),
    enabled: !!id,
  });
}

function useInvalidateMethods() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: methodKeys.all });
}

export type MethodInput = Partial<Omit<ShippingMethod, 'id' | 'courierName' | 'currentBands' | 'surcharges'>> & { name: string; courierAccountId: string };

export function useCreateMethod() {
  const invalidate = useInvalidateMethods();
  return useMutation({ mutationFn: (input: MethodInput) => post<ShippingMethod>('/methods', input), onSettled: () => invalidate() });
}

export function useUpdateMethod() {
  const invalidate = useInvalidateMethods();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<MethodInput> }) => patch<ShippingMethod>(`/methods/${id}`, input),
    onSettled: () => invalidate(),
  });
}

export function useDeleteMethod() {
  const invalidate = useInvalidateMethods();
  return useMutation({ mutationFn: (id: string) => del(`/methods/${id}`), onSettled: () => invalidate() });
}

export function useSetBands() {
  const invalidate = useInvalidateMethods();
  return useMutation({
    mutationFn: ({ id, bands, effectiveFrom, note }: { id: string; bands: Band[]; effectiveFrom?: string; note?: string }) =>
      put<Band[]>(`/methods/${id}/bands`, { bands, effectiveFrom, note }),
    onSettled: () => invalidate(),
  });
}

export function useMethodsFromServices() {
  const invalidate = useInvalidateMethods();
  return useMutation({
    mutationFn: (input: { courierAccountId: string; serviceCodes: string[] }) => post<ShippingMethod[]>('/methods/from-services', input),
    onSettled: () => invalidate(),
  });
}

export function useImportMethods() {
  const invalidate = useInvalidateMethods();
  return useMutation({ mutationFn: (csv: string) => post<unknown>('/methods/import', { csv }), onSettled: () => invalidate() });
}

export async function exportMethodsCsv(): Promise<string> {
  return fetchText('/methods/export');
}

export function useQuote() {
  return useMutation({
    mutationFn: (input: {
      warehouse?: string;
      deliveryAddress: { country: string; postCode?: string };
      parcels: { weight: number; length: number; width: number; height: number }[];
      deliveryPromise?: string;
      flags?: Record<string, boolean>;
    }) => post<Quote>('/quotes', input),
  });
}
