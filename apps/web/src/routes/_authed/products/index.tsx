import * as React from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Pagination } from '@/components/data-table/data-table';
import { PageHeader } from '@/components/page-header';
import { LoadError, LoadingRows } from '@/components/states';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError } from '@/components/auth-card';
import { useToast } from '@/hooks/use-toast';
import { useDebouncedSearch } from '@/hooks/use-debounce';
import { useAcceptSuggestion, useDeleteProduct, useFindProductData, useImportProducts, useProducts, useRejectSuggestion, useUpsertProduct } from '@/features/products/use-products';
import { errorMessage, isNotAvailable } from '@/lib/api';
import { num } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Product } from '@/lib/types';
import { Search, Sparkles } from 'lucide-react';

interface ProductsSearch {
  q?: string;
  incomplete?: boolean;
  page?: number;
}

export const Route = createFileRoute('/_authed/products/')({
  validateSearch: (search: Record<string, unknown>): ProductsSearch => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
    incomplete: search.incomplete === true || search.incomplete === 'true' ? true : undefined,
    page: typeof search.page === 'number' && search.page > 1 ? search.page : undefined,
  }),
  component: ProductsPage,
});

const PAGE_SIZE = 50;
type DimKey = 'weight' | 'length' | 'width' | 'height';
const DIMS: { key: DimKey; label: string; step: string }[] = [
  { key: 'weight', label: 'Weight kg', step: '0.001' },
  { key: 'length', label: 'Length cm', step: '0.1' },
  { key: 'width', label: 'Width cm', step: '0.1' },
  { key: 'height', label: 'Height cm', step: '0.1' },
];

function ProductsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { toast } = useToast();
  const [typed, setTyped] = React.useState(search.q ?? '');
  const debounced = useDebouncedSearch(typed);
  React.useEffect(() => {
    if ((search.q ?? '') !== debounced) navigate({ search: { ...search, q: debounced || undefined, page: undefined } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const page = search.page ?? 1;
  const products = useProducts({ q: search.q, incomplete: search.incomplete, page, pageSize: PAGE_SIZE });
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const find = useFindProductData();
  const remove = useDeleteProduct();

  React.useEffect(() => setSelected(new Set()), [search.q, search.incomplete, page]);

  const items = products.data?.items ?? [];
  const incompleteOnPage = items.filter((p) => !p.complete).map((p) => p.stockCode);

  const findData = async () => {
    const skus = selected.size > 0 ? [...selected] : incompleteOnPage;
    if (skus.length === 0) return toast({ title: 'Nothing to look up', description: 'Select products, or switch to the incomplete view.' });
    try {
      await find.mutateAsync(skus);
      toast({ title: 'Looking up weights and dimensions', description: `${skus.length} product${skus.length === 1 ? '' : 's'} queued. Suggestions appear here when ready.` });
    } catch (err) {
      toast({ title: isNotAvailable(err) ? 'Not available yet' : 'Could not start the lookup', description: isNotAvailable(err) ? 'AI product data is not switched on for this API build.' : errorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        description="Weight and dimensions per SKU. Orders cannot be labelled while a product on them is incomplete."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
            <Button onClick={findData} disabled={find.isPending}>
              <Sparkles className="h-4 w-4" /> {find.isPending ? 'Starting…' : 'Find weights and dimensions'}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2" role="group" aria-label="View">
          <Button size="sm" variant={search.incomplete ? 'outline' : 'default'} onClick={() => navigate({ search: { ...search, incomplete: undefined, page: undefined } })}>
            All products
          </Button>
          <Button size="sm" variant={search.incomplete ? 'default' : 'outline'} onClick={() => navigate({ search: { ...search, incomplete: true, page: undefined } })}>
            Incomplete products
          </Button>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" aria-hidden />
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="SKU, name, barcode or brand" aria-label="Search products" className="pl-9" />
        </div>
      </div>

      {products.isLoading ? (
        <LoadingRows rows={8} />
      ) : products.error ? (
        <LoadError error={products.error} onRetry={() => products.refetch()} />
      ) : items.length === 0 ? (
        <p className="rounded-md border border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          {search.incomplete ? 'Every product has a weight and dimensions.' : 'No products yet. They are created from orders, the API, or a CSV import.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted)] text-left">
              <tr>
                <th className="px-3 py-2">
                  <Checkbox
                    checked={items.length > 0 && items.every((p) => selected.has(p.stockCode))}
                    onCheckedChange={(c) => setSelected(c === true ? new Set(items.map((p) => p.stockCode)) : new Set())}
                    aria-label="Select all on this page"
                  />
                </th>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Name</th>
                {DIMS.map((d) => (
                  <th key={d.key} className="px-3 py-2 font-medium">
                    {d.label}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <ProductRow key={p.id} product={p} selected={selected.has(p.stockCode)} onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(p.stockCode); else n.delete(p.stockCode); return n; })} onDelete={() => setDeleting(p.stockCode)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={products.data?.total ?? 0} onPageChange={(p) => navigate({ search: { ...search, page: p > 1 ? p : undefined } })} />

      <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete product ${deleting}?`}
        description="Orders that already reference it keep their lines. It is recreated if a new order uses the SKU."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync(deleting!);
          toast({ title: 'Product deleted' });
        }}
      />
    </div>
  );
}

function ProductRow({ product, selected, onSelect, onDelete }: { product: Product; selected: boolean; onSelect: (v: boolean) => void; onDelete: () => void }) {
  const { toast } = useToast();
  const upsert = useUpsertProduct();
  const accept = useAcceptSuggestion();
  const reject = useRejectSuggestion();
  const [values, setValues] = React.useState<Record<DimKey, string>>(() => ({
    weight: product.weight == null ? '' : String(product.weight),
    length: product.length == null ? '' : String(product.length),
    width: product.width == null ? '' : String(product.width),
    height: product.height == null ? '' : String(product.height),
  }));
  const [saving, setSaving] = React.useState<DimKey | null>(null);
  const timer = React.useRef<number | null>(null);

  React.useEffect(() => {
    setValues({
      weight: product.weight == null ? '' : String(product.weight),
      length: product.length == null ? '' : String(product.length),
      width: product.width == null ? '' : String(product.width),
      height: product.height == null ? '' : String(product.height),
    });
  }, [product.weight, product.length, product.width, product.height]);

  /** Save on blur, debounced so a Tab through four fields sends one request per field at most. */
  const saveField = (key: DimKey) => {
    const current = num(values[key]);
    const stored = num(product[key]);
    if (current === stored) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setSaving(key);
      try {
        await upsert.mutateAsync({ sku: product.stockCode, input: { [key]: current } });
      } catch (err) {
        toast({ title: `Could not save ${key}`, description: errorMessage(err), variant: 'destructive' });
      } finally {
        setSaving(null);
      }
    }, 300);
  };

  const s = product.suggested;
  const hasSuggestion = !!s && (s.weight != null || s.length != null || s.width != null || s.height != null);

  return (
    <>
      <tr className={cn('border-b border-[var(--color-border)]', hasSuggestion ? 'bg-amber-50/60' : undefined)}>
        <td className="px-3 py-2">
          <Checkbox checked={selected} onCheckedChange={(c) => onSelect(c === true)} aria-label={`Select ${product.stockCode}`} />
        </td>
        <td className="px-3 py-2 font-mono text-xs">{product.stockCode}</td>
        <td className="max-w-xs truncate px-3 py-2" title={product.name}>
          {product.name}
          {product.brand && <span className="ml-1 text-xs text-[var(--color-muted-foreground)]">{product.brand}</span>}
        </td>
        {DIMS.map((d) => (
          <td key={d.key} className="px-3 py-1">
            <Input
              type="number"
              min={0}
              step={d.step}
              value={values[d.key]}
              onChange={(e) => setValues((v) => ({ ...v, [d.key]: e.target.value }))}
              onBlur={() => saveField(d.key)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label={`${product.stockCode} ${d.label}`}
              className={cn('h-8 w-24 tabular-nums', saving === d.key && 'opacity-60', !values[d.key] && 'border-amber-300')}
            />
          </td>
        ))}
        <td className="px-3 py-2">
          {product.complete ? (
            <Badge variant="outline" className="border-transparent bg-emerald-100 text-emerald-900">
              Complete
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
              Incomplete
            </Badge>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${product.stockCode}`}>
            Delete
          </Button>
        </td>
      </tr>
      {hasSuggestion && s && (
        <tr className="border-b border-[var(--color-border)] bg-amber-50">
          <td />
          <td colSpan={7} className="px-3 py-2 text-xs text-amber-950">
            <span className="mr-2 inline-flex items-center gap-1 font-medium">
              <Sparkles className="h-3 w-3" /> Suggested
            </span>
            {DIMS.filter((d) => s[d.key] != null)
              .map((d) => `${d.label} ${s[d.key]}`)
              .join(' · ')}
            <span className="ml-2 text-amber-800">({Math.round(s.confidence * 100)}% confident)</span>
            {s.sourceUrl && (
              <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="ml-2 underline">
                source
              </a>
            )}
            <span className="ml-3 inline-flex gap-1">
              <Button size="sm" variant="outline" className="h-7" onClick={() => accept.mutateAsync(product.stockCode).then(() => toast({ title: 'Suggestion accepted' }))} disabled={accept.isPending}>
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => {
                  // "Correct": drop the suggestion and put the cursor in the weight box.
                  reject.mutateAsync(product.stockCode).then(() => document.querySelector<HTMLInputElement>(`input[aria-label="${product.stockCode} Weight kg"]`)?.focus());
                }}
                disabled={reject.isPending}
              >
                Correct
              </Button>
            </span>
          </td>
        </tr>
      )}
    </>
  );
}

function ImportProductsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const importProducts = useImportProducts();
  const [csv, setCsv] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const submit = async () => {
    setError(null);
    if (!csv.trim()) return setError('Paste CSV text or choose a file');
    try {
      const r = await importProducts.mutateAsync(csv);
      toast({ title: 'Products imported', description: `${r.results.length} row${r.results.length === 1 ? '' : 's'}` });
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
          <DialogTitle>Import products from CSV</DialogTitle>
          <DialogDescription>
            Header row: <code className="text-xs">stockCode,name,ean,brand,weight,length,width,height,hsCode,countryOfOrigin,customsDescription,unitValue</code>. Weight in kg, sizes in cm. Existing SKUs are updated.
          </DialogDescription>
        </DialogHeader>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => setCsv(String(r.result ?? ''));
            r.readAsText(f);
          }}
        />
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => fileRef.current?.click()}>
          Choose file
        </Button>
        <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={10} className="font-mono text-xs" aria-label="CSV text" />
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={importProducts.isPending}>
            {importProducts.isPending ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
