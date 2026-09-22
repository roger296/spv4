import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { statusLabel } from '@/lib/order-status';
import { problemPhrase } from '@/lib/problem-phrases';

const STATUS_CLASSES: Record<string, string> = {
  NEW: 'bg-sky-100 text-sky-900',
  UPDATE_PRODUCT: 'bg-amber-100 text-amber-900',
  LABEL_GENERATED: 'bg-violet-100 text-violet-900',
  SHIPPED: 'bg-emerald-100 text-emerald-900',
  IN_TRANSIT: 'bg-emerald-100 text-emerald-900',
  DELIVERED: 'bg-emerald-200 text-emerald-950',
  PROBLEM: 'bg-red-100 text-red-900',
  CANCELLED: 'bg-zinc-200 text-zinc-700',
};

interface StatusBadgeProps {
  status: string | null | undefined;
  /** For PROBLEM orders, the problem kind is shown as its phrase. */
  problemReason?: string | null;
  className?: string;
}

export function StatusBadge({ status, problemReason, className }: StatusBadgeProps) {
  const label = status === 'PROBLEM' && problemReason ? `Problem · ${problemPhrase(problemReason)}` : statusLabel(status);
  return (
    <Badge variant="outline" className={cn('border-transparent whitespace-nowrap', STATUS_CLASSES[status ?? ''] ?? '', className)}>
      {label}
    </Badge>
  );
}

export function OkBadge({ ok, yes = 'OK', no = 'Failed' }: { ok: boolean | null | undefined; yes?: string; no?: string }) {
  if (ok === null || ok === undefined) {
    return <Badge variant="outline">Not tested</Badge>;
  }
  return (
    <Badge variant="outline" className={cn('border-transparent', ok ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900')}>
      {ok ? yes : no}
    </Badge>
  );
}
