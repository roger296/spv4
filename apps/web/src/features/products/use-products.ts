import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, post, put, type SearchParams } from '@/lib/api';
import type { Paginated, Product, ProductPatch } from '@/lib/types';

export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (params: SearchParams) => [...productKeys.lists(), params] as const,
  detail: (sku: string) => [...productKeys.all, 'detail', sku] as const,
};

export interface ProductsListParams extends SearchParams {
  q?: string;
  incomplete?: boolean;
  page?: number;
  pageSize?: number;
}

export function useProducts(params: ProductsListParams, enabled = true) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: () => get<Paginated<Product>>('/products', params),
    placeholderData: (prev) => prev,
    enabled,
  });
}

export function useProduct(sku: string | undefined) {
  return useQuery({
    queryKey: productKeys.detail(sku ?? ''),
    queryFn: () => get<Product>(`/products/${encodeURIComponent(sku!)}`),
    enabled: !!sku,
  });
}

export function useInvalidateProducts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: productKeys.all });
}

export function useUpsertProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({ sku, input }: { sku: string; input: ProductPatch }) => put<Product & { created: boolean }>(`/products/${encodeURIComponent(sku)}`, input),
    onSettled: () => invalidate(),
  });
}

export function useAcceptSuggestion() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (sku: string) => post<Product>(`/products/${encodeURIComponent(sku)}/accept-suggestion`),
    onSettled: () => invalidate(),
  });
}

export function useRejectSuggestion() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (sku: string) => post<void>(`/products/${encodeURIComponent(sku)}/reject-suggestion`),
    onSettled: () => invalidate(),
  });
}

export function useDeleteProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (sku: string) => del(`/products/${encodeURIComponent(sku)}`),
    onSettled: () => invalidate(),
  });
}

export function useImportProducts() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (csv: string) => post<{ results: unknown[] }>('/products/import', { csv }),
    onSettled: () => invalidate(),
  });
}

export function useFindProductData() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (skus: string[]) => post<{ ok?: boolean; jobId?: string; queued?: number }>('/ai/product-data', { skus }),
    onSettled: () => invalidate(),
  });
}
