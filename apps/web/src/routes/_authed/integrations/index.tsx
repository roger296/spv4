import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { API_SCOPES } from '@spv4/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-header';
import { QueryState, Section } from '@/components/states';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError } from '@/components/auth-card';
import { useToast } from '@/hooks/use-toast';
import { useApiKeys, useCreateApiKey, useCreateWebhook, useDeleteWebhook, useRevokeApiKey, useWebhooks } from '@/features/settings/use-settings';
import { API_BASE, errorMessage, MCP_ORIGIN } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { WEBHOOK_EVENTS, type ApiKey, type ApiKeyCreated, type Webhook } from '@/lib/types';
import { Copy } from 'lucide-react';

const TABS = ['api-keys', 'mcp', 'webhooks'] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute('/_authed/integrations/')({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  component: IntegrationsPage,
});

const SCOPE_HELP: Record<string, string> = {
  'orders:write': 'Create, edit, label and cancel orders',
  'orders:read': 'Read orders and their status',
  'labels:read': 'Download label PDFs',
  'tracking:read': 'Read tracking events',
  'products:write': 'Create and update products',
  'products:read': 'Read products',
  'methods:write': 'Manage shipping methods and warehouses',
  'methods:read': 'Read shipping methods',
  'couriers:write': 'Manage courier accounts',
  'problems:write': 'Resolve problems',
};

const MCP_SCOPES = ['orders:write', 'orders:read', 'labels:read', 'tracking:read', 'products:write', 'products:read', 'methods:read', 'problems:write'];

function IntegrationsPage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="space-y-4">
      <PageHeader title="Integrations" description="Connect your shop, an AI assistant, or your own systems." />
      <Tabs value={tab ?? 'api-keys'} onValueChange={(v) => navigate({ search: { tab: v === 'api-keys' ? undefined : (v as Tab) } })}>
        <TabsList>
          <TabsTrigger value="api-keys">API keys</TabsTrigger>
          <TabsTrigger value="mcp">MCP connections</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        </TabsList>
        <TabsContent value="api-keys" className="mt-4">
          <KeysSection kind="api" />
        </TabsContent>
        <TabsContent value="mcp" className="mt-4">
          <KeysSection kind="mcp" />
        </TabsContent>
        <TabsContent value="webhooks" className="mt-4">
          <WebhooksSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const { toast } = useToast();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast({ title: 'Copied' });
        } catch {
          toast({ title: 'Could not copy', description: 'Select the text and copy it by hand.', variant: 'destructive' });
        }
      }}
    >
      <Copy className="h-4 w-4" /> {label}
    </Button>
  );
}

function KeysSection({ kind }: { kind: 'api' | 'mcp' }) {
  const keys = useApiKeys();
  const revoke = useRevokeApiKey();
  const { toast } = useToast();
  const [creating, setCreating] = React.useState(false);
  const [created, setCreated] = React.useState<ApiKeyCreated | null>(null);
  const [revoking, setRevoking] = React.useState<ApiKey | null>(null);
  const isMcp = kind === 'mcp';

  return (
    <div className="space-y-4">
      {isMcp && (
        <Section title="Connect an AI assistant">
          <div className="space-y-2 text-sm">
            <p>Claude, ChatGPT and other MCP-capable assistants can create orders, buy labels and answer "where is order 1234?" through this connection.</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Create a connection below. The key is shown once.</li>
              <li>
                In your assistant, add an MCP server with URL <code className="rounded bg-[var(--color-muted)] px-1 text-xs">{MCP_ORIGIN}</code>
              </li>
              <li>
                Authenticate with header <code className="rounded bg-[var(--color-muted)] px-1 text-xs">Authorization: Bearer &lt;key&gt;</code>
              </li>
            </ol>
            <div className="flex gap-2">
              <CopyButton value={MCP_ORIGIN} label="Copy MCP URL" />
            </div>
          </div>
        </Section>
      )}
      {!isMcp && (
        <Section title="Using the API">
          <div className="space-y-2 text-sm">
            <p>
              Base URL <code className="rounded bg-[var(--color-muted)] px-1 text-xs">{API_BASE}</code>, header <code className="rounded bg-[var(--color-muted)] px-1 text-xs">Authorization: Bearer &lt;key&gt;</code>. Interactive docs at{' '}
              <a href={`${API_BASE.replace(/\/v4$/, '')}/docs`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                /docs
              </a>
              .
            </p>
            <div className="flex gap-2">
              <CopyButton value={API_BASE} label="Copy base URL" />
            </div>
          </div>
        </Section>
      )}

      <Section
        title={isMcp ? 'MCP connections' : 'API keys'}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            {isMcp ? 'New connection' : 'New key'}
          </Button>
        }
      >
        <QueryState isLoading={keys.isLoading} error={keys.error} data={keys.data} what="API keys" onRetry={() => keys.refetch()}>
          {(items) => {
            const shown = items.filter((k) => k.kind === kind);
            return shown.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">{isMcp ? 'No assistant connected yet.' : 'No API keys yet.'}</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {shown.map((k) => (
                  <li key={k.id} className={k.revokedAt ? 'flex flex-wrap items-center justify-between gap-2 py-3 text-sm opacity-60' : 'flex flex-wrap items-center justify-between gap-2 py-3 text-sm'}>
                    <div>
                      <div className="font-medium">
                        {k.name}
                        {k.clientName && <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">{k.clientName}</span>}
                        {k.revokedAt && (
                          <Badge variant="outline" className="ml-2">
                            Revoked
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-[var(--color-muted-foreground)]">
                        <span className="font-mono">{k.prefix}…</span> · {k.scopes.join(', ')} · created {formatDateTime(k.createdAt)}
                        {k.lastUsedAt ? ` · last used ${formatDateTime(k.lastUsedAt)}` : ' · never used'}
                      </div>
                    </div>
                    {!k.revokedAt && (
                      <Button size="sm" variant="ghost" onClick={() => setRevoking(k)}>
                        Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            );
          }}
        </QueryState>
      </Section>

      <CreateKeyDialog kind={kind} open={creating} onOpenChange={setCreating} onCreated={setCreated} />

      <Dialog open={created !== null} onOpenChange={(v) => !v && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isMcp ? 'Connection created' : 'API key created'}</DialogTitle>
            <DialogDescription>Copy it now. For safety it is never shown again.</DialogDescription>
          </DialogHeader>
          {created && (
            <div className="space-y-3">
              <code className="block break-all rounded bg-[var(--color-muted)] p-3 font-mono text-sm">{created.key}</code>
              <div className="flex gap-2">
                <CopyButton value={created.key} label="Copy key" />
                {isMcp && <CopyButton value={MCP_ORIGIN} label="Copy MCP URL" />}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(v) => !v && setRevoking(null)}
        title={`Revoke "${revoking?.name}"?`}
        description="Anything using this key stops working straight away."
        confirmLabel="Revoke"
        destructive
        onConfirm={async () => {
          try {
            await revoke.mutateAsync(revoking!.id);
            toast({ title: 'Key revoked' });
          } catch (err) {
            toast({ title: 'Could not revoke', description: errorMessage(err), variant: 'destructive' });
          }
        }}
      />
    </div>
  );
}

function CreateKeyDialog({ kind, open, onOpenChange, onCreated }: { kind: 'api' | 'mcp'; open: boolean; onOpenChange: (v: boolean) => void; onCreated: (k: ApiKeyCreated) => void }) {
  const create = useCreateApiKey();
  const isMcp = kind === 'mcp';
  const [name, setName] = React.useState('');
  const [clientName, setClientName] = React.useState('');
  const [scopes, setScopes] = React.useState<Set<string>>(new Set(isMcp ? MCP_SCOPES : ['orders:write', 'orders:read', 'labels:read', 'tracking:read']));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName('');
      setClientName('');
      setScopes(new Set(isMcp ? MCP_SCOPES : ['orders:write', 'orders:read', 'labels:read', 'tracking:read']));
      setError(null);
    }
  }, [open, isMcp]);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError('Give it a name');
    if (scopes.size === 0) return setError('Tick at least one scope');
    try {
      const k = await create.mutateAsync({ name: name.trim(), scopes: [...scopes], kind, clientName: clientName.trim() || undefined });
      onOpenChange(false);
      onCreated(k);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isMcp ? 'New MCP connection' : 'New API key'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="key-name">Name</Label>
            <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={isMcp ? 'e.g. Claude on my laptop' : 'e.g. Shop integration'} autoFocus />
          </div>
          {isMcp && (
            <div className="space-y-1">
              <Label htmlFor="key-client">Assistant (optional)</Label>
              <Input id="key-client" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Claude, ChatGPT, Cursor…" />
            </div>
          )}
          <div className="space-y-1">
            <Label>Scopes</Label>
            <ul className="grid gap-1 sm:grid-cols-2">
              {API_SCOPES.map((s) => (
                <li key={s}>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox className="mt-0.5" checked={scopes.has(s)} onCheckedChange={(v) => setScopes((c) => { const n = new Set(c); if (v === true) n.add(s); else n.delete(s); return n; })} />
                    <span>
                      <span className="font-mono text-xs">{s}</span>
                      <span className="block text-xs text-[var(--color-muted-foreground)]">{SCOPE_HELP[s]}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WebhooksSection() {
  const webhooks = useWebhooks();
  const create = useCreateWebhook();
  const remove = useDeleteWebhook();
  const { toast } = useToast();
  const [creating, setCreating] = React.useState(false);
  const [url, setUrl] = React.useState('');
  const [events, setEvents] = React.useState<Set<string>>(new Set(WEBHOOK_EVENTS));
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<Webhook | null>(null);
  const [deleting, setDeleting] = React.useState<Webhook | null>(null);

  const submit = async () => {
    setError(null);
    if (!/^https?:\/\/\S+$/.test(url.trim())) return setError('Enter a full https:// URL');
    if (events.size === 0) return setError('Tick at least one event');
    try {
      const w = await create.mutateAsync({ url: url.trim(), events: [...events] });
      setCreating(false);
      setUrl('');
      setCreated(w);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <Section
        title="Webhooks"
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            Add webhook
          </Button>
        }
      >
        <p className="mb-3 text-sm text-[var(--color-muted-foreground)]">
          We POST a JSON body to your URL when an order changes. Each request carries an <code className="text-xs">X-Signature</code> header: an HMAC-SHA256 of the body with the webhook's secret.
        </p>
        <QueryState isLoading={webhooks.isLoading} error={webhooks.error} data={webhooks.data} what="Webhooks" onRetry={() => webhooks.refetch()}>
          {(items) =>
            items.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">No webhooks yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {items.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs">{w.url}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)]">
                        {w.events.join(', ')} · secret {w.secretPreview ?? '••••'}
                        {!w.active && ' · inactive'}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(w)}>
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryState>
      </Section>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add webhook</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="wh-url">URL</Label>
              <Input id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/smooth-parcel" autoFocus />
            </div>
            <div className="space-y-1">
              <Label>Events</Label>
              <ul className="grid gap-1 sm:grid-cols-2">
                {WEBHOOK_EVENTS.map((e) => (
                  <li key={e}>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={events.has(e)} onCheckedChange={(v) => setEvents((c) => { const n = new Set(c); if (v === true) n.add(e); else n.delete(e); return n; })} />
                      <span className="font-mono text-xs">{e}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <FormError message={error} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add webhook'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={created !== null} onOpenChange={(v) => !v && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook added</DialogTitle>
            <DialogDescription>Use this secret to verify signatures. It is shown once.</DialogDescription>
          </DialogHeader>
          {created?.secret && (
            <div className="space-y-3">
              <code className="block break-all rounded bg-[var(--color-muted)] p-3 font-mono text-sm">{created.secret}</code>
              <CopyButton value={created.secret} label="Copy secret" />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete this webhook?"
        description={deleting?.url}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await remove.mutateAsync(deleting!.id);
            toast({ title: 'Webhook deleted' });
          } catch (err) {
            toast({ title: 'Could not delete', description: errorMessage(err), variant: 'destructive' });
          }
        }}
      />
    </div>
  );
}
