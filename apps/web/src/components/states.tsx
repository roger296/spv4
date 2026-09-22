import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { errorMessage, isNotAvailable } from '@/lib/api';
import { Clock, AlertTriangle } from 'lucide-react';

/** A calm placeholder for an endpoint the API does not serve yet. */
export function NotAvailable({ what = 'This section' }: { what?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <Clock className="h-8 w-8 text-[var(--color-muted-foreground)]" aria-hidden />
        <p className="font-medium">Not available yet</p>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {what} is not switched on for this API build. Check back after the next deploy.
        </p>
      </CardContent>
    </Card>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center" role="alert">
        <AlertTriangle className="h-8 w-8 text-[var(--color-destructive)]" aria-hidden />
        <p className="font-medium">Could not load</p>
        <p className="text-sm text-[var(--color-muted-foreground)]">{errorMessage(error)}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

interface QueryStateProps<T> {
  isLoading: boolean;
  error: unknown;
  data: T | undefined;
  what?: string;
  onRetry?: () => void;
  children: (data: T) => React.ReactNode;
}

/** Loading → skeleton; 404 route → Not available; error → message; else render. */
export function QueryState<T>({ isLoading, error, data, what, onRetry, children }: QueryStateProps<T>) {
  if (isLoading) return <LoadingRows />;
  if (error) {
    if (isNotAvailable(error)) return <NotAvailable what={what} />;
    return <LoadError error={error} onRetry={onRetry} />;
  }
  if (data === undefined) return <NotAvailable what={what} />;
  return <>{children(data)}</>;
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="mt-0.5 text-sm">{children ?? '—'}</dd>
    </div>
  );
}

export function Section({ title, actions, children, className }: { title: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}
