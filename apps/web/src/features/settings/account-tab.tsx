import * as React from 'react';
import { STATIONERY, type Stationery } from '@spv4/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { QueryState, Section } from '@/components/states';
import { FormError } from '@/components/auth-card';
import { useToast } from '@/hooks/use-toast';
import { useAccount, useUpdateAccount } from '@/features/settings/use-settings';
import { errorMessage } from '@/lib/api';
import { num } from '@/lib/format';
import { hasRole } from '@/lib/auth';
import type { Account } from '@/lib/types';

export const STATIONERY_LABELS: Record<Stationery, { title: string; help: string }> = {
  LABEL_6X4: { title: '6 × 4 inch label', help: 'Thermal label printer, one label per sheet.' },
  LABEL_4X4: { title: '4 × 4 inch label', help: 'Square thermal labels.' },
  A4_LEFT: { title: 'A4, label top left', help: 'Integrated label sheet; the packing note prints on the rest.' },
  A4_RIGHT: { title: 'A4, label top right', help: 'Integrated label sheet; the packing note prints on the rest.' },
};

export function StationeryRadio({ value, onChange, name = 'stationery', allowInherit }: { value: Stationery | ''; onChange: (v: Stationery | '') => void; name?: string; allowInherit?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {allowInherit && (
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--color-border)] p-3 text-sm">
          <input type="radio" name={name} checked={value === ''} onChange={() => onChange('')} className="mt-0.5" />
          <span>
            <span className="font-medium">Use the account setting</span>
          </span>
        </label>
      )}
      {STATIONERY.map((s) => (
        <label key={s} className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--color-border)] p-3 text-sm">
          <input type="radio" name={name} checked={value === s} onChange={() => onChange(s)} className="mt-0.5" />
          <span>
            <span className="font-medium">{STATIONERY_LABELS[s].title}</span>
            <span className="block text-xs text-[var(--color-muted-foreground)]">{STATIONERY_LABELS[s].help}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function AccountTab() {
  const account = useAccount();
  return (
    <QueryState isLoading={account.isLoading} error={account.error} data={account.data} what="Account settings" onRetry={() => account.refetch()}>
      {(a) => <AccountForm account={a} />}
    </QueryState>
  );
}

function AccountForm({ account }: { account: Account }) {
  const { toast } = useToast();
  const update = useUpdateAccount();
  const canEdit = hasRole('MANAGER');
  const s = account.settings ?? {};
  const [name, setName] = React.useState(account.name);
  const [stationery, setStationery] = React.useState<Stationery | ''>(account.stationery);
  const [allowance, setAllowance] = React.useState(String(s.packagingAllowanceKg ?? ''));
  const [box, setBox] = React.useState({ length: String(s.defaultBox?.length ?? ''), width: String(s.defaultBox?.width ?? ''), height: String(s.defaultBox?.height ?? '') });
  const [aiApproval, setAiApproval] = React.useState(s.aiApprovalRequired ?? true);
  const [trust, setTrust] = React.useState(String(s.trustAiAboveConfidence != null ? Math.round(s.trustAiAboveConfidence * 100) : ''));
  const [emails, setEmails] = React.useState((s.notificationEmails ?? []).join('\n'));
  const [dailyEmail, setDailyEmail] = React.useState(s.dailyProblemEmail ?? true);
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError('The account needs a name');
    const emailList = emails.split(/[\n,;]+/).map((e) => e.trim()).filter(Boolean);
    const bad = emailList.find((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (bad) return setError(`"${bad}" is not an email address`);
    const trustN = num(trust);
    const l = num(box.length);
    const w = num(box.width);
    const h = num(box.height);
    const defaultBox = l && w && h ? { length: l, width: w, height: h } : undefined;
    try {
      await update.mutateAsync({
        name: name.trim(),
        stationery: stationery || undefined,
        settings: {
          packagingAllowanceKg: num(allowance) ?? undefined,
          defaultBox,
          aiApprovalRequired: aiApproval,
          trustAiAboveConfidence: trustN === null ? undefined : Math.min(1, Math.max(0, trustN / 100)),
          notificationEmails: emailList,
          dailyProblemEmail: dailyEmail,
        },
      });
      toast({ title: 'Settings saved' });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Business">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="acc-name">Account name</Label>
            <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="text-xs text-[var(--color-muted-foreground)]">
            Currency {account.currency} · Status {account.status.toLowerCase()}
          </div>
        </div>
      </Section>

      <Section title="Packaging">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="acc-allow">Packaging allowance (kg added per parcel)</Label>
            <Input id="acc-allow" type="number" min={0} max={5} step="0.01" value={allowance} onChange={(e) => setAllowance(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1">
            <Label>Default box (cm) when no parcel sizes are known</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input type="number" min={0} step="0.1" value={box.length} onChange={(e) => setBox({ ...box, length: e.target.value })} placeholder="Length" aria-label="Default box length" disabled={!canEdit} />
              <Input type="number" min={0} step="0.1" value={box.width} onChange={(e) => setBox({ ...box, width: e.target.value })} placeholder="Width" aria-label="Default box width" disabled={!canEdit} />
              <Input type="number" min={0} step="0.1" value={box.height} onChange={(e) => setBox({ ...box, height: e.target.value })} placeholder="Height" aria-label="Default box height" disabled={!canEdit} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Stationery" className="lg:col-span-2">
        <StationeryRadio value={stationery} onChange={setStationery} />
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">A warehouse can override this.</p>
      </Section>

      <Section title="AI product data">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={aiApproval} onCheckedChange={(v) => setAiApproval(v === true)} disabled={!canEdit} />
            Ask me before using AI-found weights and dimensions
          </label>
          <div className="space-y-1">
            <Label htmlFor="acc-trust">Trust suggestions automatically above this confidence (%)</Label>
            <Input id="acc-trust" type="number" min={0} max={100} step={1} value={trust} onChange={(e) => setTrust(e.target.value)} disabled={!canEdit} placeholder="e.g. 90" />
          </div>
        </div>
      </Section>

      <Section title="Notifications">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="acc-emails">Notification emails (one per line)</Label>
            <Textarea id="acc-emails" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} disabled={!canEdit} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={dailyEmail} onCheckedChange={(v) => setDailyEmail(v === true)} disabled={!canEdit} />
            Send a daily email listing open problems
          </label>
        </div>
      </Section>

      <div className="lg:col-span-2">
        <FormError message={error} />
        {canEdit ? (
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save settings'}
          </Button>
        ) : (
          <p className="text-sm text-[var(--color-muted-foreground)]">Only managers and owners can change these settings.</p>
        )}
      </div>
    </div>
  );
}

export function TrackingBrandingTab() {
  const account = useAccount();
  return (
    <QueryState isLoading={account.isLoading} error={account.error} data={account.data} what="Tracking page settings" onRetry={() => account.refetch()}>
      {(a) => <TrackingBrandingForm account={a} />}
    </QueryState>
  );
}

function TrackingBrandingForm({ account }: { account: Account }) {
  const { toast } = useToast();
  const update = useUpdateAccount();
  const canEdit = hasRole('MANAGER');
  const b = account.settings?.trackingBranding ?? {};
  const [logoUrl, setLogoUrl] = React.useState(b.logoUrl ?? '');
  const [colour, setColour] = React.useState(b.colour ?? '#15161A');
  const [supportEmail, setSupportEmail] = React.useState(b.supportEmail ?? '');
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (logoUrl && !/^https?:\/\//.test(logoUrl)) return setError('The logo must be an https:// link');
    try {
      await update.mutateAsync({ settings: { trackingBranding: { logoUrl: logoUrl.trim() || undefined, colour: colour || undefined, supportEmail: supportEmail.trim() || undefined } } });
      toast({ title: 'Tracking page saved' });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Tracking page branding">
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-muted-foreground)]">Customers see this page from the tracking link in their emails.</p>
          <div className="space-y-1">
            <Label htmlFor="tb-logo">Logo URL</Label>
            <Input id="tb-logo" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" disabled={!canEdit} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tb-colour">Accent colour</Label>
            <div className="flex items-center gap-2">
              <input id="tb-colour" type="color" value={colour} onChange={(e) => setColour(e.target.value)} disabled={!canEdit} className="h-10 w-14 cursor-pointer rounded border border-[var(--color-border)]" />
              <Input value={colour} onChange={(e) => setColour(e.target.value)} className="w-32 font-mono" aria-label="Accent colour hex" disabled={!canEdit} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tb-email">Support email shown to customers</Label>
            <Input id="tb-email" type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} disabled={!canEdit} />
          </div>
          <FormError message={error} />
          {canEdit && (
            <Button onClick={save} disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      </Section>
      <Section title="Preview">
        <div className="rounded-md border border-[var(--color-border)] p-4" style={{ borderTopColor: colour, borderTopWidth: 4 }}>
          {logoUrl ? <img src={logoUrl} alt="" className="mb-3 max-h-12" /> : <div className="mb-3 text-lg font-semibold">{account.name}</div>}
          <div className="text-sm font-medium">Your parcel is on its way</div>
          <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">Tracking events appear here.</div>
          <div className="mt-3 text-xs" style={{ color: colour }}>
            {supportEmail || 'support@example.com'}
          </div>
        </div>
      </Section>
    </div>
  );
}
