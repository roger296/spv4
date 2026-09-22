import { createFileRoute } from '@tanstack/react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-header';
import { AccountTab, TrackingBrandingTab } from '@/features/settings/account-tab';
import { WarehousesTab } from '@/features/settings/warehouses-tab';
import { AddressBookTab } from '@/features/settings/address-book-tab';
import { TeamTab } from '@/features/settings/team-tab';
import { BillingTab } from '@/features/settings/billing-tab';

const TABS = ['account', 'warehouses', 'address-book', 'team', 'billing', 'tracking'] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute('/_authed/settings/')({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <Tabs value={tab ?? 'account'} onValueChange={(v) => navigate({ search: { tab: v === 'account' ? undefined : (v as Tab) } })}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="address-book">Address book</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="tracking">Tracking page</TabsTrigger>
        </TabsList>
        <TabsContent value="account" className="mt-4">
          <AccountTab />
        </TabsContent>
        <TabsContent value="warehouses" className="mt-4">
          <WarehousesTab />
        </TabsContent>
        <TabsContent value="address-book" className="mt-4">
          <AddressBookTab />
        </TabsContent>
        <TabsContent value="team" className="mt-4">
          <TeamTab />
        </TabsContent>
        <TabsContent value="billing" className="mt-4">
          <BillingTab />
        </TabsContent>
        <TabsContent value="tracking" className="mt-4">
          <TrackingBrandingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
