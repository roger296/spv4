import * as React from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import type { OrderStatus } from '@spv4/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, Pagination } from '@/components/data-table/data-table';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { LoadError, LoadingRows } from '@/components/states';
import { useToast } from '@/hooks/use-toast';
import { useDebouncedSearch } from '@/hooks/use-debounce';
import { useBatchOrders, useOrderCounts, useOrders } from '@/features/orders/use-orders';
import { errorMessage, openPdf } from '@/lib/api';
import { formatAge, formatMoney } from '@/lib/format';
import { countryName } from '@/lib/countries';
import { CHIP_STATUSES, DEFAULT_FILTER, isChipActive, ordersQueryFor, scanMatch, STATUS_LABELS, toggleStatus, type OrdersFilterState } from '@/lib/order-status';
import { cn } from '@/lib/utils';
import type { OrderRow } from '@/lib/types';
import { Printer, Search, Truck, XCircle } from 'lucide-react';

interface OrdersSearch {
  status?: string;
  all?: boolean;
  q?: string;
  page?: number;
}

export const Route = createFileRoute('/_authed/orders/')({
  validateSearch: (search: Record<string, unknown>): OrdersSearch => ({
    status: typeof search.status === 'string' && search.status ? search.status : undefined,
    all: search.all === true || search.all === 'true' ? true : undefined,
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
    page: typeof search.page === 'number' && search.page > 1 ? search.page : undefined,
  }),
  component: OrdersPage,
});

const PAGE_SIZE = 50;

function OrdersPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const { toast } = useToast();

  const filter: OrdersFilterState = React.useMemo(
    () => ({
      showAll: !!search.all,
      statuses: (search.status?.split(',').filter(Boolean) as OrderStatus[] | undefined) ?? [],
    }),
    [search.all, search.status],
  );
  const setFilter = (next: OrdersFilterState) => {
    const q = ordersQueryFor(next);
    navigate({ search: { ...search, status: q.status, all: q.all, page: undefined } });
  };

  const [typed, setTyped] = React.useState(search.q ?? '');
  const debouncedQ = useDebouncedSearch(typed);
  React.useEffect(() => {
    if ((search.q ?? '') !== debouncedQ) navigate({ search: { ...search, q: debouncedQ || undefined, page: undefined } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const page = search.page ?? 1;
  const params = { ...ordersQueryFor(filter), q: search.q, page, pageSize: PAGE_SIZE };
  const orders = useOrders(params);
  const counts = useOrderCounts();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirm, setConfirm] = React.useState<'shipped' | 'cancel' | null>(null);
  const batch = useBatchOrders();

  React.useEffect(() => setSelected(new Set()), [search.status, search.all, search.q, page]);

  const items = orders.data?.items ?? [];

  /** Barcode-scan behaviour: Enter opens the one order that matches. */
  const handleEnter = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = typed.trim();
    if (!value) return;
    const fresh = await orders.refetch();
    const match = scanMatch(fresh.data?.items ?? items, value);
    if (match) navigate({ to: '/orders/$reference', params: { reference: match.orderNumber } });
  };

  const allOnPage = items.length > 0 && items.every((o) => selected.has(o.orderNumber));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(items.map((o) => o.orderNumber)));
  const toggleOne = (ref: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  const printSelected = async () => {
    try {
      await openPdf('/orders/print', { method: 'POST', body: { references: [...selected] } });
    } catch (err) {
      toast({ title: 'Could not print', description: errorMessage(err), variant: 'destructive' });
    }
  };

  const runBatch = async (action: 'shipped' | 'cancel') => {
    const result = await batch.mutateAsync({ references: [...selected], action });
    toast({
      title: action === 'shipped' ? 'Marked shipped' : 'Cancelled',
      description: `${result.done} done${result.failed ? `, ${result.failed} failed` : ''}`,
      variant: result.failed ? 'destructive' : 'default',
    });
    setSelected(new Set());
  };

  const columns = React.useMemo<ColumnDef<OrderRow, unknown>[]>(
    () => [
      {
        id: 'select',
        enableSorting: false,
        header: () => <Checkbox checked={allOnPage} onCheckedChange={toggleAll} aria-label="Select all on this page" />,
        cell: ({ row }) => (
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={selected.has(row.original.orderNumber)} onCheckedChange={() => toggleOne(row.original.orderNumber)} aria-label={`Select ${row.original.orderNumber}`} />
          </span>
        ),
      },
      {
        accessorKey: 'orderNumber',
        header: 'Reference',
        cell: ({ row }) => (
          <Link to="/orders/$reference" params={{ reference: row.original.orderNumber }} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {row.original.orderNumber}
          </Link>
        ),
      },
      {
        id: 'recipient',
        header: 'Recipient',
        accessorFn: (o) => o.contactName ?? o.customerName ?? '',
        cell: ({ row }) => {
          const o = row.original;
          return (
            <div>
              <div>{o.contactName ?? o.customerName ?? '—'}</div>
              <div className="text-xs text-[var(--color-muted-foreground)]">
                {[o.city, countryName(o.country)].filter(Boolean).join(', ')}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} problemReason={row.original.problemReason} />,
      },
      {
        id: 'method',
        header: 'Courier / method',
        accessorFn: (o) => `${o.courierName ?? ''} ${o.methodName ?? ''}`,
        cell: ({ row }) => {
          const o = row.original;
          if (!o.courierName && !o.methodName) return <span className="text-[var(--color-muted-foreground)]">—</span>;
          return (
            <div>
              <div>{o.courierName ?? '—'}</div>
              <div className="text-xs text-[var(--color-muted-foreground)]">{o.methodName ?? ''}</div>
            </div>
          );
        },
      },
      { accessorKey: 'cost', header: 'Cost', cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.cost, row.original.currencyCode)}</span> },
      {
        accessorKey: 'trackingNumber',
        header: 'Tracking',
        cell: ({ row }) =>
          row.original.trackingNumber ? (
            row.original.trackingLink ? (
              <a href={row.original.trackingLink} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline" onClick={(e) => e.stopPropagation()}>
                {row.original.trackingNumber}
              </a>
            ) : (
              <span className="font-mono text-xs">{row.original.trackingNumber}</span>
            )
          ) : (
            <span className="text-[var(--color-muted-foreground)]">—</span>
          ),
      },
      { accessorKey: 'createdAt', header: 'Age', cell: ({ row }) => <span title={row.original.createdAt}>{formatAge(row.original.createdAt)}</span> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, allOnPage, items],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/orders/import">Upload CSV</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/orders/simple">Simple parcel</Link>
            </Button>
            <Button asChild>
              <Link to="/orders/new">New order</Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Status filters">
          {CHIP_STATUSES.map((s) => {
            const active = isChipActive(filter, s);
            const n = counts.data?.[s] ?? 0;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(toggleStatus(filter, s))}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                  active
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                    : 'border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-muted)]',
                )}
              >
                {STATUS_LABELS[s]}
                <span className={cn('rounded-full px-1.5 text-xs tabular-nums', active ? 'bg-white/20' : 'bg-[var(--color-muted)]')}>{n}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setFilter(filter.showAll ? DEFAULT_FILTER : { statuses: [], showAll: true })}
            aria-pressed={filter.showAll}
            className={cn(
              'inline-flex items-center rounded-full border px-3 py-1 text-sm transition-colors',
              filter.showAll
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]',
            )}
          >
            Show all
          </button>
        </div>
        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" aria-hidden />
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={handleEnter}
            placeholder="Reference, tracking, name, postcode or SKU"
            aria-label="Search orders"
            className="pl-9"
          />
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Spaces and dashes are ignored. Scan or type a number and press Enter to open it.</p>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={printSelected}>
            <Printer className="h-4 w-4" /> Print labels
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm('shipped')}>
            <Truck className="h-4 w-4" /> Mark shipped
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm('cancel')}>
            <XCircle className="h-4 w-4" /> Cancel
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {orders.isLoading ? (
        <LoadingRows rows={8} />
      ) : orders.error ? (
        <LoadError error={orders.error} onRetry={() => orders.refetch()} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <DataTable
              columns={columns}
              data={items}
              emptyMessage={search.q ? 'No orders match that search.' : 'No orders here. Create one, upload a CSV, or connect your shop.'}
              onRowClick={(o) => navigate({ to: '/orders/$reference', params: { reference: o.orderNumber } })}
            />
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={orders.data?.total ?? 0} onPageChange={(p) => navigate({ search: { ...search, page: p > 1 ? p : undefined } })} />
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'cancel' ? `Cancel ${selected.size} order${selected.size === 1 ? '' : 's'}?` : `Mark ${selected.size} order${selected.size === 1 ? '' : 's'} as shipped?`}
        description={confirm === 'cancel' ? 'Labels already bought will be voided where the courier allows it.' : 'Use this when the parcels have left but the courier has not scanned them yet.'}
        confirmLabel={confirm === 'cancel' ? 'Cancel orders' : 'Mark shipped'}
        destructive={confirm === 'cancel'}
        onConfirm={() => runBatch(confirm!)}
      />
    </div>
  );
}
