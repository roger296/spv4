import * as React from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/page-header';
import { Section } from '@/components/states';
import { FormError } from '@/components/auth-card';
import { useToast } from '@/hooks/use-toast';
import { useCourierAccounts, useCourierProfile, useCreateProfile, useDraftProfile, useSubmitProfile, useTestProfile, useUpdateProfile, type ProfileTestOperation } from '@/features/couriers/use-couriers';
import { errorMessage, isNotAvailable } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { CourierService, CourierTestReply, CredentialField } from '@/lib/types';
import { Trash2 } from 'lucide-react';

export const Route = createFileRoute('/_authed/couriers/new')({
  validateSearch: (search: Record<string, unknown>) => ({
    profileId: typeof search.profileId === 'string' && search.profileId ? search.profileId : undefined,
  }),
  component: CourierWizardPage,
});

const STEPS = ['Identity', 'Authentication', 'Operations', 'Services', 'Test', 'Save'] as const;
type Step = (typeof STEPS)[number];

/**
 * The profile definition the API stores. Templates are kept as JSON text in
 * the wizard so any shape the profile engine grows can be expressed without
 * a UI change; the JSON is parsed once when saving.
 */
interface Definition {
  baseUrl: string;
  sandboxBaseUrl: string;
  auth: unknown;
  operations: Record<string, unknown>;
}

const SAMPLE_AUTH = { type: 'bearer', tokenFrom: 'credentials.apiKey' };
const SAMPLE_OPERATION = {
  method: 'POST',
  path: '/shipments',
  request: { reference: '{{order.reference}}', to: '{{order.deliveryAddress}}', parcels: '{{order.parcels}}', service: '{{method.serviceCode}}' },
  response: { trackingNumber: '$.tracking_number', labelUrl: '$.label.url', courierReference: '$.id' },
};
const OPERATION_KEYS = ['create_shipment', 'get_label', 'track', 'void_shipment'] as const;

const EMPTY_SERVICE: CourierService = { code: '', name: '', tracked: true, signature: false, express: false, maxTransitDays: 3, domestic: true, international: false };
const EMPTY_CRED: CredentialField = { key: '', label: '', secret: true, required: true, help: '' };

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

function CourierWizardPage() {
  const { profileId } = Route.useSearch();
  const navigate = useNavigate();
  const { toast } = useToast();
  const existing = useCourierProfile(profileId);
  const accounts = useCourierAccounts();
  const draft = useDraftProfile();
  const create = useCreateProfile();
  const update = useUpdateProfile();
  const submitProfile = useSubmitProfile();
  const testProfile = useTestProfile();

  const [step, setStep] = React.useState<Step>('Identity');
  const [name, setName] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [sandboxBaseUrl, setSandboxBaseUrl] = React.useState('');
  const [docs, setDocs] = React.useState('');
  const [authJson, setAuthJson] = React.useState(pretty(SAMPLE_AUTH));
  const [creds, setCreds] = React.useState<CredentialField[]>([{ key: 'apiKey', label: 'API key', secret: true, required: true, help: '' }]);
  const [ops, setOps] = React.useState<Record<string, string>>({ create_shipment: pretty(SAMPLE_OPERATION), get_label: '', track: '', void_shipment: '' });
  const [services, setServices] = React.useState<CourierService[]>([{ ...EMPTY_SERVICE }]);
  const [savedId, setSavedId] = React.useState<string | undefined>(profileId);
  const [testAccount, setTestAccount] = React.useState('');
  const [testOp, setTestOp] = React.useState<ProfileTestOperation>('auth');
  const [testRef, setTestRef] = React.useState('');
  const [testResult, setTestResult] = React.useState<CourierTestReply | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Load an existing own profile into the form.
  React.useEffect(() => {
    const p = existing.data;
    if (!p) return;
    const def = (p.definition ?? {}) as Partial<Definition>;
    setName(p.name);
    setBaseUrl(def.baseUrl ?? '');
    setSandboxBaseUrl(def.sandboxBaseUrl ?? '');
    setAuthJson(def.auth ? pretty(def.auth) : pretty(SAMPLE_AUTH));
    setCreds(p.credentialSchema?.length ? p.credentialSchema : [{ ...EMPTY_CRED }]);
    setOps(Object.fromEntries(OPERATION_KEYS.map((k) => [k, def.operations?.[k] ? pretty(def.operations[k]) : ''])));
    setServices(p.services?.length ? p.services : [{ ...EMPTY_SERVICE }]);
    setSavedId(p.id);
  }, [existing.data]);

  const applyDraft = (p: Partial<import('@/lib/types').CourierProfile>) => {
    const def = (p.definition ?? {}) as Partial<Definition>;
    if (p.name) setName(p.name);
    if (def.baseUrl) setBaseUrl(def.baseUrl);
    if (def.sandboxBaseUrl) setSandboxBaseUrl(def.sandboxBaseUrl);
    if (def.auth) setAuthJson(pretty(def.auth));
    if (p.credentialSchema?.length) setCreds(p.credentialSchema);
    if (def.operations) setOps((o) => ({ ...o, ...Object.fromEntries(Object.entries(def.operations!).map(([k, v]) => [k, pretty(v)])) }));
    if (p.services?.length) setServices(p.services);
  };

  const runDraft = async () => {
    setError(null);
    const input = /^https?:\/\/\S+$/.test(docs.trim()) ? { url: docs.trim() } : { documentation: docs };
    if (!docs.trim()) return setError('Paste the courier’s API documentation, or a link to it');
    try {
      const p = await draft.mutateAsync(input);
      applyDraft(p);
      toast({ title: 'Draft ready', description: 'Check each step; the AI’s guesses are prefilled.' });
      setStep('Authentication');
    } catch (err) {
      setError(isNotAvailable(err) ? 'AI drafting is not available on this API build yet. Fill the steps in by hand.' : errorMessage(err));
    }
  };

  const parseJson = (label: string, text: string): unknown => {
    if (!text.trim()) return undefined;
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`${label} is not valid JSON: ${(e as Error).message}`);
    }
  };

  const buildInput = () => {
    if (!name.trim()) throw new Error('The courier needs a name');
    if (!baseUrl.trim()) throw new Error('The API base URL is required');
    const auth = parseJson('Authentication', authJson);
    const operations: Record<string, unknown> = {};
    for (const k of OPERATION_KEYS) {
      const v = parseJson(`Operation ${k}`, ops[k] ?? '');
      if (v !== undefined) operations[k] = v;
    }
    if (!operations.create_shipment) throw new Error('The create_shipment operation is required');
    const credentialSchema = creds.filter((c) => c.key.trim()).map((c) => ({ ...c, key: c.key.trim(), label: c.label.trim() || c.key.trim() }));
    if (credentialSchema.length === 0) throw new Error('Add at least one credential field');
    const svc = services.filter((s) => s.code.trim()).map((s) => ({ ...s, code: s.code.trim(), name: s.name.trim() || s.code.trim() }));
    if (svc.length === 0) throw new Error('Add at least one service');
    const definition: Definition = { baseUrl: baseUrl.trim(), sandboxBaseUrl: sandboxBaseUrl.trim(), auth, operations };
    return { name: name.trim(), definition, credentialSchema, services: svc };
  };

  const save = async (): Promise<string | null> => {
    setError(null);
    try {
      const input = buildInput();
      const saved = savedId ? await update.mutateAsync({ id: savedId, input }) : await create.mutateAsync(input);
      setSavedId(saved.id);
      toast({ title: 'Courier profile saved' });
      return saved.id;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  };

  const runTest = async () => {
    setError(null);
    setTestResult(null);
    const id = savedId ?? (await save());
    if (!id) return;
    if (!testAccount) return setError('Choose a courier account holding credentials for this profile. Add one from the Couriers page first if needed.');
    try {
      const r = await testProfile.mutateAsync({ id, courierAccountId: testAccount, operation: testOp, sampleOrderReference: testRef.trim() || undefined });
      setTestResult(r);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const share = async () => {
    const id = savedId ?? (await save());
    if (!id) return;
    try {
      await submitProfile.mutateAsync(id);
      toast({ title: 'Submitted to the shared catalogue', description: 'It appears for others once reviewed.' });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const stepIndex = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)]!);
  const back = () => setStep(STEPS[Math.max(stepIndex - 1, 0)]!);

  return (
    <div className="space-y-4">
      <PageHeader
        title={savedId ? 'Edit courier profile' : 'Add courier'}
        description="Describe how to talk to a courier’s API. Built-in couriers need none of this — just add your credentials on the Couriers page."
        actions={
          <Button asChild variant="ghost">
            <Link to="/couriers">Back to couriers</Link>
          </Button>
        }
      />

      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(s)}
              aria-current={s === step ? 'step' : undefined}
              className={cn('rounded-full border px-3 py-1', s === step ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : i < stepIndex ? 'border-[var(--color-border)] bg-[var(--color-muted)]' : 'border-[var(--color-border)]')}
            >
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 'Identity' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Identity">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cp-name">Courier name</Label>
                <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Parcel2Go" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cp-base">API base URL</Label>
                <Input id="cp-base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cp-sandbox">Sandbox base URL (optional)</Label>
                <Input id="cp-sandbox" value={sandboxBaseUrl} onChange={(e) => setSandboxBaseUrl(e.target.value)} placeholder="https://sandbox.example.com/v1" />
              </div>
            </div>
          </Section>
          <Section title="Start from the documentation">
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-muted-foreground)]">Paste the courier’s API documentation, or a link to it, and the AI drafts the authentication, operations and services for you to check.</p>
              <Textarea value={docs} onChange={(e) => setDocs(e.target.value)} rows={8} placeholder="https://developer.example.com/docs  — or paste the text" aria-label="API documentation or URL" />
              <Button variant="outline" onClick={runDraft} disabled={draft.isPending}>
                {draft.isPending ? 'Drafting…' : 'Draft from documentation'}
              </Button>
            </div>
          </Section>
        </div>
      )}

      {step === 'Authentication' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Credential fields">
            <p className="mb-2 text-sm text-[var(--color-muted-foreground)]">What the business enters when adding this courier. Secret fields are stored encrypted and never shown again.</p>
            <div className="space-y-2">
              {creds.map((c, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_2fr_auto_auto_36px]">
                  <Input value={c.key} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} placeholder="key" className="font-mono" aria-label={`Credential ${i + 1} key`} />
                  <Input value={c.label} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Label" aria-label={`Credential ${i + 1} label`} />
                  <Input value={c.help ?? ''} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, help: e.target.value } : x)))} placeholder="Help text" aria-label={`Credential ${i + 1} help`} />
                  <label className="flex items-center gap-1 text-xs">
                    <Checkbox checked={!!c.secret} onCheckedChange={(v) => setCreds(creds.map((x, j) => (j === i ? { ...x, secret: v === true } : x)))} /> Secret
                  </label>
                  <label className="flex items-center gap-1 text-xs">
                    <Checkbox checked={c.required !== false} onCheckedChange={(v) => setCreds(creds.map((x, j) => (j === i ? { ...x, required: v === true } : x)))} /> Required
                  </label>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove credential ${i + 1}`} onClick={() => setCreds(creds.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={() => setCreds([...creds, { ...EMPTY_CRED }])}>
                Add field
              </Button>
            </div>
          </Section>
          <Section title="Authentication (JSON)">
            <p className="mb-2 text-sm text-[var(--color-muted-foreground)]">How requests are signed. Reference credential fields as <code className="text-xs">credentials.&lt;key&gt;</code>. Types: bearer, basic, header, oauth2_client_credentials, login_token.</p>
            <Textarea value={authJson} onChange={(e) => setAuthJson(e.target.value)} rows={12} className="font-mono text-xs" aria-label="Authentication JSON" />
          </Section>
        </div>
      )}

      {step === 'Operations' && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            One template per operation. <code className="text-xs">request</code> is the body sent, with <code className="text-xs">{'{{order.…}}'}</code> and <code className="text-xs">{'{{method.…}}'}</code> placeholders; <code className="text-xs">response</code> maps JSON paths back to Smooth Parcel fields. Only create_shipment is required.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {OPERATION_KEYS.map((k) => (
              <Section key={k} title={k.replace('_', ' ')} actions={!ops[k] ? <Button size="sm" variant="ghost" onClick={() => setOps({ ...ops, [k]: pretty({ ...SAMPLE_OPERATION, path: `/${k.replace('_', '-')}` }) })}>Use sample</Button> : undefined}>
                <Textarea value={ops[k] ?? ''} onChange={(e) => setOps({ ...ops, [k]: e.target.value })} rows={12} className="font-mono text-xs" aria-label={`${k} template`} placeholder="Leave blank if the courier has no such call" />
              </Section>
            ))}
          </div>
        </div>
      )}

      {step === 'Services' && (
        <Section title="Services">
          <p className="mb-2 text-sm text-[var(--color-muted-foreground)]">The service codes the courier accepts. Shipping methods are created from these.</p>
          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_2fr_90px_repeat(5,auto)_36px] gap-2 text-xs text-[var(--color-muted-foreground)] sm:grid">
              <span>Code</span>
              <span>Name</span>
              <span>Max days</span>
              <span>Tracked</span>
              <span>Signature</span>
              <span>Express</span>
              <span>Domestic</span>
              <span>Intl</span>
              <span />
            </div>
            {services.map((s, i) => {
              const setS = (patch: Partial<CourierService>) => setServices(services.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_2fr_90px_repeat(5,auto)_36px] sm:items-center">
                  <Input value={s.code} onChange={(e) => setS({ code: e.target.value })} placeholder="Code" className="font-mono" aria-label={`Service ${i + 1} code`} />
                  <Input value={s.name} onChange={(e) => setS({ name: e.target.value })} placeholder="Name" aria-label={`Service ${i + 1} name`} />
                  <Input type="number" min={0} value={s.maxTransitDays ?? ''} onChange={(e) => setS({ maxTransitDays: e.target.value === '' ? null : Number(e.target.value) })} aria-label={`Service ${i + 1} max transit days`} />
                  {(['tracked', 'signature', 'express', 'domestic', 'international'] as const).map((flag) => (
                    <label key={flag} className="flex items-center gap-1 text-xs sm:justify-center">
                      <Checkbox checked={!!s[flag]} onCheckedChange={(v) => setS({ [flag]: v === true })} aria-label={`Service ${i + 1} ${flag}`} />
                      <span className="sm:hidden">{flag}</span>
                    </label>
                  ))}
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove service ${i + 1}`} onClick={() => setServices(services.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <Button type="button" size="sm" variant="outline" onClick={() => setServices([...services, { ...EMPTY_SERVICE }])}>
              Add service
            </Button>
          </div>
        </Section>
      )}

      {step === 'Test' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Run a test call">
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-muted-foreground)]">The profile is saved first. Tests run against a courier account that holds real (or sandbox) credentials for it.</p>
              <div className="space-y-1">
                <Label htmlFor="test-account">Courier account</Label>
                <Select value={testAccount || '__none'} onValueChange={(v) => setTestAccount(v === '__none' ? '' : v)}>
                  <SelectTrigger id="test-account">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Choose…</SelectItem>
                    {(accounts.data ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} {a.sandbox ? '(sandbox)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="test-op">Operation</Label>
                <Select value={testOp} onValueChange={(v) => setTestOp(v as ProfileTestOperation)}>
                  <SelectTrigger id="test-op">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['auth', 'create_shipment', 'get_label', 'track', 'void_shipment'] as const).map((o) => (
                      <SelectItem key={o} value={o}>
                        {o.replace('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {testOp !== 'auth' && (
                <div className="space-y-1">
                  <Label htmlFor="test-ref">Sample order reference (optional)</Label>
                  <Input id="test-ref" value={testRef} onChange={(e) => setTestRef(e.target.value)} placeholder="An existing order to fill the template from" />
                </div>
              )}
              <Button onClick={runTest} disabled={testProfile.isPending || create.isPending || update.isPending}>
                {testProfile.isPending ? 'Testing…' : 'Run test'}
              </Button>
            </div>
          </Section>
          <Section title="Result">
            {!testResult ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">No test run yet.</p>
            ) : (
              <div className="space-y-2 text-sm">
                <p className={testResult.ok ? 'font-medium text-emerald-800' : 'font-medium text-red-800'}>{testResult.ok ? 'Success' : 'Failed'}{testResult.message ? ` — ${testResult.message}` : ''}</p>
                {testResult.request !== undefined && (
                  <details open>
                    <summary className="cursor-pointer text-xs">Request</summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded bg-[var(--color-muted)] p-2 text-xs">{pretty(testResult.request)}</pre>
                  </details>
                )}
                {testResult.response !== undefined && (
                  <details open>
                    <summary className="cursor-pointer text-xs">Response</summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded bg-[var(--color-muted)] p-2 text-xs">{pretty(testResult.response)}</pre>
                  </details>
                )}
              </div>
            )}
          </Section>
        </div>
      )}

      {step === 'Save' && (
        <Section title="Save">
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-medium">{name || 'Unnamed courier'}</span> · {services.filter((s) => s.code.trim()).length} service(s) · {creds.filter((c) => c.key.trim()).length} credential field(s)
            </p>
            <p className="text-[var(--color-muted-foreground)]">Saving keeps the profile private to your account. Submitting shares it with the catalogue for review so other businesses can use it.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={async () => {
                  const id = await save();
                  if (id) navigate({ to: '/couriers' });
                }}
                disabled={create.isPending || update.isPending}
              >
                {create.isPending || update.isPending ? 'Saving…' : 'Save profile'}
              </Button>
              <Button variant="outline" onClick={share} disabled={submitProfile.isPending}>
                {submitProfile.isPending ? 'Submitting…' : 'Save and share to catalogue'}
              </Button>
            </div>
          </div>
        </Section>
      )}

      <FormError message={error} />
      <div className="flex justify-between">
        <Button variant="outline" onClick={back} disabled={stepIndex === 0}>
          Back
        </Button>
        <Button variant="outline" onClick={next} disabled={stepIndex === STEPS.length - 1}>
          Next
        </Button>
      </div>
    </div>
  );
}
