import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, QueryState, Section } from '@/components/states';
import { useToast } from '@/hooks/use-toast';
import { useBilling, useStartSubscription } from './use-settings';
import { errorMessage, isNotAvailable } from '@/lib/api';
import { hasRole } from '@/lib/auth';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';

const STATUS_LABELS: Record<string, string> = {
  TRIAL: 'Free trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Payment overdue',
  BLOCKED: 'Blocked',
  CLOSED: 'Closed',
};

export function BillingTab() {
  const billing = useBilling();
  const start = useStartSubscription();
  const { toast } = useToast();
  const isOwner = hasRole('OWNER');

  const startSubscription = async () => {
    try {
      const r = await start.mutateAsync();
      window.location.href = r.checkoutUrl;
    } catch (err) {
      toast({ title: isNotAvailable(err) ? 'Not available yet' : 'Could not start the subscription', description: isNotAvailable(err) ? 'Billing is not switched on for this API build.' : errorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <QueryState isLoading={billing.isLoading} error={billing.error} data={billing.data} what="Billing" onRetry={() => billing.refetch()}>
      {(b) => (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Subscription">
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <Badge variant={b.status === 'PAST_DUE' || b.status === 'BLOCKED' ? 'destructive' : 'secondary'}>{STATUS_LABELS[b.status] ?? b.status}</Badge>
              </Field>
              <Field label="Billing">{b.billingMode === 'MOLLIE' ? 'Weekly by Direct Debit' : b.billingMode.toLowerCase()}</Field>
              {b.trialEndsAt && <Field label="Trial ends">{formatDate(b.trialEndsAt)}</Field>}
              <Field label="Weekly amount">{b.weeklyAmount != null ? formatMoney(b.weeklyAmount) : '—'}</Field>
              <Field label="Payment mandate">{b.hasMandate ? 'Set up' : 'Not set up'}</Field>
              <Field label="Last paid">{b.lastPaidAt ? formatDateTime(b.lastPaidAt) : '—'}</Field>
            </dl>
            {!b.hasMandate && (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Set up a payment mandate to keep buying labels after the trial. You are taken to a secure checkout page and brought back here.
                </p>
                {isOwner ? (
                  <Button onClick={startSubscription} disabled={start.isPending}>
                    {start.isPending ? 'Opening checkout…' : 'Start subscription'}
                  </Button>
                ) : (
                  <p className="text-sm">Ask the account owner to start the subscription.</p>
                )}
              </div>
            )}
          </Section>
          <Section title="Payments">
            {b.payments.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">No payments yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {b.payments.map((p) => (
                    <tr key={p.id} className="border-t border-[var(--color-border)] first:border-t-0">
                      <td className="py-1.5">{formatDateTime(p.createdAt)}</td>
                      <td className="py-1.5 tabular-nums">{formatMoney(p.amount, p.currency)}</td>
                      <td className="py-1.5 text-right">
                        <Badge variant="outline" className="capitalize">
                          {p.status.toLowerCase()}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      )}
    </QueryState>
  );
}
