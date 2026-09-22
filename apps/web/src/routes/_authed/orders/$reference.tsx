import * as React from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field, LoadError, LoadingRows, Section } from '@/components/states';
import { NeedsInformation, NoMethodFits } from '@/components/needs-information';
import { FormError } from '@/components/auth-card';
import { useToast } from '@/hooks/use-toast';
import { formatAddressLines } from '@/features/_shared/address-fields';
import { formToInput, OrderForm, orderToForm, validateOrderForm, type OrderFormValues } from '@/features/orders/order-form';
import {
  useAddNote,
  useBuyLabel,
  useCancelOrder,
  useMarkShipped,
  useOrder,
  useOrderHistory,
  useRefreshTracking,
  useRelabel,
  useResolveOrderProblem,
  useReturnLabel,
  useSetParcels,
  useUpdateOrder,
} from '@/features/orders/use-orders';
import { useSuggestAction } from '@/features/problems/use-problems';
import { errorMessage, isNotAvailable, NeedsInformationError, NoMethodError, openPdf, downloadFile } from '@/lib/api';
import { countryName } from '@/lib/countries';
import { formatDate, formatDateTime, formatDims, formatKg, formatMoney, num } from '@/lib/format';
import { problemPhrase } from '@/lib/problem-phrases';
import { statusLabel } from '@/lib/order-status';
import { hasRole } from '@/lib/auth';
import type { HistoryEntry, Order, Parcel, RankedMethod } from '@/lib/types';
import { ChevronDown, ExternalLink, Printer, RefreshCw } from 'lucide-react';

export const Route = createFileRoute('/_authed/orders/$reference')({
  component: OrderPage,
});

const PROMISE_LABELS: Record<string, string> = { economy: 'Economy', standard: 'Standard', express: 'Express', next_day: 'Next day' };

function OrderPage() {
  const { reference } = Route.useParams();
  const { toast } = useToast();
  const order = useOrder(reference);
  const history = useOrderHistory(reference);
  const [editing, setEditing] = React.useState(false);
  const [confirm, setConfirm] = React.useState<'cancel' | 'shipped' | null>(null);
  const [labelError, setLabelError] = React.useState<NeedsInformationError | NoMethodError | string | null>(null);

  const buyLabel = useBuyLabel(reference);
  const relabel = useRelabel(reference);
  const cancel = useCancelOrder(reference);
  const shipped = useMarkShipped(reference);
  const returnLabel = useReturnLabel(reference);
  const refresh = useRefreshTracking(reference);

  const canWrite = hasRole('OPERATOR');

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setLabelError(null);
    try {
      await fn();
      toast({ title: label });
    } catch (err) {
      if (err instanceof NeedsInformationError || err instanceof NoMethodError) setLabelError(err);
      else if (isNotAvailable(err)) toast({ title: 'Not available yet', description: `${label} is not switched on for this API build.` });
      else toast({ title: `${label} failed`, description: errorMessage(err), variant: 'destructive' });
    }
  };

  if (order.isLoading) return <LoadingRows rows={8} />;
  if (order.error || !order.data) return <LoadError error={order.error ?? new Error('Order not found')} onRetry={() => order.refetch()} />;
  const o = order.data;
  const open = !['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'].includes(o.status);
  const hasLabel = o.documents.some((d) => d.kind === 'label');
  const label = o.documents.find((d) => d.kind === 'label');

  const printKinds = (kinds: string) => openPdf(`/orders/${encodeURIComponent(reference)}/print`, { searchParams: { kinds } });

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {o.orderNumber}
            <StatusBadge status={o.status} problemReason={o.problemReason} />
            {o.duplicate && <Badge variant="outline">Duplicate reference</Badge>}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {o.courierName || o.methodName ? (
              <span>
                {o.courierName ?? '—'} · {o.methodName ?? '—'} · {formatMoney(o.cost, o.currencyCode)}
              </span>
            ) : (
              <span>No label yet</span>
            )}
            {o.trackingNumber && (
              <span className="font-mono">
                {o.trackingLink ? (
                  <a href={o.trackingLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    {o.trackingNumber} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  o.trackingNumber
                )}
              </span>
            )}
            <span>Created {formatDateTime(o.createdAt)}</span>
          </span>
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to="/orders">Back</Link>
            </Button>
            {canWrite && open && !hasLabel && (
              <Button size="sm" onClick={() => run('Label bought', () => buyLabel.mutateAsync(undefined))} disabled={buyLabel.isPending}>
                {buyLabel.isPending ? 'Buying…' : 'Buy label'}
              </Button>
            )}
            {hasLabel && (
              <Button size="sm" variant="outline" onClick={() => printKinds('label')}>
                <Printer className="h-4 w-4" /> Reprint
              </Button>
            )}
            {canWrite && open && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {canWrite && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    More <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {open && hasLabel && (
                    <DropdownMenuItem onSelect={() => document.getElementById('method-card')?.scrollIntoView({ behavior: 'smooth' })}>Change method</DropdownMenuItem>
                  )}
                  {(o.status === 'LABEL_GENERATED' || o.status === 'PROBLEM') && <DropdownMenuItem onSelect={() => setConfirm('shipped')}>Mark shipped</DropdownMenuItem>}
                  {['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'LABEL_GENERATED', 'PROBLEM'].includes(o.status) && (
                    <DropdownMenuItem onSelect={() => run('Return label requested', () => returnLabel.mutateAsync(undefined))}>Return label</DropdownMenuItem>
                  )}
                  {o.trackingNumber && <DropdownMenuItem onSelect={() => run('Tracking refreshed', () => refresh.mutateAsync(undefined))}>Refresh tracking</DropdownMenuItem>}
                  {open && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-[var(--color-destructive)]" onSelect={() => setConfirm('cancel')}>
                        Cancel order
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {labelError instanceof NeedsInformationError && (
        <NeedsInformation
          reference={o.orderNumber}
          missing={labelError.body.missing}
          lineSkus={o.lines.map((l) => l.sku)}
          onRetry={() => run('Label bought', () => buyLabel.mutateAsync(undefined))}
          retrying={buyLabel.isPending}
          onEdit={() => setEditing(true)}
        />
      )}
      {labelError instanceof NoMethodError && (
        <NoMethodFits reference={o.orderNumber} dropped={labelError.body.dropped} onRetry={() => run('Label bought', () => buyLabel.mutateAsync(undefined))} retrying={buyLabel.isPending} />
      )}
      {!labelError && o.missing.length > 0 && open && (
        <NeedsInformation
          reference={o.orderNumber}
          missing={o.missing}
          lineSkus={o.lines.map((l) => l.sku)}
          onRetry={() => run('Label bought', () => buyLabel.mutateAsync(undefined))}
          retrying={buyLabel.isPending}
          onEdit={() => setEditing(true)}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Recipient">
              <address className="not-italic text-sm">
                {formatAddressLines({ ...o, country: countryName(o.country) }).map((line, i) => (
                  <div key={i} className={i === 0 ? 'font-medium' : undefined}>
                    {line}
                  </div>
                ))}
              </address>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <Field label="Phone">{o.phone ?? o.customerPhone ?? '—'}</Field>
                <Field label="Email">{o.email ?? o.customerEmail ?? '—'}</Field>
                {o.customerName && o.customerName !== o.contactName && <Field label="Customer">{o.customerName}</Field>}
              </dl>
            </Section>
            <Section title="Warehouse">
              <dl className="grid grid-cols-2 gap-2">
                <Field label="Ships from">{o.warehouse?.name ?? '—'}</Field>
                <Field label="Country">{countryName(o.warehouse?.country)}</Field>
                <Field label="Order date">{formatDate(o.orderDate)}</Field>
                <Field label="Source">{o.source}</Field>
              </dl>
            </Section>
          </div>

          <Section title="Delivery, flags and customs">
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="Promise">{o.deliverBy ? `By ${formatDate(o.deliverBy)}` : (PROMISE_LABELS[o.deliveryPromise] ?? o.deliveryPromise)}</Field>
              <Field label="Flags">
                {[o.signature && 'Signature', o.fragile && 'Fragile', o.liquid && 'Liquid', o.batteries && 'Batteries'].filter(Boolean).join(', ') || 'None'}
              </Field>
              <Field label="Incoterm">{o.incoterm ?? '—'}</Field>
              <Field label="Declared value">{formatMoney(o.declaredValue, o.currencyCode)}</Field>
              {(o.requestedMethod || o.requestedCourier) && <Field label="Requested">{[o.requestedCourier, o.requestedMethod].filter(Boolean).join(' · ')}</Field>}
            </dl>
          </Section>

          <Section title={`Lines (${o.lines.length})`}>
            {o.lines.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">No product lines.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-[var(--color-muted-foreground)]">
                  <tr>
                    <th className="py-1 pr-3 font-medium">SKU</th>
                    <th className="py-1 pr-3 font-medium">Name</th>
                    <th className="py-1 pr-3 font-medium">Qty</th>
                    <th className="py-1 pr-3 font-medium">Unit kg</th>
                    <th className="py-1 pr-3 font-medium">Size</th>
                    <th className="py-1 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {o.lines.map((l) => (
                    <tr key={l.id} className="border-t border-[var(--color-border)]">
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        <Link to="/products" search={{ q: l.sku }} className="hover:underline">
                          {l.sku}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3">{l.name}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{l.quantity}</td>
                      <td className="py-1.5 pr-3">{formatKg(l.weight)}</td>
                      <td className="py-1.5 pr-3">{formatDims(l.length, l.width, l.height)}</td>
                      <td className="py-1.5">{formatMoney(l.unitValue, o.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <ParcelsSection order={o} reference={reference} editable={canWrite && open} />

          <MethodCard order={o} onUse={(m) => run(`Relabelled with ${m.name}`, () => relabel.mutateAsync({ method: m.methodId }))} busy={relabel.isPending} canWrite={canWrite && open} />

          <Section
            title="Documents"
            actions={
              hasLabel ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => printKinds('label')}>
                    <Printer className="h-4 w-4" /> Label
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => printKinds('label,packing_note')}>
                    <Printer className="h-4 w-4" /> Label + packing note
                  </Button>
                </>
              ) : undefined
            }
          >
            {o.documents.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">No documents yet. They appear once a label is bought.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)] text-sm">
                {o.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium capitalize">{d.kind.replace('_', ' ')}</span>
                      <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">
                        {d.stationery ?? ''} {formatDateTime(d.createdAt)}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openPdf(d.url.replace(/^\/v4/, ''))}>
                        View
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => downloadFile(d.url.replace(/^\/v4/, ''), `${o.orderNumber}-${d.kind}.pdf`)}>
                        Download
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {label && !o.documents.some((d) => d.kind === 'packing_note') && (
              <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">The packing note is generated on demand when printed with the label.</p>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section
            title="Tracking"
            actions={
              o.trackingNumber && canWrite ? (
                <Button size="sm" variant="ghost" onClick={() => run('Tracking refreshed', () => refresh.mutateAsync(undefined))} disabled={refresh.isPending} aria-label="Refresh tracking">
                  <RefreshCw className={refresh.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                </Button>
              ) : undefined
            }
          >
            {o.trackingEvents.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">{o.trackingNumber ? 'No scans yet.' : 'No tracking until a label is bought.'}</p>
            ) : (
              <ol className="space-y-3 border-l border-[var(--color-border)] pl-4 text-sm">
                {o.trackingEvents.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-[var(--color-primary)]" aria-hidden />
                    <div className="font-medium">{e.description ?? e.courierStatus}</div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {formatDateTime(e.occurredAt)}
                      {e.location ? ` · ${e.location}` : ''}
                      {e.mappedStatus ? ` · ${statusLabel(e.mappedStatus)}` : ''}
                      {e.problemKind ? ` · ${problemPhrase(e.problemKind)}` : ''}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <ProblemsSection order={o} reference={reference} canWrite={canWrite} />

          <HistorySection reference={reference} entries={history.data} loading={history.isLoading} error={history.error} canNote={hasRole('READ_ONLY')} />
        </div>
      </div>

      <EditOrderDialog order={o} reference={reference} open={editing} onOpenChange={setEditing} />

      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`Cancel order ${o.orderNumber}?`}
        description="Any label already bought is voided where the courier allows it."
        confirmLabel="Cancel order"
        destructive
        onConfirm={() => run('Order cancelled', () => cancel.mutateAsync({}))}
      />
      <ConfirmDialog
        open={confirm === 'shipped'}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`Mark ${o.orderNumber} as shipped?`}
        description="Use this when the parcel has left but the courier has not scanned it yet."
        confirmLabel="Mark shipped"
        onConfirm={() => run('Marked shipped', () => shipped.mutateAsync(undefined))}
      />
    </div>
  );
}

// ---- parcels ----

function ParcelsSection({ order, reference, editable }: { order: Order; reference: string; editable: boolean }) {
  const { toast } = useToast();
  const setParcels = useSetParcels(reference);
  const [editing, setEditing] = React.useState(false);
  const [rows, setRows] = React.useState<{ weight: string; length: string; width: string; height: string }[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const startEdit = () => {
    setRows(order.parcels.length ? order.parcels.map((p) => ({ weight: String(p.weight ?? ''), length: String(p.length ?? ''), width: String(p.width ?? ''), height: String(p.height ?? '') })) : [{ weight: '', length: '', width: '', height: '' }]);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const parcels = rows.map((r) => ({ weight: num(r.weight) ?? 0, length: num(r.length) ?? 0, width: num(r.width) ?? 0, height: num(r.height) ?? 0 }));
    if (parcels.some((p) => p.weight <= 0 || p.length <= 0 || p.width <= 0 || p.height <= 0)) {
      setError('Every parcel needs a weight, length, width and height above zero');
      return;
    }
    try {
      await setParcels.mutateAsync({ parcels });
      toast({ title: 'Parcels saved' });
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const summary = (p: Parcel) => `${formatKg(p.weight)} · ${formatDims(p.length, p.width, p.height)}`;

  return (
    <Section
      title={`Parcels (${order.parcels.length})`}
      actions={
        editable && !editing ? (
          <Button size="sm" variant="outline" onClick={startEdit}>
            Edit parcels
          </Button>
        ) : undefined
      }
    >
      {editing ? (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
              <Input type="number" step="0.001" min={0} value={r.weight} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} placeholder="kg" aria-label={`Parcel ${i + 1} weight`} />
              <Input type="number" step="0.1" min={0} value={r.length} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, length: e.target.value } : x)))} placeholder="L cm" aria-label={`Parcel ${i + 1} length`} />
              <Input type="number" step="0.1" min={0} value={r.width} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, width: e.target.value } : x)))} placeholder="W cm" aria-label={`Parcel ${i + 1} width`} />
              <Input type="number" step="0.1" min={0} value={r.height} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, height: e.target.value } : x)))} placeholder="H cm" aria-label={`Parcel ${i + 1} height`} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length === 1}>
                Remove
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setRows([...rows, { weight: '', length: '', width: '', height: '' }])}>
              Add parcel
            </Button>
            <Button size="sm" onClick={save} disabled={setParcels.isPending}>
              {setParcels.isPending ? 'Saving…' : 'Save parcels'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          <FormError message={error} />
        </div>
      ) : order.parcels.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Worked out from the lines when the label is bought.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] text-sm">
          {order.parcels.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">Parcel {p.sequence}</span> <span className="text-[var(--color-muted-foreground)]">{summary(p)}</span>
                {p.estimated && (
                  <Badge variant="outline" className="ml-2">
                    Estimated
                  </Badge>
                )}
              </span>
              {p.trackingNumber && <span className="font-mono text-xs">{p.trackingNumber}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---- method selection ----

function MethodCard({ order, onUse, busy, canWrite }: { order: Order; onUse: (m: RankedMethod) => void; busy: boolean; canWrite: boolean }) {
  const sel = order.selection;
  return (
    <div id="method-card">
      <Section title="Method">
        {!sel ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">No method has been chosen yet.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <div className="font-medium">
                {order.methodName ?? sel.ranked.find((r) => r.methodId === sel.chosenMethodId)?.name ?? 'No method'}
                {order.courierName ? ` · ${order.courierName}` : ''}
              </div>
              <p className="text-[var(--color-muted-foreground)]">{sel.reason}</p>
            </div>
            {sel.ranked.length > 0 && (
              <table className="w-full">
                <thead className="text-left text-xs text-[var(--color-muted-foreground)]">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Method</th>
                    <th className="py-1 pr-2 font-medium">Cost</th>
                    <th className="py-1 pr-2 font-medium">Days</th>
                    <th className="py-1 pr-2 font-medium">Chargeable</th>
                    <th className="py-1 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {sel.ranked.map((r) => {
                    const chosen = r.methodId === sel.chosenMethodId;
                    return (
                      <tr key={r.methodId} className={chosen ? 'border-t border-[var(--color-border)] bg-[var(--color-muted)]' : 'border-t border-[var(--color-border)]'}>
                        <td className="py-1.5 pr-2">
                          {r.name} <span className="text-xs text-[var(--color-muted-foreground)]">{r.courier}</span>
                        </td>
                        <td className="py-1.5 pr-2 tabular-nums">{formatMoney(r.cost, order.currencyCode)}</td>
                        <td className="py-1.5 pr-2 tabular-nums">{r.transitDays}</td>
                        <td className="py-1.5 pr-2">{formatKg(r.chargeableKg)}</td>
                        <td className="py-1.5 text-right">
                          {chosen ? (
                            <Badge variant="outline">Chosen</Badge>
                          ) : canWrite ? (
                            <Button size="sm" variant="outline" onClick={() => onUse(r)} disabled={busy}>
                              Use this
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {sel.dropped.length > 0 && (
              <details className="text-xs text-[var(--color-muted-foreground)]">
                <summary className="cursor-pointer">{sel.dropped.length} method{sel.dropped.length === 1 ? '' : 's'} did not fit</summary>
                <ul className="mt-1 space-y-0.5">
                  {sel.dropped.map((d, i) => (
                    <li key={`${d.name}-${i}`}>
                      {d.name} — {d.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

// ---- problems ----

function ProblemsSection({ order, reference, canWrite }: { order: Order; reference: string; canWrite: boolean }) {
  const { toast } = useToast();
  const resolve = useResolveOrderProblem(reference);
  const suggest = useSuggestAction();
  const [resolving, setResolving] = React.useState<string | null>(null);
  const [resolution, setResolution] = React.useState('');
  const [suggestions, setSuggestions] = React.useState<Record<string, string>>({});

  const submitResolve = async () => {
    if (!resolving || !resolution.trim()) return;
    try {
      await resolve.mutateAsync({ problemId: resolving, resolution: resolution.trim() });
      toast({ title: 'Problem resolved' });
      setResolving(null);
      setResolution('');
    } catch (err) {
      toast({ title: 'Could not resolve', description: errorMessage(err), variant: 'destructive' });
    }
  };

  const askSuggestion = async (id: string) => {
    try {
      const r = await suggest.mutateAsync(id);
      setSuggestions((s) => ({ ...s, [id]: r.suggestion }));
    } catch (err) {
      toast({ title: isNotAvailable(err) ? 'Suggestions not available yet' : 'Could not get a suggestion', description: isNotAvailable(err) ? undefined : errorMessage(err), variant: 'destructive' });
    }
  };

  const problems = order.problems;
  return (
    <Section title={`Problems (${problems.filter((p) => !p.resolvedAt).length} open)`}>
      {problems.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">No problems.</p>
      ) : (
        <ul className="space-y-3 text-sm">
          {problems.map((p) => (
            <li key={p.id} className={p.resolvedAt ? 'opacity-60' : undefined}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{problemPhrase(p.kind)}</div>
                  <p className="text-[var(--color-muted-foreground)]">{p.description}</p>
                  <div className="text-xs text-[var(--color-muted-foreground)]">Opened {formatDateTime(p.openedAt)}</div>
                </div>
                {p.resolvedAt ? <Badge variant="outline">Resolved</Badge> : <Badge variant="destructive">Open</Badge>}
              </div>
              {(suggestions[p.id] ?? p.suggestedAction) && (
                <p className="mt-1 rounded-md bg-[var(--color-muted)] p-2 text-xs">
                  <span className="font-medium">Suggested: </span>
                  {suggestions[p.id] ?? p.suggestedAction}
                </p>
              )}
              {p.resolvedAt && p.resolution && (
                <p className="mt-1 text-xs">
                  <span className="font-medium">Resolution: </span>
                  {p.resolution} {p.resolvedBy ? `(${p.resolvedBy})` : ''}
                </p>
              )}
              {!p.resolvedAt && canWrite && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setResolving(p.id)}>
                    Resolve
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => askSuggestion(p.id)} disabled={suggest.isPending}>
                    {suggest.isPending ? 'Thinking…' : 'Suggest action'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={resolving !== null} onOpenChange={(v) => !v && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve problem</DialogTitle>
          </DialogHeader>
          <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was done, e.g. Re-sent with a corrected postcode" rows={4} autoFocus aria-label="Resolution" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button onClick={submitResolve} disabled={!resolution.trim() || resolve.isPending}>
              {resolve.isPending ? 'Saving…' : 'Mark resolved'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

// ---- history + notes ----

function describeHistory(h: HistoryEntry): string {
  if (h.kind === 'note') return h.note ?? (typeof h.after === 'object' && h.after && 'note' in h.after ? String((h.after as { note: unknown }).note) : 'Note');
  if (h.kind === 'view') return 'Viewed';
  const action = h.action.replace(/^order\./, '').replace(/[._]/g, ' ');
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function HistorySection({ reference, entries, loading, error, canNote }: { reference: string; entries: HistoryEntry[] | undefined; loading: boolean; error: unknown; canNote: boolean }) {
  const { toast } = useToast();
  const addNote = useAddNote(reference);
  const [note, setNote] = React.useState('');

  const submit = async () => {
    if (!note.trim()) return;
    try {
      await addNote.mutateAsync(note.trim());
      setNote('');
    } catch (err) {
      toast({ title: 'Could not add the note', description: errorMessage(err), variant: 'destructive' });
    }
  };

  const shown = (entries ?? []).filter((h) => h.kind !== 'view');
  return (
    <Section title="History">
      {loading ? (
        <LoadingRows rows={3} />
      ) : error ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">History could not be loaded.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Nothing yet.</p>
      ) : (
        <ul className="max-h-96 space-y-3 overflow-y-auto text-sm">
          {shown.map((h) => (
            <li key={h.id} className={h.kind === 'note' ? 'rounded-md bg-amber-50 p-2' : undefined}>
              <div className={h.kind === 'note' ? 'whitespace-pre-wrap' : 'font-medium'}>{describeHistory(h)}</div>
              <div className="text-xs text-[var(--color-muted-foreground)]">
                {formatDateTime(h.createdAt)}
                {h.actorName ? ` · ${h.actorName}` : ''}
                {h.clientName && h.clientName !== 'web' ? ` · via ${h.clientName}` : ''}
              </div>
              {h.kind === 'action' && !!h.after && typeof h.after === 'object' && Object.keys(h.after as object).length > 0 && (
                <details className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  <summary className="cursor-pointer">Changes</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify({ before: h.before, after: h.after }, null, 2)}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {canNote && (
        <div className="mt-3 space-y-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note" aria-label="New note" />
          <Button size="sm" onClick={submit} disabled={!note.trim() || addNote.isPending}>
            {addNote.isPending ? 'Adding…' : 'Add note'}
          </Button>
        </div>
      )}
    </Section>
  );
}

// ---- edit ----

function EditOrderDialog({ order, reference, open, onOpenChange }: { order: Order; reference: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const update = useUpdateOrder(reference);
  const [form, setForm] = React.useState<OrderFormValues>(() => orderToForm(order));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setForm(orderToForm(order));
      setError(null);
    }
  }, [open, order]);

  const save = async () => {
    const problem = validateOrderForm(form);
    if (problem) return setError(problem);
    const { reference: _ref, label: _label, ...patch } = formToInput(form, false);
    try {
      await update.mutateAsync(patch);
      toast({ title: 'Order updated' });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {order.orderNumber}</DialogTitle>
        </DialogHeader>
        <OrderForm value={form} onChange={setForm} editing />
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
