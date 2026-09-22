import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Stationery } from '@spv4/shared-types';
import { del, get, patch, post } from '@/lib/api';
import type { Account, AccountSettings, AddressBookEntry, ApiKey, ApiKeyCreated, Billing, MeReply, TeamMember, Warehouse, Webhook } from '@/lib/types';

export const settingsKeys = {
  me: ['me'] as const,
  account: ['account'] as const,
  warehouses: ['warehouses'] as const,
  addressBook: (q: string) => ['address-book', q] as const,
  team: ['team'] as const,
  apiKeys: ['api-keys'] as const,
  webhooks: ['webhooks'] as const,
  billing: ['billing'] as const,
};

export function useMe() {
  return useQuery({ queryKey: settingsKeys.me, queryFn: () => get<MeReply>('/auth/me'), staleTime: 5 * 60_000 });
}

export function useAccount() {
  return useQuery({ queryKey: settingsKeys.account, queryFn: () => get<Account>('/account') });
}

export interface AccountPatch {
  name?: string;
  stationery?: Stationery;
  currency?: string;
  settings?: Partial<AccountSettings>;
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AccountPatch) => patch<Account>('/account', input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.account });
      qc.invalidateQueries({ queryKey: settingsKeys.me });
    },
  });
}

// ---- warehouses ----

export function useWarehouses() {
  return useQuery({ queryKey: settingsKeys.warehouses, queryFn: () => get<Warehouse[]>('/warehouses') });
}

export type WarehouseInput = Partial<Omit<Warehouse, 'id'>> & { name: string };

export function useSaveWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: WarehouseInput }) =>
      id ? patch<Warehouse>(`/warehouses/${id}`, input) : post<Warehouse>('/warehouses', input),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.warehouses }),
  });
}

export function useDeleteWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/warehouses/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.warehouses }),
  });
}

// ---- address book ----

export function useAddressBook(q = '') {
  return useQuery({ queryKey: settingsKeys.addressBook(q), queryFn: () => get<AddressBookEntry[]>('/address-book', { q }) });
}

export type AddressBookInput = Partial<Omit<AddressBookEntry, 'id' | 'lastUsedAt'>> & { label: string };

export function useSaveAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: AddressBookInput }) =>
      id ? patch<AddressBookEntry>(`/address-book/${id}`, input) : post<AddressBookEntry>('/address-book', input),
    onSettled: () => qc.invalidateQueries({ queryKey: ['address-book'] }),
  });
}

export function useDeleteAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/address-book/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['address-book'] }),
  });
}

// ---- team ----

export function useTeam() {
  return useQuery({ queryKey: settingsKeys.team, queryFn: () => get<TeamMember[]>('/team') });
}

export function useInviteTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; name: string; role: 'MANAGER' | 'OPERATOR' | 'READ_ONLY' }) =>
      post<TeamMember & { inviteToken?: string }>('/team/invite', input),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.team }),
  });
}

export function useUpdateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { role?: string; name?: string } }) => patch<TeamMember>(`/team/${id}`, input),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.team }),
  });
}

export function useRemoveTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/team/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.team }),
  });
}

// ---- API keys & webhooks ----

export function useApiKeys() {
  return useQuery({ queryKey: settingsKeys.apiKeys, queryFn: () => get<ApiKey[]>('/api-keys') });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; scopes: string[]; kind: 'api' | 'mcp'; clientName?: string }) => post<ApiKeyCreated>('/api-keys', input),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.apiKeys }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/api-keys/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.apiKeys }),
  });
}

export function useWebhooks() {
  return useQuery({ queryKey: settingsKeys.webhooks, queryFn: () => get<Webhook[]>('/webhooks') });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; events: string[] }) => post<Webhook>('/webhooks', input),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.webhooks }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/webhooks/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.webhooks }),
  });
}

// ---- billing ----

export function useBilling() {
  return useQuery({ queryKey: settingsKeys.billing, queryFn: () => get<Billing>('/billing') });
}

export function useStartSubscription() {
  return useMutation({ mutationFn: () => post<{ checkoutUrl: string }>('/billing/start') });
}
