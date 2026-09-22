import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QueryState, Section } from '@/components/states';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError } from '@/components/auth-card';
import { useToast } from '@/hooks/use-toast';
import { useDebouncedSearch } from '@/hooks/use-debounce';
import { AddressFields, addressFromRow, addressToBody, EMPTY_ADDRESS, formatAddressLines, type AddressValues } from '@/features/_shared/address-fields';
import { useAddressBook, useDeleteAddress, useSaveAddress } from './use-settings';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { AddressBookEntry } from '@/lib/types';

export function AddressBookTab() {
  const [q, setQ] = React.useState('');
  const debounced = useDebouncedSearch(q);
  const entries = useAddressBook(debounced);
  const remove = useDeleteAddress();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<AddressBookEntry | 'new' | null>(null);
  const [deleting, setDeleting] = React.useState<AddressBookEntry | null>(null);

  return (
    <Section
      title="Address book"
      actions={
        <>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search addresses" className="h-9 w-48" />
          <Button size="sm" onClick={() => setEditing('new')}>
            Add address
          </Button>
        </>
      }
    >
      <QueryState isLoading={entries.isLoading} error={entries.error} data={entries.data} what="The address book" onRetry={() => entries.refetch()}>
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">{q ? 'No addresses match.' : 'No saved addresses yet.'}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {items.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <div>
                    <div className="font-medium">{e.label}</div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">{formatAddressLines(e).join(', ')}</div>
                    {e.lastUsedAt && <div className="text-xs text-[var(--color-muted-foreground)]">Last used {formatDate(e.lastUsedAt)}</div>}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(e)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(e)}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
      <AddressDialog entry={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete "${deleting?.label}"?`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await remove.mutateAsync(deleting!.id);
            toast({ title: 'Address deleted' });
          } catch (err) {
            toast({ title: 'Could not delete', description: errorMessage(err), variant: 'destructive' });
          }
        }}
      />
    </Section>
  );
}

function AddressDialog({ entry, open, onClose }: { entry: AddressBookEntry | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const save = useSaveAddress();
  const [label, setLabel] = React.useState('');
  const [address, setAddress] = React.useState<AddressValues>({ ...EMPTY_ADDRESS });
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setLabel(entry?.label ?? '');
    setAddress(entry ? addressFromRow(entry) : { ...EMPTY_ADDRESS });
    setError(null);
  }, [open, entry]);

  const submit = async () => {
    setError(null);
    const finalLabel = label.trim() || address.contactName.trim();
    if (!finalLabel) return setError('Give the address a label');
    try {
      await save.mutateAsync({ id: entry?.id, input: { label: finalLabel, ...addressToBody(address) } });
      toast({ title: entry ? 'Address updated' : 'Address saved' });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{entry ? `Edit ${entry.label}` : 'Add address'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ab-label">Label</Label>
            <Input id="ab-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Head office, Mum, Amazon returns" />
          </div>
          <AddressFields value={address} onChange={setAddress} idPrefix="ab" />
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
