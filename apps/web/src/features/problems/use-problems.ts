import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import type { Dashboard, Paginated, ProblemQueueItem, ReturnShipment } from '@/lib/types';

export const problemKeys = {
  all: ['problems'] as const,
  list: (params: Record<string, string | number | boolean | undefined>) => ['problems', 'list', params] as const,
};

export function useProblems(params: { open?: boolean; kind?: string; page?: number }) {
  return useQuery({
    queryKey: problemKeys.list(params),
    queryFn: () => get<Paginated<ProblemQueueItem>>('/problems', params),
    placeholderData: (prev) => prev,
  });
}

export function useResolveProblem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string }) => post<unknown>(`/problems/${id}/resolve`, { resolution }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: problemKeys.all });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useSuggestAction() {
  return useMutation({
    mutationFn: (id: string) => post<{ suggestion: string }>(`/problems/${id}/suggest`),
  });
}

export function useReturns() {
  return useQuery({ queryKey: ['returns'], queryFn: () => get<ReturnShipment[]>('/returns') });
}

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/dashboard'), refetchInterval: 120_000 });
}
