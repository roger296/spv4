import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/page-header';
import { QueryState, Section } from '@/components/states';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError } from '@/components/auth-card';
import { useToast } from '@/hooks/use-toast';
import { exportMethodsCsv, useDeleteMethod, useImportMethods, useMethodBands, useMethods, useMethodsFromServices, useSetBands, useUpdateMethod, type MethodInput } from '@/features/methods/use-methods';
import { useCourierAccounts, useCourierProfiles } from '@/features/couriers/use-couriers';
import { errorMessage } from '@/lib/api';
import { formatDate, formatMoney, num } from '@/lib/format';
import type { Band, ShippingMethod } from '@/lib/types';
import { Trash2 } from 'lucide-react';

export const Route = createFileRoute('/_authed/methods/')({
  component: MethodsPage,
});

function MethodsPage() {
  const methods = useMethods();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<ShippingMethod | null>(null);
  const [bandsFor, setBandsFor] = React.useState<ShippingMethod | null>(null);
  const [historyFor, setHistoryFor] = React.useState<ShippingMethod | null>(null);
  const [deleting, setDeleting] = React.useState<ShippingMethod | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const remove = useDeleteMethod();

  const exportCsv = async () => {
    try {
      const text = await exportMethodsCsv();
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'shipping-methods.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      toast({ title: 'Export failed', description: errorMessage(err), variant: 'destructive' });
    }
  };

  const grouped = React.useMemo(() => {
    const map = new Map<string, ShippingMethod[]>();
    for (const m of methods.data ?? []) {
      const list = map.get(m.courierName) ?? [];
      list.push(m);
      map.set(m.courierName, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [methods.data]);

  const cheapest = (m: ShippingMethod) => {
    const costs = m.currentBands.map((b) => num(b.cost)).filter((c): c is number => c !== null);
    if (costs.length === 0) return '—';
    const lo = Math.min(...costs);
    const hi = Math.max(...costs);
    return lo === hi ? formatMoney(lo) : `${formatMoney(lo)} – ${formatMoney(hi)}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shipping methods"
        description="What each courier service costs you, and what it will and will not carry. The cheapest method that fits is chosen for every order."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
            <Button variant="outline" onClick={exportCsv}>
              Export CSV
            </Button>
            <Button onClick={() => setAddOpen(true)}>Add from services</Button>
          </>
        }
      />

      <QueryState isLoading={methods.isLoading} error={methods.error} data={methods.data} what="Shipping methods" onRetry={() => methods.refetch()}>
        {(items) =>
          items.length === 0 ? (
            <p className="rounded-md border border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
              No methods yet. Add a courier account, then "Add from services" to create one method per service.
            </p>
          ) : (
            <div className="space-y-4">
              {grouped.map(([courier, list]) => (
                <Section key={courier} title={courier}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-[var(--color-muted-foreground)]">
                        <tr>
                          <th className="py-1 pr-3 font-medium">Method</th>
                          <th className="py-1 pr-3 font-medium">Destinations</th>
                          <th className="py-1 pr-3 font-medium">Weight</th>
                          <th className="py-1 pr-3 font-medium">Size limits</th>
                          <th className="py-1 pr-3 font-medium">Carries</th>
                          <th className="py-1 pr-3 font-medium">Days</th>
                          <th className="py-1 pr-3 font-medium">Cost</th>
                          <th className="py-1 font-medium" />
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((m) => (
                          <tr key={m.id} className={m.active ? 'border-t border-[var(--color-border)]' : 'border-t border-[var(--color-border)] opacity-60'}>
                            <td className="py-2 pr-3">
                              <div className="font-medium">
                                {m.name}
                                {m.preferred && (
                                  <Badge variant="outline" className="ml-2">
                                    Preferred
                                  </Badge>
                                )}
                                {!m.active && (
                                  <Badge variant="outline" className="ml-2">
                                    Off
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-[var(--color-muted-foreground)]">
                                {m.serviceCode ?? ''}
                                {[m.tracked && 'tracked', m.signature && 'signature', m.express && 'express', m.returnsService && 'returns'].filter(Boolean).join(' · ') ? ` · ${[m.tracked && 'tracked', m.signature && 'signature', m.express && 'express', m.returnsService && 'returns'].filter(Boolean).join(' · ')}` : ''}
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-xs">
                              {m.destinationCountries.length === 0 ? 'Anywhere' : m.destinationCountries.join(', ')}
                              {m.excludedPostcodePrefixes.length > 0 && <div className="text-[var(--color-muted-foreground)]">not {m.excludedPostcodePrefixes.join(', ')}</div>}
                            </td>
                            <td className="py-2 pr-3 text-xs">
                              {num(m.minWeightKg) ?? 0}–{num(m.maxWeightKg) ?? '∞'} kg
                            </td>
                            <td className="py-2 pr-3 text-xs">
                              {[m.maxLengthCm && `L ${m.maxLengthCm}`, m.maxGirthCm && `girth ${m.maxGirthCm}`, m.maxThinnestCm && `thin ${m.maxThinnestCm}`].filter(Boolean).join(', ') || '—'}
                              {m.volumetricDivisor ? <div className="text-[var(--color-muted-foreground)]">÷{m.volumetricDivisor}</div> : null}
                            </td>
                            <td className="py-2 pr-3 text-xs">{[m.allowsLiquid && 'liquid', m.allowsBatteries && 'batteries', m.allowsFragile && 'fragile'].filter(Boolean).join(', ') || 'standard only'}</td>
                            <td className="py-2 pr-3 tabular-nums">{m.maxTransitDays ?? '—'}</td>
                            <td className="py-2 pr-3 tabular-nums">
                              {cheapest(m)}
                              <div className="text-xs text-[var(--color-muted-foreground)]">{m.currentBands.length} band{m.currentBands.length === 1 ? '' : 's'}</div>
                            </td>
                            <td className="py-2 text-right">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="outline" onClick={() => setBandsFor(m)}>
                                  Bands
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setHistoryFor(m)}>
                                  History
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
                                  Edit
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setDeleting(m)} aria-label={`Delete ${m.name}`}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              ))}
            </div>
          )
        }
      </QueryState>

      <EditMethodDialog method={editing} onClose={() => setEditing(null)} />
      <BandsDialog method={bandsFor} onClose={() => setBandsFor(null)} />
      <BandHistoryDialog method={historyFor} onClose={() => setHistoryFor(null)} />
      <AddFromServicesDialog open={addOpen} onOpenChange={setAddOpen} />
      <ImportMethodsDialog open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="It will no longer be offered for new orders. Past labels keep their record."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync(deleting!.id);
          toast({ title: 'Method deleted' });
        }}
      />
    </div>
  );
}

// ---- edit ----

function EditMethodDialog({ method, onClose }: { method: ShippingMethod | null; onClose: () => void }) {
  const { toast } = useToast();
  const update = useUpdateMethod();
  const [form, setForm] = React.useState<Record<string, string | boolean>>({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!method) return;
    setForm({
      name: method.name,
      destinationCountries: method.destinationCountries.join(', '),
      excludedPostcodePrefixes: method.excludedPostcodePrefixes.join(', '),
      minWeightKg: String(method.minWeightKg ?? ''),
      maxWeightKg: String(method.maxWeightKg ?? ''),
      maxLengthCm: String(method.maxLengthCm ?? ''),
      maxGirthCm: String(method.maxGirthCm ?? ''),
      maxThinnestCm: String(method.maxThinnestCm ?? ''),
      maxDeclaredValue: String(method.maxDeclaredValue ?? ''),
      maxTransitDays: String(method.maxTransitDays ?? ''),
      volumetricDivisor: String(method.volumetricDivisor ?? ''),
      tracked: method.tracked,
      signature: method.signature,
      express: method.express,
      allowsLiquid: method.allowsLiquid,
      allowsBatteries: method.allowsBatteries,
      allowsFragile: method.allowsFragile,
      returnsService: method.returnsService,
      preferred: method.preferred,
      active: method.active,
    });
    setError(null);
  }, [method]);

  const text = (k: string) => ({ value: String(form[k] ?? ''), onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value }) });
  const list = (v: unknown) =>
    String(v ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  const n = (k: string) => num(String(form[k] ?? ''));

  const save = async () => {
    if (!method) return;
    setError(null);
    if (!String(form.name ?? '').trim()) return setError('The method needs a name');
    const input: Partial<MethodInput> = {
      name: String(form.name).trim(),
      destinationCountries: list(form.destinationCountries),
      excludedPostcodePrefixes: list(form.excludedPostcodePrefixes),
      minWeightKg: n('minWeightKg'),
      maxWeightKg: n('maxWeightKg'),
      maxLengthCm: n('maxLengthCm'),
      maxGirthCm: n('maxGirthCm'),
      maxThinnestCm: n('maxThinnestCm'),
      maxDeclaredValue: n('maxDeclaredValue'),
      maxTransitDays: n('maxTransitDays'),
      volumetricDivisor: n('volumetricDivisor'),
      tracked: !!form.tracked,
      signature: !!form.signature,
      express: !!form.express,
      allowsLiquid: !!form.allowsLiquid,
      allowsBatteries: !!form.allowsBatteries,
      allowsFragile: !!form.allowsFragile,
      returnsService: !!form.returnsService,
      preferred: !!form.preferred,
      active: !!form.active,
    };
    try {
      await update.mutateAsync({ id: method.id, input });
      toast({ title: 'Method updated' });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const numberField = (k: string, label: string, step = '0.1') => (
    <div className="space-y-1">
      <Label htmlFor={`m-${k}`}>{label}</Label>
      <Input id={`m-${k}`} type="number" min={0} step={step} {...text(k)} />
    </div>
  );

  return (
    <Dialog open={method !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {method?.name}</DialogTitle>
          <DialogDescription>{method?.courierName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="m-name">Name</Label>
            <Input id="m-name" {...text('name')} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="m-dest">Destination countries (blank = anywhere)</Label>
              <Input id="m-dest" {...text('destinationCountries')} placeholder="GB, IE" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m-excl">Excluded postcode prefixes</Label>
              <Input id="m-excl" {...text('excludedPostcodePrefixes')} placeholder="BT, JE, GY, IM" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {numberField('minWeightKg', 'Min weight kg', '0.001')}
            {numberField('maxWeightKg', 'Max weight kg', '0.001')}
            {numberField('maxTransitDays', 'Max transit days', '1')}
            {numberField('maxLengthCm', 'Max length cm')}
            {numberField('maxGirthCm', 'Max girth cm')}
            {numberField('maxThinnestCm', 'Max thinnest side cm')}
            {numberField('maxDeclaredValue', 'Max declared value', '0.01')}
            {numberField('volumetricDivisor', 'Volumetric divisor', '1')}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(
              [
                ['tracked', 'Tracked'],
                ['signature', 'Signature'],
                ['express', 'Express'],
                ['allowsLiquid', 'Carries liquid'],
                ['allowsBatteries', 'Carries batteries'],
                ['allowsFragile', 'Carries fragile'],
                ['returnsService', 'Returns service'],
                ['preferred', 'Preferred when costs tie'],
                ['active', 'Active'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!form[k]} onCheckedChange={(v) => setForm({ ...form, [k]: v === true })} />
                {label}
              </label>
            ))}
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- bands ----

function BandsDialog({ method, onClose }: { method: ShippingMethod | null; onClose: () => void }) {
  const { toast } = useToast();
  const setBands = useSetBands();
  const [rows, setRows] = React.useState<{ min: string; max: string; cost: string }[]>([]);
  const [effectiveFrom, setEffectiveFrom] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!method) return;
    setRows(method.currentBands.length ? method.currentBands.map((b) => ({ min: String(b.minWeightKg), max: String(b.maxWeightKg), cost: String(b.cost) })) : [{ min: '0', max: '', cost: '' }]);
    setEffectiveFrom('');
    setNote('');
    setError(null);
  }, [method]);

  const save = async () => {
    if (!method) return;
    setError(null);
    const bands: Band[] = [];
    for (const [i, r] of rows.entries()) {
      const b = { minWeightKg: num(r.min), maxWeightKg: num(r.max), cost: num(r.cost) };
      if (b.minWeightKg === null || b.maxWeightKg === null || b.cost === null) return setError(`Band ${i + 1} needs min, max and cost`);
      if (b.maxWeightKg <= b.minWeightKg) return setError(`Band ${i + 1}: max must be above min`);
      bands.push({ minWeightKg: b.minWeightKg, maxWeightKg: b.maxWeightKg, cost: b.cost });
    }
    if (bands.length === 0) return setError('Add at least one band');
    try {
      await setBands.mutateAsync({ id: method.id, bands, effectiveFrom: effectiveFrom || undefined, note: note.trim() || undefined });
      toast({ title: 'Bands saved' });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={method !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cost bands — {method?.name}</DialogTitle>
          <DialogDescription>What the courier charges you per weight band. Saving with a future date keeps today's prices until then.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_1fr_36px] gap-2 text-xs text-[var(--color-muted-foreground)]">
            <span>From kg</span>
            <span>To kg</span>
            <span>Cost</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_36px] gap-2">
              <Input type="number" min={0} step="0.001" value={r.min} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} aria-label={`Band ${i + 1} from`} />
              <Input type="number" min={0} step="0.001" value={r.max} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} aria-label={`Band ${i + 1} to`} />
              <Input type="number" min={0} step="0.01" value={r.cost} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} aria-label={`Band ${i + 1} cost`} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove band ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => setRows([...rows, { min: rows[rows.length - 1]?.max ?? '0', max: '', cost: '' }])}>
            Add band
          </Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="b-from">Effective from (optional)</Label>
              <Input id="b-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="b-note">Note</Label>
              <Input id="b-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. April 2026 rate card" />
            </div>
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={setBands.isPending}>
            {setBands.isPending ? 'Saving…' : 'Save bands'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BandHistoryDialog({ method, onClose }: { method: ShippingMethod | null; onClose: () => void }) {
  const bands = useMethodBands(method?.id);
  const grouped = React.useMemo(() => {
    const map = new Map<string, Band[]>();
    for (const b of bands.data ?? []) {
      const key = b.effectiveFrom ?? 'current';
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [bands.data]);

  return (
    <Dialog open={method !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cost history — {method?.name}</DialogTitle>
        </DialogHeader>
        <QueryState isLoading={bands.isLoading} error={bands.error} data={bands.data} what="Band history">
          {(items) =>
            items.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">No bands recorded.</p>
            ) : (
              <div className="max-h-96 space-y-4 overflow-y-auto text-sm">
                {grouped.map(([from, list]) => (
                  <div key={from}>
                    <div className="mb-1 font-medium">
                      {from === 'current' ? 'Current' : `From ${formatDate(from)}`}
                      {list[0]?.note && <span className="ml-2 text-xs font-normal text-[var(--color-muted-foreground)]">{list[0].note}</span>}
                    </div>
                    <table className="w-full">
                      <tbody>
                        {list.map((b, i) => (
                          <tr key={i} className="border-t border-[var(--color-border)]">
                            <td className="py-1 tabular-nums">
                              {b.minWeightKg}–{b.maxWeightKg} kg
                            </td>
                            <td className="py-1 text-right tabular-nums">{formatMoney(b.cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )
          }
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

// ---- add from services ----

function AddFromServicesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const accounts = useCourierAccounts();
  const profiles = useCourierProfiles();
  const fromServices = useMethodsFromServices();
  const [accountId, setAccountId] = React.useState('');
  const [codes, setCodes] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);

  const account = (accounts.data ?? []).find((a) => a.id === accountId);
  const profile = account ? (profiles.data ?? []).find((p) => p.id === account.profileId) : undefined;
  const services = profile?.services ?? [];

  React.useEffect(() => setCodes(new Set()), [accountId]);

  const submit = async () => {
    setError(null);
    if (!accountId) return setError('Choose a courier account');
    if (codes.size === 0) return setError('Tick at least one service');
    try {
      const created = await fromServices.mutateAsync({ courierAccountId: accountId, serviceCodes: [...codes] });
      toast({ title: 'Methods added', description: `${Array.isArray(created) ? created.length : codes.size} created. Set their cost bands next.` });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add methods from services</DialogTitle>
          <DialogDescription>One method per ticked service, with the service's limits and flags copied in. Costs are added afterwards.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="afs-account">Courier account</Label>
            <Select value={accountId || '__none'} onValueChange={(v) => setAccountId(v === '__none' ? '' : v)}>
              <SelectTrigger id="afs-account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Choose…</SelectItem>
                {(accounts.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {account && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label>Services</Label>
                <Button size="sm" variant="ghost" onClick={() => setCodes(codes.size === services.length ? new Set() : new Set(services.map((s) => s.code)))}>
                  {codes.size === services.length ? 'Clear' : 'Select all'}
                </Button>
              </div>
              {services.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">This courier lists no services.</p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {services.map((s) => (
                    <li key={s.code}>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={codes.has(s.code)} onCheckedChange={(v) => setCodes((c) => { const n = new Set(c); if (v === true) n.add(s.code); else n.delete(s.code); return n; })} />
                        {s.name} <span className="font-mono text-xs text-[var(--color-muted-foreground)]">{s.code}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={fromServices.isPending}>
            {fromServices.isPending ? 'Adding…' : 'Add methods'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportMethodsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const importMethods = useImportMethods();
  const [csv, setCsv] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const submit = async () => {
    setError(null);
    if (!csv.trim()) return setError('Paste the CSV first');
    try {
      await importMethods.mutateAsync(csv);
      toast({ title: 'Methods imported' });
      setCsv('');
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import methods from CSV</DialogTitle>
          <DialogDescription>Use "Export CSV" to get the column layout; edit it and paste it back here. Rows match on courier and method name.</DialogDescription>
        </DialogHeader>
        <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={12} className="font-mono text-xs" aria-label="CSV text" />
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={importMethods.isPending}>
            {importMethods.isPending ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
