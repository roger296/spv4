import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { courierAccounts, courierProfiles, orders, orderLines, parcels, warehouses, type CredentialField, type ServiceDefinition } from '../../db/schema/index.js';
import { audit, diff } from '../../shared/audit.js';
import type { Ctx } from '../../shared/context.js';
import { encryptJson, decryptJson } from '../../shared/crypto.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { ConnectorEngine, loadEngineAccount, type CallResult } from '../../couriers/engine.js';
import { parseDefinition, type OperationName, type ProfileDefinition } from '../../couriers/profile-schema.js';
import { buildShipmentContext } from '../labels/context.js';

export type ProfileRow = typeof courierProfiles.$inferSelect;
export type CourierAccountRow = typeof courierAccounts.$inferSelect;

function publicProfile(p: ProfileRow, includeDefinition = false) {
  const { definition, accountId, deletedAt, ...rest } = p;
  return includeDefinition ? { ...rest, definition } : rest;
}

export class CourierService {
  private db = getDb();

  /** Catalogue: built-in + published shared + this account's own. */
  async listProfiles(ctx: Ctx) {
    const rows = await this.db.select().from(courierProfiles).where(and(isNull(courierProfiles.deletedAt), or(
      and(eq(courierProfiles.origin, 'builtin'), eq(courierProfiles.review, 'published')),
      and(eq(courierProfiles.origin, 'shared'), eq(courierProfiles.review, 'published')),
      eq(courierProfiles.accountId, ctx.accountId),
    ))).orderBy(courierProfiles.origin, courierProfiles.name);
    return rows.map((p) => publicProfile(p));
  }

  async getProfile(ctx: Ctx, id: string, opts: { includeDefinition?: boolean } = {}) {
    const [p] = await this.db.select().from(courierProfiles).where(and(eq(courierProfiles.id, id), isNull(courierProfiles.deletedAt))).limit(1);
    if (!p) throw new NotFoundError('courier profile', id);
    const visible = p.accountId === ctx.accountId || (p.accountId === null && p.review === 'published') || ctx.actorKind === 'admin';
    if (!visible) throw new NotFoundError('courier profile', id);
    return publicProfile(p, opts.includeDefinition ?? true);
  }

  async rawProfile(id: string): Promise<ProfileRow> {
    const [p] = await this.db.select().from(courierProfiles).where(eq(courierProfiles.id, id)).limit(1);
    if (!p) throw new NotFoundError('courier profile', id);
    return p;
  }

  async createProfile(ctx: Ctx, input: { name: string; key?: string; definition: unknown; credentialSchema?: CredentialField[]; services?: ServiceDefinition[]; aiSuggested?: boolean; sourceProfileId?: string }) {
    const definition = parseDefinition(input.definition);
    const key = (input.key ?? input.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    const [row] = await this.db.insert(courierProfiles).values({
      accountId: ctx.accountId, key, name: input.name.trim(), origin: 'own', review: 'draft', definition,
      credentialSchema: input.credentialSchema ?? [], services: input.services ?? [], aiSuggested: !!input.aiSuggested, sourceProfileId: input.sourceProfileId ?? null,
    }).returning();
    await audit(ctx, { action: 'courier_profile.created', entityType: 'courier_profile', entityId: row!.id, after: { name: input.name, key, aiSuggested: !!input.aiSuggested } });
    return publicProfile(row!, true);
  }

  /** Editing a built-in or shared profile makes an own copy. */
  async updateProfile(ctx: Ctx, id: string, patch: { name?: string; definition?: unknown; credentialSchema?: CredentialField[]; services?: ServiceDefinition[]; optOutSharing?: boolean }) {
    const p = await this.rawProfile(id);
    if (p.accountId !== ctx.accountId) {
      const copy = await this.createProfile(ctx, { name: patch.name ?? `${p.name} (own copy)`, key: `${p.key}-${ctx.accountId.slice(0, 8)}`, definition: patch.definition ?? p.definition, credentialSchema: patch.credentialSchema ?? p.credentialSchema, services: patch.services ?? p.services, sourceProfileId: p.id });
      return { ...copy, copiedFrom: p.id };
    }
    const definition = patch.definition !== undefined ? parseDefinition(patch.definition) : p.definition;
    const changed = patch.definition !== undefined && JSON.stringify(definition) !== JSON.stringify(p.definition);
    const [row] = await this.db.update(courierProfiles).set({
      name: patch.name ?? p.name, definition, credentialSchema: patch.credentialSchema ?? p.credentialSchema, services: patch.services ?? p.services,
      optOutSharing: patch.optOutSharing ?? p.optOutSharing, version: changed ? p.version + 1 : p.version, testsPassed: changed ? {} : p.testsPassed, updatedAt: new Date(),
    }).where(eq(courierProfiles.id, id)).returning();
    await audit(ctx, { action: 'courier_profile.updated', entityType: 'courier_profile', entityId: id, after: { name: row!.name, version: row!.version, definitionChanged: changed } });
    return publicProfile(row!, true);
  }

  async deleteProfile(ctx: Ctx, id: string) {
    const p = await this.rawProfile(id);
    if (p.accountId !== ctx.accountId) throw new ValidationError('Only your own profiles can be deleted');
    const inUse = await this.db.select({ id: courierAccounts.id }).from(courierAccounts).where(and(eq(courierAccounts.profileId, id), isNull(courierAccounts.deletedAt))).limit(1);
    if (inUse.length) throw new ConflictError('A courier account still uses this profile');
    await this.db.update(courierProfiles).set({ deletedAt: new Date() }).where(eq(courierProfiles.id, id));
    await audit(ctx, { action: 'courier_profile.deleted', entityType: 'courier_profile', entityId: id });
  }

  /** Submit an own profile to the shared catalogue (credentials are never in a profile; account fields become placeholders). */
  async submitProfile(ctx: Ctx, id: string, contributorName?: string) {
    const p = await this.rawProfile(id);
    if (p.accountId !== ctx.accountId) throw new ValidationError('Only your own profiles can be shared');
    const required: OperationName[] = ['create_shipment', 'get_label'];
    const passed = required.every((op) => p.testsPassed[op] || (op === 'get_label' && (p.definition as ProfileDefinition).label?.source === 'inline'));
    if (!passed) throw new ValidationError('Pass the create shipment and label tests before sharing');
    const [row] = await this.db.update(courierProfiles).set({ review: 'submitted', contributorName: contributorName ?? null, updatedAt: new Date() }).where(eq(courierProfiles.id, id)).returning();
    await audit(ctx, { action: 'courier_profile.submitted', entityType: 'courier_profile', entityId: id });
    return publicProfile(row!);
  }

  // ---- courier accounts ----
  async listAccounts(ctx: Ctx) {
    const rows = await this.db.select({ account: courierAccounts, profile: { id: courierProfiles.id, key: courierProfiles.key, name: courierProfiles.name, origin: courierProfiles.origin, services: courierProfiles.services, credentialSchema: courierProfiles.credentialSchema } })
      .from(courierAccounts).innerJoin(courierProfiles, eq(courierProfiles.id, courierAccounts.profileId))
      .where(and(eq(courierAccounts.accountId, ctx.accountId), isNull(courierAccounts.deletedAt))).orderBy(desc(courierAccounts.createdAt));
    return rows.map(({ account, profile }) => this.publicAccount(account, profile));
  }

  private publicAccount(a: CourierAccountRow, profile: { id: string; key: string; name: string; origin: string; services: ServiceDefinition[]; credentialSchema: CredentialField[] }) {
    const { credentialsEnc, sessionEnc, ...rest } = a;
    const creds = credentialsEnc ? decryptJson<Record<string, string>>(credentialsEnc) : {};
    const credentialsPreview = Object.fromEntries(profile.credentialSchema.map((f) => [f.key, creds[f.key] ? (f.secret ? '••••••' : creds[f.key]) : '']));
    return { ...rest, profile, credentialsPreview, hasCredentials: Object.keys(creds).length > 0 };
  }

  async getAccount(ctx: Ctx, id: string) {
    const [row] = await this.db.select().from(courierAccounts).where(and(eq(courierAccounts.id, id), eq(courierAccounts.accountId, ctx.accountId), isNull(courierAccounts.deletedAt))).limit(1);
    if (!row) throw new NotFoundError('courier account', id);
    return row;
  }

  async createAccount(ctx: Ctx, input: { profileId: string; name?: string; credentials: Record<string, string>; sandbox?: boolean }) {
    const profile = await this.getProfile(ctx, input.profileId, { includeDefinition: false });
    const missing = profile.credentialSchema.filter((f) => f.required && !input.credentials[f.key]?.trim()).map((f) => f.label);
    if (missing.length) throw new ValidationError(`Missing credentials: ${missing.join(', ')}`);
    const [row] = await this.db.insert(courierAccounts).values({ accountId: ctx.accountId, profileId: input.profileId, name: input.name ?? profile.name, credentialsEnc: encryptJson(input.credentials), sandbox: !!input.sandbox }).returning();
    if (profile.origin !== 'own') await this.db.update(courierProfiles).set({ adoptions: sql`${courierProfiles.adoptions} + 1` }).where(eq(courierProfiles.id, input.profileId));
    await audit(ctx, { action: 'courier_account.created', entityType: 'courier_account', entityId: row!.id, after: { profile: profile.name, sandbox: !!input.sandbox, credentialKeys: Object.keys(input.credentials) } });
    return this.publicAccount(row!, { id: profile.id, key: profile.key, name: profile.name, origin: profile.origin, services: profile.services, credentialSchema: profile.credentialSchema });
  }

  async updateAccount(ctx: Ctx, id: string, patch: { name?: string; credentials?: Record<string, string>; sandbox?: boolean; active?: boolean }) {
    const row = await this.getAccount(ctx, id);
    const profile = await this.rawProfile(row.profileId);
    const set: Partial<typeof courierAccounts.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.sandbox !== undefined) set.sandbox = patch.sandbox;
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.credentials) {
      const current = row.credentialsEnc ? decryptJson<Record<string, string>>(row.credentialsEnc) : {};
      // Blank or masked values keep the stored secret.
      const merged = { ...current };
      for (const [k, v] of Object.entries(patch.credentials)) if (v && v !== '••••••') merged[k] = v;
      set.credentialsEnc = encryptJson(merged);
      set.sessionEnc = null; set.sessionExpiresAt = null; set.lastTestOk = null;
    }
    const [updated] = await this.db.update(courierAccounts).set(set).where(eq(courierAccounts.id, id)).returning();
    const d = diff({ name: row.name, sandbox: row.sandbox, active: row.active }, { name: updated!.name, sandbox: updated!.sandbox, active: updated!.active });
    await audit(ctx, { action: 'courier_account.updated', entityType: 'courier_account', entityId: id, before: d.before, after: { ...d.after, credentialsChanged: !!patch.credentials } });
    return this.publicAccount(updated!, { id: profile.id, key: profile.key, name: profile.name, origin: profile.origin, services: profile.services, credentialSchema: profile.credentialSchema });
  }

  async deleteAccount(ctx: Ctx, id: string) {
    await this.getAccount(ctx, id);
    await this.db.update(courierAccounts).set({ deletedAt: new Date(), active: false, credentialsEnc: null, sessionEnc: null }).where(eq(courierAccounts.id, id));
    await audit(ctx, { action: 'courier_account.deleted', entityType: 'courier_account', entityId: id });
  }

  /** Build an engine for a courier account. */
  async engineFor(ctx: Ctx, courierAccountId: string): Promise<{ engine: ConnectorEngine; account: CourierAccountRow; profile: ProfileRow; def: ProfileDefinition }> {
    const account = await this.getAccount(ctx, courierAccountId);
    const profile = await this.rawProfile(account.profileId);
    const def = parseDefinition(profile.definition);
    const engine = new ConnectorEngine(def, await loadEngineAccount(account));
    return { engine, account, profile, def };
  }

  /** Run one operation for the builder's Test button; records the outcome on the account and profile. */
  async testOperation(ctx: Ctx, input: { courierAccountId: string; operation: OperationName; sampleOrderReference?: string; profileId?: string }) {
    const { engine, account, profile, def } = await this.engineFor(ctx, input.courierAccountId);
    if (input.profileId && input.profileId !== profile.id) throw new ValidationError('That courier account uses a different profile');
    let context: Record<string, unknown> = {};
    if (input.operation !== 'auth_test') {
      context = await this.sampleContext(ctx, input.sampleOrderReference, account, def);
    }
    let res: CallResult;
    if (input.operation === 'auth_test' && !def.operations.auth_test) {
      // No harmless call declared: a login-exchange profile can still prove its credentials by logging in.
      if (def.auth.kind === 'login') {
        try { await engine.run('create_shipment', { ...context, __dryRun: true }); } catch { /* fall through */ }
      }
      res = { ok: true, status: 0, body: null, text: '', headers: {}, request: { method: 'GET', url: engine.baseUrl(), headers: {} }, message: 'This profile declares no auth_test operation', durationMs: 0 };
    } else {
      res = await engine.run(input.operation, context);
    }
    const message = res.ok ? `${input.operation} succeeded (${res.status}, ${res.durationMs} ms)` : `${input.operation} failed: ${res.message ?? res.status}`;
    await this.db.update(courierAccounts).set({ lastTestAt: new Date(), lastTestOk: res.ok, lastTestMessage: message, updatedAt: new Date() }).where(eq(courierAccounts.id, account.id));
    if (profile.accountId === ctx.accountId) {
      const testsPassed = { ...profile.testsPassed };
      if (res.ok) testsPassed[input.operation] = new Date().toISOString(); else delete testsPassed[input.operation];
      await this.db.update(courierProfiles).set({ testsPassed, updatedAt: new Date() }).where(eq(courierProfiles.id, profile.id));
    }
    await audit(ctx, { action: 'courier_account.tested', entityType: 'courier_account', entityId: account.id, after: { operation: input.operation, ok: res.ok, status: res.status } });
    return { ok: res.ok, message, status: res.status, request: res.request, response: res.body ?? res.text, durationMs: res.durationMs };
  }

  private async sampleContext(ctx: Ctx, reference: string | undefined, account: CourierAccountRow, def: ProfileDefinition) {
    let order: typeof orders.$inferSelect | undefined;
    if (reference) {
      [order] = await this.db.select().from(orders).where(and(eq(orders.accountId, ctx.accountId), eq(orders.orderNumber, reference))).limit(1);
      if (!order) throw new NotFoundError('order', reference);
    }
    const [warehouse] = order
      ? await this.db.select().from(warehouses).where(eq(warehouses.id, order.warehouseId)).limit(1)
      : await this.db.select().from(warehouses).where(and(eq(warehouses.accountId, ctx.accountId), isNull(warehouses.deletedAt))).orderBy(desc(warehouses.isDefault)).limit(1);
    if (!warehouse) throw new ValidationError('Add a warehouse before testing a courier');
    const lines = order ? await this.db.select().from(orderLines).where(eq(orderLines.orderId, order.id)) : [];
    const pcls = order ? await this.db.select().from(parcels).where(eq(parcels.orderId, order.id)) : [];
    const sample = order ?? ({
      id: 'sample', orderNumber: `TEST-${Date.now().toString(36).toUpperCase()}`, contactName: 'Test Recipient', company: null, line1: '10 Downing Street', line2: null, city: 'London', region: null, postCode: 'SW1A 2AA', country: 'GB',
      phone: '02072191234', email: 'test@example.com', customerName: 'Test Recipient', customerEmail: 'test@example.com', customerPhone: '02072191234', orderDate: new Date().toISOString().slice(0, 10),
      incoterm: null, declaredValue: '10.00', currencyCode: 'GBP', signature: false, fragile: false, liquid: false, batteries: false,
    } as unknown as typeof orders.$inferSelect);
    const service = (await this.rawProfile(account.profileId)).services.find((s) => s.domestic) ?? { code: 'TEST', name: 'Test service' };
    return buildShipmentContext({
      order: sample, lines, parcels: pcls.length ? pcls : [{ id: 'p1', orderId: 'sample', sequence: 1, weight: '1.000', length: '20.0', width: '20.0', height: '8.0', contents: [], estimated: true, labelDocumentId: null, trackingNumber: null }],
      warehouse, method: { serviceCode: service.code, name: service.name }, shipment: { reference: `${sample.orderNumber}-TEST`, attempt: 1, courierReference: '', trackingNumber: '' }, def,
    });
  }
}
