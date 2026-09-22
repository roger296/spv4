import * as React from 'react';
import type { Stationery } from '@spv4/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QueryState, Section } from '@/components/states';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError } from '@/components/auth-card';
import { useToast } from '@/hooks/use-toast';
import { AddressFields, addressFromRow, addressToBody, EMPTY_ADDRESS, formatAddressLines, type AddressValues } from '@/features/_shared/address-fields';
import { StationeryRadio } from './account-tab';
import { useDeleteWarehouse, useSaveWarehouse, useWarehouses } from './use-settings';
import { useMethods } from '@/features/methods/use-methods';
import { errorMessage } from '@/lib/api';
import { hasRole } from '@/lib/auth';
import type { Warehouse } from '@/lib/types';

export function WarehousesTab() {
  const warehouses = useWarehouses();
  const remove = useDeleteWarehouse();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<Warehouse | 'new' | null>(null);
  const [deleting, setDeleting] = React.useState<Warehouse | null>(null);
  const canEdit = hasRole('MANAGER');

  return (
    <Section
      title="Warehouses"
      actions={
        canEdit ? (
          <Button size="sm" onClick={() => setEditing('new')}>
            Add warehouse
          </Button>
        ) : undefined
      }
    >
      <QueryState isLoading={warehouses.isLoading} error={warehouses.error} data={warehouses.data} what="Warehouses" onRetry={() => warehouses.refetch()}>
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">No warehouses yet. Orders need one to ship from.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {items.map((w) => (
                <li key={w.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <div>
                    <div className="font-medium">
                      {w.name}
                      {w.isDefault && (
                        <Badge variant="outline" className="ml-2">
                          Default
                        </Badge>
                      )}
                      {w.externalRef && <span className="ml-2 font-mono text-xs text-[var(--color-muted-foreground)]">{w.externalRef}</span>}
                    </div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">{formatAddressLines(w).slice(0, 5).join(', ')}</div>
                    <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                      {w.autoLabel ? 'Auto-label' : 'Manual label'} · {w.packingNote ? 'Packing note' : 'No packing note'} · Shipped after {w.shippedAfterHours}h
                      {w.stationery ? ` · ${w.stationery.replace('_', ' ')}` : ''}
                      {w.allowedMethodIds?.length ? ` · ${w.allowedMethodIds.length} allowed method${w.allowedMethodIds.length === 1 ? '' : 's'}` : ''}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEditing(w)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(w)} disabled={w.isDefault}>
                        Delete
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
      <WarehouseDialog warehouse={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Orders already shipped from it keep their record."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await remove.mutateAsync(deleting!.id);
            toast({ title: 'Warehouse deleted' });
          } catch (err) {
            toast({ title: 'Could not delete', description: errorMessage(err), variant: 'destructive' });
          }
        }}
      />
    </Section>
  );
}

function WarehouseDialog({ warehouse, open, onClose }: { warehouse: Warehouse | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const save = useSaveWarehouse();
  const methods = useMethods();
  const [name, setName] = React.useState('');
  const [externalRef, setExternalRef] = React.useState('');
  const [address, setAddress] = React.useState<AddressValues>({ ...EMPTY_ADDRESS });
  const [isDefault, setIsDefault] = React.useState(false);
  const [eori, setEori] = React.useState('');
  const [vat, setVat] = React.useState('');
  const [ioss, setIoss] = React.useState('');
  const [stationery, setStationery] = React.useState<Stationery | ''>('');
  const [autoLabel, setAutoLabel] = React.useState(true);
  const [packingNote, setPackingNote] = React.useState(true);
  const [shippedAfter, setShippedAfter] = React.useState('24');
  const [restrict, setRestrict] = React.useState(false);
  const [allowed, setAllowed] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(warehouse?.name ?? '');
    setExternalRef(warehouse?.externalRef ?? '');
    setAddress(warehouse ? addressFromRow(warehouse) : { ...EMPTY_ADDRESS });
    setIsDefault(warehouse?.isDefault ?? false);
    setEori(warehouse?.eori ?? '');
    setVat(warehouse?.vatNumber ?? '');
    setIoss(warehouse?.iossNumber ?? '');
    setStationery(warehouse?.stationery ?? '');
    setAutoLabel(warehouse?.autoLabel ?? true);
    setPackingNote(warehouse?.packingNote ?? true);
    setShippedAfter(String(warehouse?.shippedAfterHours ?? 24));
    setRestrict(!!warehouse?.allowedMethodIds?.length);
    setAllowed(new Set(warehouse?.allowedMethodIds ?? []));
    setError(null);
  }, [open, warehouse]);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError('The warehouse needs a name');
    const hours = Number(shippedAfter);
    if (!Number.isInteger(hours) || hours < 1 || hours > 240) return setError('Shipped-after must be a whole number of hours between 1 and 240');
    const a = addressToBody(address);
    try {
      await save.mutateAsync({
        id: warehouse?.id,
        input: {
          name: name.trim(),
          externalRef: externalRef.trim() || null,
          ...a,
          contactName: a.contactName || null,
          line1: a.line1 || null,
          city: a.city || null,
          postCode: a.postCode || null,
          isDefault,
          eori: eori.trim() || null,
          vatNumber: vat.trim() || null,
          iossNumber: ioss.trim() || null,
          stationery: stationery || null,
          autoLabel,
          packingNote,
          shippedAfterHours: hours,
          allowedMethodIds: restrict ? [...allowed] : null,
        },
      });
      toast({ title: warehouse ? 'Warehouse updated' : 'Warehouse added' });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{warehouse ? `Edit ${warehouse.name}` : 'Add warehouse'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="wh-name">Name</Label>
              <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wh-ref">External reference (used by integrations)</Label>
              <Input id="wh-ref" value={externalRef} onChange={(e) => setExternalRef(e.target.value)} className="font-mono" />
            </div>
          </div>
          <AddressFields value={address} onChange={setAddress} idPrefix="wh" requireContact={false} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="wh-eori">EORI</Label>
              <Input id="wh-eori" value={eori} onChange={(e) => setEori(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wh-vat">VAT number</Label>
              <Input id="wh-vat" value={vat} onChange={(e) => setVat(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wh-ioss">IOSS number</Label>
              <Input id="wh-ioss" value={ioss} onChange={(e) => setIoss(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Stationery</Label>
            <StationeryRadio value={stationery} onChange={setStationery} name="wh-stationery" allowInherit />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(v === true)} /> Default warehouse
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={autoLabel} onCheckedChange={(v) => setAutoLabel(v === true)} /> Buy labels automatically for new orders
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={packingNote} onCheckedChange={(v) => setPackingNote(v === true)} /> Print a packing note with the label
            </label>
            <div className="flex items-center gap-2 text-sm">
              <Label htmlFor="wh-hours" className="whitespace-nowrap">
                Mark shipped after
              </Label>
              <Input id="wh-hours" type="number" min={1} max={240} value={shippedAfter} onChange={(e) => setShippedAfter(e.target.value)} className="w-20" />
              hours
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={restrict} onCheckedChange={(v) => setRestrict(v === true)} /> Only allow certain shipping methods from here
            </label>
            {restrict && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-[var(--color-border)] p-2">
                {(methods.data ?? []).map((m) => (
                  <li key={m.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={allowed.has(m.id)} onCheckedChange={(v) => setAllowed((s) => { const n = new Set(s); if (v === true) n.add(m.id); else n.delete(m.id); return n; })} />
                      {m.courierName} — {m.name}
                    </label>
                  </li>
                ))}
                {(methods.data ?? []).length === 0 && <li className="text-xs text-[var(--color-muted-foreground)]">No methods yet.</li>}
              </ul>
            )}
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
