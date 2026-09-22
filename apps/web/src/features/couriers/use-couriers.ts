import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post, put } from '@/lib/api';
import type { CourierAccount, CourierProfile, CourierService, CourierTestReply, CredentialField } from '@/lib/types';

export const courierKeys = {
  profiles: ['courier-profiles'] as const,
  profile: (id: string) => ['courier-profiles', id] as const,
  accounts: ['courier-accounts'] as const,
};

export function useCourierProfiles() {
  return useQuery({ queryKey: courierKeys.profiles, queryFn: () => get<CourierProfile[]>('/courier-profiles') });
}

export function useCourierProfile(id: string | undefined) {
  return useQuery({
    queryKey: courierKeys.profile(id ?? ''),
    queryFn: () => get<CourierProfile>(`/courier-profiles/${id}`),
    enabled: !!id,
  });
}

export function useCourierAccounts() {
  return useQuery({ queryKey: courierKeys.accounts, queryFn: () => get<CourierAccount[]>('/courier-accounts') });
}

function useInvalidateCouriers() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: courierKeys.profiles });
    qc.invalidateQueries({ queryKey: courierKeys.accounts });
    qc.invalidateQueries({ queryKey: ['methods'] });
  };
}

export interface CourierAccountInput {
  profileId: string;
  name: string;
  credentials: Record<string, string>;
  sandbox: boolean;
}

export function useCreateCourierAccount() {
  const invalidate = useInvalidateCouriers();
  return useMutation({
    mutationFn: (input: CourierAccountInput) => post<CourierAccount>('/courier-accounts', input),
    onSettled: () => invalidate(),
  });
}

export function useUpdateCourierAccount() {
  const invalidate = useInvalidateCouriers();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CourierAccountInput> & { active?: boolean } }) =>
      patch<CourierAccount>(`/courier-accounts/${id}`, input),
    onSettled: () => invalidate(),
  });
}

export function useDeleteCourierAccount() {
  const invalidate = useInvalidateCouriers();
  return useMutation({
    mutationFn: (id: string) => del(`/courier-accounts/${id}`),
    onSettled: () => invalidate(),
  });
}

export function useTestCourierAccount() {
  const invalidate = useInvalidateCouriers();
  return useMutation({
    mutationFn: (id: string) => post<CourierTestReply>(`/courier-accounts/${id}/test`),
    onSettled: () => invalidate(),
  });
}

export interface OwnProfileInput {
  name: string;
  definition: unknown;
  credentialSchema: CredentialField[];
  services: CourierService[];
}

export function useCreateProfile() {
  const invalidate = useInvalidateCouriers();
  return useMutation({
    mutationFn: (input: OwnProfileInput) => post<CourierProfile>('/courier-profiles', input),
    onSettled: () => invalidate(),
  });
}

export function useUpdateProfile() {
  const invalidate = useInvalidateCouriers();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: OwnProfileInput }) => put<CourierProfile>(`/courier-profiles/${id}`, input),
    onSettled: () => invalidate(),
  });
}

export function useDraftProfile() {
  return useMutation({
    mutationFn: (input: { documentation?: string; url?: string }) => post<Partial<CourierProfile>>('/courier-profiles/draft', input),
  });
}

export type ProfileTestOperation = 'auth' | 'create_shipment' | 'get_label' | 'track' | 'void_shipment';

export function useTestProfile() {
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; courierAccountId: string; operation: ProfileTestOperation; sampleOrderReference?: string }) =>
      post<CourierTestReply>(`/courier-profiles/${id}/test`, body),
  });
}

export function useSubmitProfile() {
  const invalidate = useInvalidateCouriers();
  return useMutation({
    mutationFn: (id: string) => post<CourierProfile>(`/courier-profiles/${id}/submit`),
    onSettled: () => invalidate(),
  });
}
