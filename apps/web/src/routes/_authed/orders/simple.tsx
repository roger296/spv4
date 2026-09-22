import * as React from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/page-header';
import { Section } from '@/components/states';
import { FormError } from '@/components/auth-card';
import { NeedsInformation, NoMethodFits } from '@/components/needs-information';
import { useToast } from '@/hooks/use-toast';
import { AddressFields, addressToBody, EMPTY_ADDRESS, type AddressValues } from '@/features/_shared/address-fields';
import { AddressPicker } from '@/features/orders/address-picker';
import { useCreateOrder } from '@/features/orders/use-orders';
import { useSaveAddress } from '@/features/settings/use-settings';
import { errorMessage, NeedsInformationError, NoMethodError } from '@/lib/api';
import { num } from '@/lib/format';

export const Route = createFileRoute('/_authed/orders/simple')({
  component: SimpleParcelPage,
});

function nextReference(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `SP-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function SimpleParcelPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reference, setReference] = React.useState(nextReference);
  const [address, setAddress] = React.useState<AddressValues>({ ...EMPTY_ADDRESS });
  const [parcel, setParcel] = React.useState({ weight: '', length: '', width: '', height: '' });
  const [description, setDescription] = React.useState('');
  const [saveToBook, setSaveToBook] = React.useState(false);
  const [bookLabel, setBookLabel] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [needs, setNeeds] = React.useState<NeedsInformationError | NoMethodError | null>(null);
  const create = useCreateOrder();
  const saveAddress = useSaveAddress();

  const submit = async (label: boolean) => {
    setError(null);
    setNeeds(null);
    if (!reference.trim()) return setError('A reference is required');
    if (!address.contactName.trim() || !address.line1.trim() || !address.city.trim()) return setError('Contact name, address line 1 and town are required');
    const weight = num(parcel.weight);
    const length = num(parcel.length);
    const width = num(parcel.width);
    const height = num(parcel.height);
    if (!weight || weight <= 0) return setError('Enter the parcel weight in kg');
    if (!length || !width || !height) return setError('Enter the parcel length, width and height in cm');

    try {
      if (saveToBook) {
        await saveAddress.mutateAsync({ input: { label: bookLabel.trim() || address.contactName.trim(), ...addressToBody(address) } });
      }
      const order = await create.mutateAsync({
        reference: reference.trim(),
        deliveryAddress: addressToBody(address),
        parcels: [{ weight, length, width, height }],
        lines: description.trim() ? [{ sku: 'PARCEL', name: description.trim(), quantity: 1, weight }] : undefined,
        label,
      });
      toast({ title: order.status === 'LABEL_GENERATED' ? 'Label bought' : 'Parcel saved', description: order.orderNumber });
      navigate({ to: '/orders/$reference', params: { reference: order.orderNumber } });
    } catch (err) {
      if (err instanceof NeedsInformationError || err instanceof NoMethodError) {
        setNeeds(err);
        return;
      }
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Simple parcel"
        description="One parcel to one address, no product lines."
        actions={
          <Button asChild variant="ghost">
            <Link to="/orders">Back to orders</Link>
          </Button>
        }
      />
      {needs instanceof NeedsInformationError && (
        <NeedsInformation reference={needs.body.reference} missing={needs.body.missing} onEdit={() => navigate({ to: '/orders/$reference', params: { reference: needs.body.reference } })} />
      )}
      {needs instanceof NoMethodError && <NoMethodFits reference={needs.body.reference} dropped={needs.body.dropped} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Recipient" actions={<AddressPicker onPick={(a) => setAddress(a)} />}>
            <AddressFields value={address} onChange={setAddress} idPrefix="simple" />
            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={saveToBook} onCheckedChange={(c) => setSaveToBook(c === true)} />
                Save this address to the address book
              </label>
              {saveToBook && (
                <div className="space-y-1">
                  <Label htmlFor="bookLabel">Label</Label>
                  <Input id="bookLabel" value={bookLabel} onChange={(e) => setBookLabel(e.target.value)} placeholder={address.contactName || 'e.g. Mum'} />
                </div>
              )}
            </div>
          </Section>
        </div>
        <div className="space-y-4">
          <Section title="Parcel">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="reference">Reference</Label>
                <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="weight">Weight (kg)</Label>
                <Input id="weight" type="number" min={0} step="0.001" value={parcel.weight} onChange={(e) => setParcel({ ...parcel, weight: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="length">Length cm</Label>
                  <Input id="length" type="number" min={0} step="0.1" value={parcel.length} onChange={(e) => setParcel({ ...parcel, length: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="width">Width cm</Label>
                  <Input id="width" type="number" min={0} step="0.1" value={parcel.width} onChange={(e) => setParcel({ ...parcel, width: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="height">Height cm</Label>
                  <Input id="height" type="number" min={0} step="0.1" value={parcel.height} onChange={(e) => setParcel({ ...parcel, height: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="description">Contents (optional)</Label>
                <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Birthday present" />
              </div>
            </div>
          </Section>
          <FormError message={error} />
          <div className="flex flex-col gap-2">
            <Button onClick={() => submit(true)} disabled={create.isPending || saveAddress.isPending}>
              {create.isPending ? 'Saving…' : 'Save and buy label'}
            </Button>
            <Button variant="outline" onClick={() => submit(false)} disabled={create.isPending || saveAddress.isPending}>
              Save only
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
