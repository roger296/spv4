import * as React from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/page-header';
import { OkBadge } from '@/components/status-badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { QueryState, Section } from '@/components/states';
import { FormError } from '@/components/auth-card';
import { useToast } from '@/hooks/use-toast';
import { useCourierAccounts, useCourierProfiles, useCreateCourierAccount, useDeleteCourierAccount, useTestCourierAccount, useUpdateCourierAccount } from '@/features/couriers/use-couriers';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { CourierAccount, CourierProfile } from '@/lib/types';
import { Plus } from 'lucide-react';

export const Route = createFileRoute('/_authed/couriers/')({
  component: CouriersPage,
});

const ORIGIN_LABELS: Record<CourierProfile['origin'], string> = { builtin: 'Built in', shared: 'Shared', own: 'Yours' };

function CouriersPage() {
  const accounts = useCourierAccounts();
  const profiles = useCourierProfiles();
  const [adding, setAdding] = React.useState<CourierProfile | null>(null);
  const [editing, setEditing] = React.useState<CourierAccount | null>(null);
  const [deleting, setDeleting] = React.useState<CourierAccount | null>(null);
  const test = useTestCourierAccount();
  const remove = useDeleteCourierAccount();
  const { toast } = useToast();

  const runTest = async (a: CourierAccount) => {
    try {
      const r = await test.mutateAsync(a.id);
      toast({ title: r.ok ? `${a.name}: connection OK` : `${a.name}: test failed`, description: r.message, variant: r.ok ? 'default' : 'destructive' });
    } catch (err) {
      toast({ title: 'Test failed', description: errorMessage(err), variant: 'destructive' });
    }
  };

  const profileById = new Map((profiles.data ?? []).map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Couriers"
        description="Your courier accounts, and the catalogue of couriers Smooth Parcel knows how to talk to."
        actions={
          <Button asChild>
            <Link to="/couriers/new" search={{ profileId: undefined }}>
              <Plus className="h-4 w-4" /> Add courier
            </Link>
          </Button>
        }
      />

      <Section title="Your courier accounts">
        <QueryState isLoading={accounts.isLoading} error={accounts.error} data={accounts.data} what="Courier accounts" onRetry={() => accounts.refetch()}>
          {(items) =>
            items.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">No courier accounts yet. Pick a courier from the catalogue below and enter your credentials.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-[var(--color-muted-foreground)]">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Name</th>
                      <th className="py-1 pr-3 font-medium">Courier</th>
                      <th className="py-1 pr-3 font-medium">Mode</th>
                      <th className="py-1 pr-3 font-medium">Last test</th>
                      <th className="py-1 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => (
                      <tr key={a.id} className="border-t border-[var(--color-border)]">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{a.name}</span>
                          {!a.active && (
                            <Badge variant="outline" className="ml-2">
                              Inactive
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3">{a.profile?.name ?? profileById.get(a.profileId)?.name ?? '—'}</td>
                        <td className="py-2 pr-3">{a.sandbox ? <Badge variant="outline">Sandbox</Badge> : <Badge variant="secondary">Live</Badge>}</td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <OkBadge ok={a.lastTestOk} yes="Connected" />
                            <span className="text-xs text-[var(--color-muted-foreground)]">{a.lastTestAt ? formatDateTime(a.lastTestAt) : ''}</span>
                          </div>
                          {a.lastTestMessage && !a.lastTestOk && <div className="mt-0.5 max-w-xs text-xs text-[var(--color-destructive)]">{a.lastTestMessage}</div>}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => runTest(a)} disabled={test.isPending}>
                              {test.isPending && test.variables === a.id ? 'Testing…' : 'Test'}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleting(a)}>
                              Remove
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </QueryState>
      </Section>

      <Section title="Catalogue">
        <QueryState isLoading={profiles.isLoading} error={profiles.error} data={profiles.data} what="The courier catalogue" onRetry={() => profiles.refetch()}>
          {(items) => (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => (
                <div key={p.id} className="flex flex-col rounded-md border border-[var(--color-border)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)]">
                        {p.services.length} service{p.services.length === 1 ? '' : 's'}
                        {p.adoptions ? ` · used by ${p.adoptions}` : ''}
                        {p.version ? ` · v${p.version}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline">{ORIGIN_LABELS[p.origin] ?? p.origin}</Badge>
                      {p.aiSuggested && (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                          AI drafted
                        </Badge>
                      )}
                      {p.review && p.review !== 'approved' && (
                        <Badge variant="outline" className="capitalize">
                          {p.review.replace(/_/g, ' ')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {p.services.slice(0, 6).map((s) => (
                      <li key={s.code} className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 text-xs">
                        {s.name}
                      </li>
                    ))}
                    {p.services.length > 6 && <li className="text-xs text-[var(--color-muted-foreground)]">+{p.services.length - 6} more</li>}
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => setAdding(p)}>
                      Add
                    </Button>
                    {p.origin === 'own' && (
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/couriers/new" search={{ profileId: p.id }}>
                          Edit profile
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </QueryState>
      </Section>

      <CourierAccountDialog profile={adding} account={null} onClose={() => setAdding(null)} />
      <CourierAccountDialog profile={editing ? (profileById.get(editing.profileId) ?? null) : null} account={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Remove ${deleting?.name}?`}
        description="Shipping methods on this account stop being offered. Labels already bought are unaffected."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          await remove.mutateAsync(deleting!.id);
          toast({ title: 'Courier account removed' });
        }}
      />
    </div>
  );
}

/** Credential form built from the profile's credentialSchema. Secrets are write-only. */
function CourierAccountDialog({ profile, account, onClose }: { profile: CourierProfile | null; account: CourierAccount | null; onClose: () => void }) {
  const { toast } = useToast();
  const create = useCreateCourierAccount();
  const update = useUpdateCourierAccount();
  const test = useTestCourierAccount();
  const open = profile !== null || account !== null;
  const [name, setName] = React.useState('');
  const [sandbox, setSandbox] = React.useState(true);
  const [active, setActive] = React.useState(true);
  const [creds, setCreds] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(account?.name ?? profile?.name ?? '');
    setSandbox(account?.sandbox ?? true);
    setActive(account?.active ?? true);
    setCreds({});
    setError(null);
  }, [open, account, profile]);

  const schema = profile?.credentialSchema ?? [];

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError('Give the account a name');
    const credentials: Record<string, string> = {};
    for (const f of schema) {
      const v = (creds[f.key] ?? '').trim();
      if (v) credentials[f.key] = v;
      else if (f.required && !account) return setError(`${f.label} is required`);
    }
    try {
      let saved: CourierAccount;
      if (account) {
        saved = await update.mutateAsync({ id: account.id, input: { name: name.trim(), sandbox, active, ...(Object.keys(credentials).length ? { credentials } : {}) } });
      } else {
        saved = await create.mutateAsync({ profileId: profile!.id, name: name.trim(), credentials, sandbox });
      }
      toast({ title: account ? 'Courier account updated' : 'Courier account added' });
      const r = await test.mutateAsync(saved.id).catch(() => null);
      if (r) toast({ title: r.ok ? 'Connection OK' : 'Connection test failed', description: r.message, variant: r.ok ? 'default' : 'destructive' });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? `Edit ${account.name}` : `Add ${profile?.name ?? 'courier'}`}</DialogTitle>
          <DialogDescription>
            {account ? 'Leave a credential blank to keep the stored value.' : 'Credentials are encrypted and never shown again. A connection test runs after saving.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ca-name">Account name</Label>
            <Input id="ca-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Royal Mail (main account)" />
          </div>
          {schema.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`ca-${f.key}`}>
                {f.label}
                {f.required && !account ? '' : ' (optional)'}
              </Label>
              <Input
                id={`ca-${f.key}`}
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                value={creds[f.key] ?? ''}
                onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                placeholder={account && f.secret ? '••••••••' : undefined}
              />
              {f.help && <p className="text-xs text-[var(--color-muted-foreground)]">{f.help}</p>}
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={sandbox} onCheckedChange={(c) => setSandbox(c === true)} />
            Sandbox (test) mode — no real labels are bought
          </label>
          {account && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={active} onCheckedChange={(c) => setActive(c === true)} />
              Active
            </label>
          )}
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending || update.isPending || test.isPending}>
            {create.isPending || update.isPending ? 'Saving…' : test.isPending ? 'Testing…' : 'Save and test'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
