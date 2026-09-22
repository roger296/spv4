import * as React from 'react';
import type { CreateOrderInput, DeliveryPromise } from '@spv4/shared-types';
import { DELIVERY_PROMISES } from '@spv4/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Section } from '@/components/states';
import { AddressFields, addressFromRow, addressToBody, EMPTY_ADDRESS, type AddressValues } from '@/features/_shared/address-fields';
import { AddressPicker } from './address-picker';
import { ProductPicker } from './product-picker';
import { useWarehouses } from '@/features/settings/use-settings';
import { useMethods } from '@/features/methods/use-methods';
import { num } from '@/lib/format';
import type { Order, Product } from '@/lib/types';
import { Trash2 } from 'lucide-react';

const PROMISE_LABELS: Record<DeliveryPromise, string> = {
  economy: 'Economy',
  standard: 'Standard',
  express: 'Express',
  next_day: 'Next day',
};

interface LineValues {
  sku: string;
  name: string;
  quantity: string;
  unitValue: string;
  weight: string;
}

interface ParcelValues {
  weight: string;
  length: string;
  width: string;
  height: string;
}

export interface OrderFormValues {
  reference: string;
  orderDate: string;
  warehouse: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryAddress: AddressValues;
  promiseKind: 'named' | 'date';
  promise: string;
  promiseDate: string;
  lines: LineValues[];
  parcels: ParcelValues[];
  incoterm: '' | 'DDU' | 'DDP';
  declaredValue: string;
  currency: string;
  signature: boolean;
  fragile: boolean;
  liquid: boolean;
  batteries: boolean;
  method: string;
  courier: string;
}

const EMPTY_LINE: LineValues = { sku: '', name: '', quantity: '1', unitValue: '', weight: '' };
const EMPTY_PARCEL: ParcelValues = { weight: '', length: '', width: '', height: '' };

export function emptyOrderForm(): OrderFormValues {
  return {
    reference: '',
    orderDate: new Date().toISOString().slice(0, 10),
    warehouse: '',
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    deliveryAddress: { ...EMPTY_ADDRESS },
    promiseKind: 'named',
    promise: 'standard',
    promiseDate: '',
    lines: [{ ...EMPTY_LINE }],
    parcels: [],
    incoterm: '',
    declaredValue: '',
    currency: 'GBP',
    signature: false,
    fragile: false,
    liquid: false,
    batteries: false,
    method: '',
    courier: '',
  };
}

export function orderToForm(order: Order): OrderFormValues {
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(order.deliverBy ?? '');
  return {
    reference: order.orderNumber,
    orderDate: order.orderDate,
    warehouse: order.warehouse?.name ?? '',
    customerName: order.customerName ?? '',
    customerEmail: order.customerEmail ?? '',
    customerPhone: order.customerPhone ?? '',
    deliveryAddress: addressFromRow(order),
    promiseKind: isDate ? 'date' : 'named',
    promise: order.deliveryPromise ?? 'standard',
    promiseDate: isDate ? order.deliverBy! : '',
    lines: order.lines.length
      ? order.lines.map((l) => ({
          sku: l.sku,
          name: l.name,
          quantity: String(l.quantity),
          unitValue: l.unitValue == null ? '' : String(l.unitValue),
          weight: l.weight == null ? '' : String(l.weight),
        }))
      : [{ ...EMPTY_LINE }],
    parcels: order.parcels.map((p) => ({ weight: String(p.weight ?? ''), length: String(p.length ?? ''), width: String(p.width ?? ''), height: String(p.height ?? '') })),
    incoterm: order.incoterm ?? '',
    declaredValue: order.declaredValue == null ? '' : String(order.declaredValue),
    currency: order.currencyCode ?? 'GBP',
    signature: order.signature,
    fragile: order.fragile,
    liquid: order.liquid,
    batteries: order.batteries,
    method: order.requestedMethod ?? '',
    courier: order.requestedCourier ?? '',
  };
}

/** Form strings → CreateOrderInput. Blank optional numbers are left out. */
export function formToInput(v: OrderFormValues, label: boolean): CreateOrderInput {
  const lines = v.lines
    .filter((l) => l.sku.trim())
    .map((l) => ({
      sku: l.sku.trim(),
      name: l.name.trim() || undefined,
      quantity: num(l.quantity) ?? 1,
      unitValue: num(l.unitValue) ?? undefined,
      weight: num(l.weight) ?? undefined,
    }));
  const parcels = v.parcels
    .filter((p) => num(p.weight) !== null)
    .map((p) => ({ weight: num(p.weight)!, length: num(p.length) ?? 0, width: num(p.width) ?? 0, height: num(p.height) ?? 0 }));
  const customs =
    v.incoterm || num(v.declaredValue) !== null
      ? { incoterm: v.incoterm || undefined, declaredValue: num(v.declaredValue) ?? undefined, currency: v.currency || undefined }
      : undefined;
  return {
    reference: v.reference.trim(),
    orderDate: v.orderDate || undefined,
    warehouse: v.warehouse || undefined,
    customer: v.customerName || v.customerEmail || v.customerPhone ? { name: v.customerName || undefined, email: v.customerEmail || undefined, phone: v.customerPhone || undefined } : undefined,
    deliveryAddress: addressToBody(v.deliveryAddress),
    deliveryPromise: v.promiseKind === 'date' ? v.promiseDate || undefined : v.promise || undefined,
    lines: lines.length ? lines : undefined,
    parcels: parcels.length ? parcels : undefined,
    customs,
    flags: { signature: v.signature, fragile: v.fragile, liquid: v.liquid, batteries: v.batteries },
    method: v.method || undefined,
    courier: v.courier || undefined,
    label,
  };
}

export function validateOrderForm(v: OrderFormValues): string | null {
  if (!v.reference.trim()) return 'A reference is required';
  const a = v.deliveryAddress;
  if (!a.contactName.trim()) return 'The recipient needs a contact name';
  if (!a.line1.trim()) return 'The delivery address needs a first line';
  if (!a.city.trim()) return 'The delivery address needs a town or city';
  if (!a.country.trim()) return 'The delivery address needs a country';
  if (v.promiseKind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v.promiseDate)) return 'Pick a deliver-by date';
  for (const [i, l] of v.lines.entries()) {
    if (l.sku.trim() && (num(l.quantity) ?? 0) <= 0) return `Line ${i + 1} needs a quantity`;
  }
  for (const [i, p] of v.parcels.entries()) {
    if ((num(p.weight) ?? 0) <= 0) return `Parcel ${i + 1} needs a weight`;
    if ((num(p.length) ?? 0) <= 0 || (num(p.width) ?? 0) <= 0 || (num(p.height) ?? 0) <= 0) return `Parcel ${i + 1} needs length, width and height`;
  }
  return null;
}

interface OrderFormProps {
  value: OrderFormValues;
  onChange: (next: OrderFormValues) => void;
  /** Editing an existing order: the reference cannot change. */
  editing?: boolean;
}

export function OrderForm({ value, onChange, editing = false }: OrderFormProps) {
  const warehouses = useWarehouses();
  const methods = useMethods();
  const set = <K extends keyof OrderFormValues>(k: K, v: OrderFormValues[K]) => onChange({ ...value, [k]: v });
  const text = (k: keyof OrderFormValues) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value as never);

  const setLine = (i: number, patch: Partial<LineValues>) => set('lines', value.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setParcel = (i: number, patch: Partial<ParcelValues>) => set('parcels', value.parcels.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const addProduct = (p: Product) => {
    const line: LineValues = { sku: p.stockCode, name: p.name, quantity: '1', unitValue: p.unitValue == null ? '' : String(p.unitValue), weight: p.weight == null ? '' : String(p.weight) };
    const blankIndex = value.lines.findIndex((l) => !l.sku.trim());
    set('lines', blankIndex >= 0 ? value.lines.map((l, j) => (j === blankIndex ? line : l)) : [...value.lines, line]);
  };

  const methodNames = React.useMemo(() => {
    const seen = new Set<string>();
    return (methods.data ?? []).filter((m) => m.active && !seen.has(m.name) && seen.add(m.name));
  }, [methods.data]);
  const courierNames = React.useMemo(() => [...new Set((methods.data ?? []).map((m) => m.courierName))].sort(), [methods.data]);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Section title="Order">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="reference">Reference</Label>
              <Input id="reference" value={value.reference} onChange={text('reference')} disabled={editing} placeholder="e.g. WEB-10432" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="orderDate">Order date</Label>
              <Input id="orderDate" type="date" value={value.orderDate} onChange={text('orderDate')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="warehouse">Warehouse</Label>
              <Select value={value.warehouse || '__default'} onValueChange={(v) => set('warehouse', v === '__default' ? '' : v)}>
                <SelectTrigger id="warehouse">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default">Default warehouse</SelectItem>
                  {(warehouses.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.name}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <Section
          title="Recipient"
          actions={
            <AddressPicker
              onPick={(address) => onChange({ ...value, deliveryAddress: address, customerName: value.customerName || address.contactName, customerEmail: value.customerEmail || address.email })}
            />
          }
        >
          <AddressFields value={value.deliveryAddress} onChange={(deliveryAddress) => set('deliveryAddress', deliveryAddress)} idPrefix="delivery" />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-[var(--color-muted-foreground)]">Customer details, if different from the recipient</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="customerName">Customer name</Label>
                <Input id="customerName" value={value.customerName} onChange={text('customerName')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="customerEmail">Customer email</Label>
                <Input id="customerEmail" type="email" value={value.customerEmail} onChange={text('customerEmail')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="customerPhone">Customer phone</Label>
                <Input id="customerPhone" value={value.customerPhone} onChange={text('customerPhone')} />
              </div>
            </div>
          </details>
        </Section>

        <Section title="Lines" actions={<ProductPicker onPick={addProduct} />}>
          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_2fr_80px_100px_100px_36px] gap-2 text-xs text-[var(--color-muted-foreground)] sm:grid">
              <span>SKU</span>
              <span>Name</span>
              <span>Qty</span>
              <span>Unit value</span>
              <span>Unit kg</span>
              <span />
            </div>
            {value.lines.map((line, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_2fr_80px_100px_100px_36px]">
                <Input value={line.sku} onChange={(e) => setLine(i, { sku: e.target.value })} placeholder="SKU" aria-label={`Line ${i + 1} SKU`} className="font-mono" />
                <Input value={line.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="Name (optional)" aria-label={`Line ${i + 1} name`} />
                <Input type="number" min={1} step={1} value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label={`Line ${i + 1} quantity`} />
                <Input type="number" min={0} step="0.01" value={line.unitValue} onChange={(e) => setLine(i, { unitValue: e.target.value })} placeholder="£" aria-label={`Line ${i + 1} unit value`} />
                <Input type="number" min={0} step="0.001" value={line.weight} onChange={(e) => setLine(i, { weight: e.target.value })} placeholder="kg" aria-label={`Line ${i + 1} unit weight`} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} onClick={() => set('lines', value.lines.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => set('lines', [...value.lines, { ...EMPTY_LINE }])}>
              Add line
            </Button>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Weight and size come from the product record when left blank. A SKU that is not on file is created when the order is saved.
            </p>
          </div>
        </Section>

        <Section title="Parcels" actions={<span className="text-xs text-[var(--color-muted-foreground)]">Leave empty to let Smooth Parcel work them out</span>}>
          <div className="space-y-2">
            {value.parcels.map((p, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_36px]">
                <Input type="number" min={0} step="0.001" value={p.weight} onChange={(e) => setParcel(i, { weight: e.target.value })} placeholder="Weight kg" aria-label={`Parcel ${i + 1} weight`} />
                <Input type="number" min={0} step="0.1" value={p.length} onChange={(e) => setParcel(i, { length: e.target.value })} placeholder="Length cm" aria-label={`Parcel ${i + 1} length`} />
                <Input type="number" min={0} step="0.1" value={p.width} onChange={(e) => setParcel(i, { width: e.target.value })} placeholder="Width cm" aria-label={`Parcel ${i + 1} width`} />
                <Input type="number" min={0} step="0.1" value={p.height} onChange={(e) => setParcel(i, { height: e.target.value })} placeholder="Height cm" aria-label={`Parcel ${i + 1} height`} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove parcel ${i + 1}`} onClick={() => set('parcels', value.parcels.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => set('parcels', [...value.parcels, { ...EMPTY_PARCEL }])}>
              Add parcel
            </Button>
          </div>
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Delivery promise">
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={value.promiseKind === 'named' ? 'default' : 'outline'} onClick={() => set('promiseKind', 'named')}>
                Service level
              </Button>
              <Button type="button" size="sm" variant={value.promiseKind === 'date' ? 'default' : 'outline'} onClick={() => set('promiseKind', 'date')}>
                Deliver by date
              </Button>
            </div>
            {value.promiseKind === 'named' ? (
              <Select value={value.promise} onValueChange={(v) => set('promise', v)}>
                <SelectTrigger aria-label="Delivery promise">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_PROMISES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROMISE_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input type="date" value={value.promiseDate} onChange={text('promiseDate')} aria-label="Deliver by" />
            )}
          </div>
        </Section>

        <Section title="Flags">
          <div className="grid gap-2">
            {(
              [
                ['signature', 'Signature on delivery'],
                ['fragile', 'Fragile'],
                ['liquid', 'Contains liquid'],
                ['batteries', 'Contains batteries'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox checked={value[k]} onCheckedChange={(c) => set(k, c === true)} />
                {label}
              </label>
            ))}
          </div>
        </Section>

        <Section title="Customs">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="incoterm">Incoterm</Label>
              <Select value={value.incoterm || '__none'} onValueChange={(v) => set('incoterm', v === '__none' ? '' : (v as 'DDU' | 'DDP'))}>
                <SelectTrigger id="incoterm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Not set</SelectItem>
                  <SelectItem value="DDU">DDU — recipient pays duties</SelectItem>
                  <SelectItem value="DDP">DDP — you pay duties</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <div className="space-y-1">
                <Label htmlFor="declaredValue">Declared value</Label>
                <Input id="declaredValue" type="number" min={0} step="0.01" value={value.declaredValue} onChange={text('declaredValue')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="currency">Currency</Label>
                <Input id="currency" value={value.currency} onChange={(e) => set('currency', e.target.value.toUpperCase().slice(0, 3))} maxLength={3} />
              </div>
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">Only needed outside the UK. Line values are used when the declared value is blank.</p>
          </div>
        </Section>

        <Section title="Method">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="method">Force a method</Label>
              <Select value={value.method || '__auto'} onValueChange={(v) => set('method', v === '__auto' ? '' : v)}>
                <SelectTrigger id="method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto">Cheapest that fits</SelectItem>
                  {methodNames.map((m) => (
                    <SelectItem key={m.id} value={m.name}>
                      {m.name} — {m.courierName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="courier">Prefer a courier</Label>
              <Select value={value.courier || '__any'} onValueChange={(v) => set('courier', v === '__any' ? '' : v)}>
                <SelectTrigger id="courier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any">Any courier</SelectItem>
                  {courierNames.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
