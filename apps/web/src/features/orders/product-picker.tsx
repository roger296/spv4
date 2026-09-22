import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useDebouncedSearch } from '@/hooks/use-debounce';
import { useProducts } from '@/features/products/use-products';
import { formatKg } from '@/lib/format';
import type { Product } from '@/lib/types';
import { PackageSearch } from 'lucide-react';

interface ProductPickerProps {
  onPick: (product: Product) => void;
  label?: string;
}

/** Searches products by SKU, name, EAN or brand and hands one back. */
export function ProductPicker({ onPick, label = 'Add product' }: ProductPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const debounced = useDebouncedSearch(q);
  const products = useProducts({ q: debounced || undefined, pageSize: 25 }, open);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PackageSearch className="h-4 w-4" /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Find a product</DialogTitle>
          </DialogHeader>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, name, barcode or brand" autoFocus aria-label="Search products" />
          <div className="max-h-80 overflow-y-auto">
            {products.isLoading ? (
              <p className="py-4 text-sm text-[var(--color-muted-foreground)]">Loading…</p>
            ) : products.data && products.data.items.length > 0 ? (
              <ul className="divide-y divide-[var(--color-border)]">
                {products.data.items.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left text-sm hover:bg-[var(--color-muted)]"
                      onClick={() => {
                        onPick(p);
                        setOpen(false);
                      }}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="font-mono text-xs text-[var(--color-muted-foreground)]">{p.stockCode}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                        {formatKg(p.weight)}
                        {!p.complete && (
                          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                            Incomplete
                          </Badge>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-sm text-[var(--color-muted-foreground)]">
                {q ? 'No products match. You can still type the SKU into the line; the product is created when the order is saved.' : 'Type to search.'}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
