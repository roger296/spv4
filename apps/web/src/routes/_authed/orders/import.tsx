import * as React from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { Section } from '@/components/states';
import { FormError } from '@/components/auth-card';
import { useToast } from '@/hooks/use-toast';
import { useImportOrders } from '@/features/orders/use-orders';
import { errorMessage, fetchText, isNotAvailable } from '@/lib/api';
import { statusLabel } from '@/lib/order-status';
import { missingFieldLabel } from '@/components/needs-information';
import type { OrderImportRow } from '@/lib/types';

export const Route = createFileRoute('/_authed/orders/import')({
  component: ImportOrdersPage,
});

function ImportOrdersPage() {
  const { toast } = useToast();
  const [csv, setCsv] = React.useState('');
  const [label, setLabel] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<OrderImportRow[] | null>(null);
  const importOrders = useImportOrders();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const downloadTemplate = async () => {
    try {
      const text = await fetchText('/orders/import/template');
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'smooth-parcel-orders-template.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      toast({ title: isNotAvailable(err) ? 'Template not available yet' : 'Could not fetch the template', description: isNotAvailable(err) ? undefined : errorMessage(err), variant: 'destructive' });
    }
  };

  const submit = async () => {
    setError(null);
    setResults(null);
    if (!csv.trim()) return setError('Paste CSV text or choose a file first');
    try {
      const reply = await importOrders.mutateAsync({ csv, label });
      setResults(reply.results);
      const failed = reply.results.filter((r) => r.error).length;
      toast({ title: 'Import finished', description: `${reply.results.length - failed} imported${failed ? `, ${failed} failed` : ''}`, variant: failed ? 'destructive' : 'default' });
    } catch (err) {
      setError(isNotAvailable(err) ? 'CSV import is not available on this API build yet.' : errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Upload CSV"
        description="One order per row. The template shows every column; only reference and the delivery address are required."
        actions={
          <>
            <Button variant="outline" onClick={downloadTemplate}>
              Download template
            </Button>
            <Button asChild variant="ghost">
              <Link to="/orders">Back to orders</Link>
            </Button>
          </>
        }
      />
      <Section title="CSV">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              Choose file
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={label} onCheckedChange={(c) => setLabel(c === true)} />
              Buy labels as they import
            </label>
          </div>
          <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={12} placeholder="reference,contactName,line1,city,postCode,country,..." className="font-mono text-xs" aria-label="CSV text" />
          <FormError message={error} />
          <Button onClick={submit} disabled={importOrders.isPending}>
            {importOrders.isPending ? 'Importing…' : 'Import orders'}
          </Button>
        </div>
      </Section>

      {results && (
        <Section title={`Results (${results.length} rows)`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted)] text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.row} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="px-3 py-2 tabular-nums">{r.row}</td>
                    <td className="px-3 py-2">
                      {r.reference ? (
                        <Link to="/orders/$reference" params={{ reference: r.reference }} className="font-medium hover:underline">
                          {r.reference}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <Badge variant="destructive">Failed</Badge>
                      ) : r.missing && r.missing.length > 0 ? (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                          Needs information
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-transparent bg-emerald-100 text-emerald-900">
                          {statusLabel(r.status) === '—' ? 'Imported' : statusLabel(r.status)}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-muted-foreground)]">
                      {r.error ?? (r.missing && r.missing.length > 0 ? r.missing.map((m) => `${missingFieldLabel(m.path)}: ${m.reason}`).join('; ') : '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
