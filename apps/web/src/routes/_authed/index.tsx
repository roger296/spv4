import { createFileRoute, Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { NotAvailable, LoadError, Section } from '@/components/states';
import { useDashboard } from '@/features/problems/use-problems';
import { useOrderCounts } from '@/features/orders/use-orders';
import { isNotAvailable } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { STATUS_LABELS } from '@/lib/order-status';
import { ORDER_STATUSES } from '@spv4/shared-types';
import { AlertTriangle, Package, PoundSterling, Tag } from 'lucide-react';

export const Route = createFileRoute('/_authed/')({
  component: DashboardPage,
});

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  description?: string;
  to?: string;
  search?: Record<string, string>;
}

function KpiCard({ icon: Icon, title, value, description, to, search }: KpiCardProps) {
  const body = (
    <Card className={to ? 'transition-colors hover:bg-[var(--color-muted)]' : undefined}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">{title}</CardTitle>
        <Icon className="h-4 w-4 text-[var(--color-muted-foreground)]" aria-hidden />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && <CardDescription className="mt-1">{description}</CardDescription>}
      </CardContent>
    </Card>
  );
  return to ? (
    <Link to={to} search={search}>
      {body}
    </Link>
  ) : (
    body
  );
}

function DashboardPage() {
  const dashboard = useDashboard();
  const counts = useOrderCounts();

  if (dashboard.isLoading && counts.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // The dashboard endpoint may not exist yet; the counts endpoint does, so
  // the status tiles always render.
  const data = dashboard.data;
  const statusCounts = data?.counts ?? counts.data ?? {};
  const openProblems = data?.openProblems ?? statusCounts.PROBLEM ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Where your orders stand today."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/orders/simple">Simple parcel</Link>
            </Button>
            <Button asChild>
              <Link to="/orders/new">New order</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={AlertTriangle} title="Open problems" value={String(openProblems)} description="Oldest first on the Problems page" to="/problems" />
        <KpiCard
          icon={Tag}
          title="Labels this week"
          value={data ? String(data.labelsThisWeek.reduce((n, c) => n + c.count, 0)) : '—'}
          description={data ? `${data.labelsThisWeek.length} courier${data.labelsThisWeek.length === 1 ? '' : 's'}` : 'Not available yet'}
        />
        <KpiCard icon={PoundSterling} title="Cost this week" value={data ? formatMoney(data.costThisWeek) : '—'} description="Label costs from your bands" />
        <KpiCard
          icon={Package}
          title="Incomplete products"
          value={data ? String(data.incompleteProducts) : '—'}
          description="Missing weight or dimensions"
          to="/products"
          search={{ incomplete: 'true' }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Orders by status">
          {counts.error && !data ? (
            <LoadError error={counts.error} onRetry={() => counts.refetch()} />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {ORDER_STATUSES.map((s) => (
                <li key={s} className="flex items-center justify-between py-2 text-sm">
                  <Link to="/orders" search={{ status: s }} className="hover:underline">
                    {STATUS_LABELS[s]}
                  </Link>
                  <span className="font-medium tabular-nums">{statusCounts[s] ?? 0}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Labels this week by courier">
          {dashboard.error ? (
            isNotAvailable(dashboard.error) ? (
              <NotAvailable what="The dashboard summary" />
            ) : (
              <LoadError error={dashboard.error} onRetry={() => dashboard.refetch()} />
            )
          ) : data && data.labelsThisWeek.length > 0 ? (
            <ul className="divide-y divide-[var(--color-border)]">
              {data.labelsThisWeek.map((c) => (
                <li key={c.courier} className="flex items-center justify-between py-2 text-sm">
                  <span>{c.courier}</span>
                  <span className="font-medium tabular-nums">{c.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--color-muted-foreground)]">No labels bought yet this week.</p>
          )}
        </Section>
      </div>

      {data?.digest && (
        <Section title="Today's digest">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{data.digest}</p>
        </Section>
      )}
    </div>
  );
}
