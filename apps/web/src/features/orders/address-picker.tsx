import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebouncedSearch } from '@/hooks/use-debounce';
import { useAddressBook } from '@/features/settings/use-settings';
import { addressFromRow, formatAddressLines, type AddressValues } from '@/features/_shared/address-fields';
import { BookUser } from 'lucide-react';

interface AddressPickerProps {
  onPick: (address: AddressValues, label: string) => void;
}

/** "From address book" button that opens a searchable list of saved addresses. */
export function AddressPicker({ onPick }: AddressPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const debounced = useDebouncedSearch(q);
  const entries = useAddressBook(debounced);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BookUser className="h-4 w-4" /> From address book
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Address book</DialogTitle>
          </DialogHeader>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by label, name, town or postcode" autoFocus aria-label="Search address book" />
          <div className="max-h-80 overflow-y-auto">
            {entries.isLoading ? (
              <p className="py-4 text-sm text-[var(--color-muted-foreground)]">Loading…</p>
            ) : entries.data && entries.data.length > 0 ? (
              <ul className="divide-y divide-[var(--color-border)]">
                {entries.data.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="w-full px-2 py-2 text-left text-sm hover:bg-[var(--color-muted)]"
                      onClick={() => {
                        onPick(addressFromRow(entry), entry.label);
                        setOpen(false);
                      }}
                    >
                      <div className="font-medium">{entry.label}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)]">{formatAddressLines(entry).slice(0, 4).join(', ')}</div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-sm text-[var(--color-muted-foreground)]">No saved addresses{q ? ' match' : ' yet'}.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
