import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { QueryState } from '@/components/states';
import { useReturns } from '@/features/problems/use-problems';
import { openPdf } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

export const Route = createFileRoute('/_authed/returns/')({
  component: ReturnsPage,
});

function ReturnsPage() {
  const returns = useReturns();
  return (
    <div className="space-y-4">
      <PageHeader title="Returns" description="Return labels issued from orders, newest first." />
      <QueryState isLoading={returns.isLoading} error={returns.error} data={returns.data} what="The returns list" onRetry={() => returns.refetch()}>
        {(items) =>
          items.length === 0 ? (
            <p className="rounded-md border border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
              No return labels yet. Use "Return label" on an order to create one.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)]">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted)] text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Order</th>
                    <th className="px-3 py-2 font-medium">Courier</th>
                    <th className="px-3 py-2 font-medium">Tracking</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--color-border)] last:border-b-0">
                      <td className="px-3 py-2">
                        <Link to="/orders/$reference" params={{ reference: r.orderNumber }} className="font-medium hover:underline">
                          {r.orderNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{r.courierName ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.trackingNumber ?? '—'}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{r.status.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs">{formatDateTime(r.createdAt)}</td>
                      <td className="px-3 py-2 text-right">
                        {r.documentUrl && (
                          <Button size="sm" variant="outline" onClick={() => openPdf(r.documentUrl!.replace(/^\/v4/, ''))}>
                            Print label
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryState>
    </div>
  );
}
