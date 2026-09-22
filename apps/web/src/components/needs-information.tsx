import { Link } from '@tanstack/react-router';
import type { MissingField } from '@spv4/shared-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

/**
 * Where a missing field can be fixed. Product paths such as
 * `lines[0].weight` or `products.SKU-1.weight` link to that product; anything
 * else stays on the order.
 */
export function missingFieldLink(path: string, sku?: string): { to: string; search?: Record<string, string>; label: string } | null {
  const productSku = sku ?? path.match(/^products?\[?['"]?([^\]'".]+)['"]?\]?\./)?.[1] ?? null;
  if (productSku) {
    return { to: '/products', search: { q: productSku }, label: `Open product ${productSku}` };
  }
  if (/^(lines|parcels)\b/.test(path) || /weight|dimension|length|width|height/i.test(path)) {
    return { to: '/products', search: { incomplete: 'true' }, label: 'Open incomplete products' };
  }
  return null;
}

/** Plain-English label for a missing-field path. */
export function missingFieldLabel(path: string): string {
  return path
    .replace(/\[(\d+)\]/g, (_, i) => ` ${Number(i) + 1}`)
    .replace(/\./g, ' › ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

interface NeedsInformationProps {
  reference: string;
  missing: MissingField[];
  /** Line SKUs by index so `lines[0].weight` can link to the product. */
  lineSkus?: string[];
  onRetry?: () => void;
  retrying?: boolean;
  onEdit?: () => void;
}

export function NeedsInformation({ reference, missing, lineSkus, onRetry, retrying, onEdit }: NeedsInformationProps) {
  return (
    <Card className="border-amber-300 bg-amber-50" role="alert">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-amber-950">
          <AlertCircle className="h-4 w-4" aria-hidden />
          Order {reference} needs more information before a label can be bought
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2 text-sm">
          {missing.map((m, i) => {
            const lineIndex = m.path.match(/^lines\[(\d+)\]/)?.[1];
            const sku = lineIndex !== undefined ? lineSkus?.[Number(lineIndex)] : undefined;
            const link = missingFieldLink(m.path, sku);
            return (
              <li key={`${m.path}-${i}`} className="rounded-md border border-amber-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {missingFieldLabel(m.path)}
                    {sku && <span className="ml-2 font-mono text-xs text-[var(--color-muted-foreground)]">{sku}</span>}
                  </span>
                  {link && (
                    <Link to={link.to} search={link.search} className="text-xs underline underline-offset-2">
                      {link.label}
                    </Link>
                  )}
                </div>
                <p className="mt-1 text-[var(--color-muted-foreground)]">{m.reason}</p>
                {m.alternatives && m.alternatives.length > 0 && (
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                    Alternatives: {m.alternatives.join(', ')}
                  </p>
                )}
                {m.options && m.options.length > 0 && (
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Options: {m.options.join(', ')}</p>
                )}
              </li>
            );
          })}
        </ul>
        {(onRetry || onEdit) && (
          <div className="flex gap-2">
            {onRetry && (
              <Button size="sm" onClick={onRetry} disabled={retrying}>
                {retrying ? 'Trying…' : 'Try again'}
              </Button>
            )}
            {onEdit && (
              <Button size="sm" variant="outline" onClick={onEdit}>
                Edit order
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface NoMethodProps {
  reference: string;
  dropped: { name: string; reason: string }[];
  onRetry?: () => void;
  retrying?: boolean;
}

export function NoMethodFits({ reference, dropped, onRetry, retrying }: NoMethodProps) {
  return (
    <Card className="border-red-300 bg-red-50" role="alert">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-red-950">
          <AlertCircle className="h-4 w-4" aria-hidden />
          No shipping method fits order {reference}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {dropped.length === 0 ? (
          <p className="text-sm">No active methods cover this destination. Add one under Shipping methods.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {dropped.map((d, i) => (
              <li key={`${d.name}-${i}`}>
                <span className="font-medium">{d.name}</span>
                <span className="text-[var(--color-muted-foreground)]"> — {d.reason}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/methods">Shipping methods</Link>
          </Button>
          {onRetry && (
            <Button size="sm" onClick={onRetry} disabled={retrying}>
              {retrying ? 'Trying…' : 'Try again'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
