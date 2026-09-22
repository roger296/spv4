import * as React from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { NeedsInformation, NoMethodFits } from '@/components/needs-information';
import { FormError } from '@/components/auth-card';
import { useToast } from '@/hooks/use-toast';
import { emptyOrderForm, formToInput, OrderForm, validateOrderForm } from '@/features/orders/order-form';
import { useCreateOrder } from '@/features/orders/use-orders';
import { errorMessage, NeedsInformationError, NoMethodError } from '@/lib/api';

export const Route = createFileRoute('/_authed/orders/new')({
  component: NewOrderPage,
});

function NewOrderPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [form, setForm] = React.useState(emptyOrderForm);
  const [error, setError] = React.useState<string | null>(null);
  const [needs, setNeeds] = React.useState<NeedsInformationError | NoMethodError | null>(null);
  const create = useCreateOrder();

  const submit = async (label: boolean) => {
    setError(null);
    setNeeds(null);
    const problem = validateOrderForm(form);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      const order = await create.mutateAsync(formToInput(form, label));
      toast({ title: label ? (order.status === 'LABEL_GENERATED' ? 'Label bought' : 'Order saved') : 'Order saved', description: order.orderNumber });
      navigate({ to: '/orders/$reference', params: { reference: order.orderNumber } });
    } catch (err) {
      if (err instanceof NeedsInformationError || err instanceof NoMethodError) {
        // The order was saved; the label needs more. Show what, and offer the order page.
        setNeeds(err);
        return;
      }
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="New order"
        description="Save it now and buy the label, or save it to label later."
        actions={
          <Button asChild variant="ghost">
            <Link to="/orders">Back to orders</Link>
          </Button>
        }
      />
      {needs instanceof NeedsInformationError && (
        <NeedsInformation
          reference={needs.body.reference}
          missing={needs.body.missing}
          lineSkus={form.lines.map((l) => l.sku)}
          onEdit={() => navigate({ to: '/orders/$reference', params: { reference: needs.body.reference } })}
        />
      )}
      {needs instanceof NoMethodError && <NoMethodFits reference={needs.body.reference} dropped={needs.body.dropped} />}
      {needs && (
        <p className="text-sm">
          The order has been saved as <Link to="/orders/$reference" params={{ reference: needs.body.reference }} className="underline underline-offset-2">{needs.body.reference}</Link>.
        </p>
      )}
      <OrderForm value={form} onChange={setForm} />
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => submit(true)} disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Save and buy label'}
        </Button>
        <Button variant="outline" onClick={() => submit(false)} disabled={create.isPending}>
          Save only
        </Button>
      </div>
    </div>
  );
}
