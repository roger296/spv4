/**
 * Account settings, warehouses, address book, API keys and webhooks.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { accounts, addressBook, apiKeys, warehouses, webhooks } from '../../db/schema/index.js';
import { requireAuth, requireUser } from '../../shared/auth-middleware.js';
import { requireRole, requireWrite } from '../../shared/context.js';
import { audit, diff } from '../../shared/audit.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { generateApiKey } from '../../shared/api-key.js';
import { toAlpha2 } from '../../shared/countries.js';
import { API_SCOPES, STATIONERY } from '@spv4/shared-types';
import { randomToken } from '../../shared/password.js';

const addressSchema = z.object({
  contactName: z.string().max(120).nullish(),
  company: z.string().max(120).nullish(),
  line1: z.string().max(255).nullish(),
  line2: z.string().max(255).nullish(),
  city: z.string().max(100).nullish(),
  region: z.string().max(100).nullish(),
  postCode: z.string().max(20).nullish(),
  country: z.string().nullish().transform((v) => (v ? toAlpha2(v) : v)),
  phone: z.string().max(50).nullish(),
  email: z.string().max(200).nullish(),
});

const warehouseSchema = addressSchema.extend({
  name: z.string().min(1).max(200),
  externalRef: z.string().max(100).nullish(),
  isDefault: z.boolean().optional(),
  eori: z.string().max(30).nullish(),
  vatNumber: z.string().max(30).nullish(),
  iossNumber: z.string().max(30).nullish(),
  stationery: z.enum(STATIONERY).nullish(),
  autoLabel: z.boolean().optional(),
  packingNote: z.boolean().optional(),
  shippedAfterHours: z.number().int().min(1).max(240).optional(),
  allowedMethodIds: z.array(z.string().uuid()).nullish(),
});

const settingsSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  stationery: z.enum(STATIONERY).optional(),
  currency: z.string().length(3).optional(),
  settings: z.object({
    packagingAllowanceKg: z.number().min(0).max(5).optional(),
    defaultBox: z.object({ length: z.number().positive(), width: z.number().positive(), height: z.number().positive() }).optional(),
    aiApprovalRequired: z.boolean().optional(),
    trustAiAboveConfidence: z.number().min(0).max(1).optional(),
    notificationEmails: z.array(z.string().email()).optional(),
    trackingBranding: z.object({ logoUrl: z.string().optional(), colour: z.string().optional(), supportEmail: z.string().optional() }).optional(),
    a4Label: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
    dailyProblemEmail: z.boolean().optional(),
  }).partial().optional(),
});

export async function settingsRoutes(app: FastifyInstance) {
  const db = getDb();

  // ---- account ----
  app.get('/account', { preHandler: requireAuth }, async (req) => {
    const [a] = await db.select().from(accounts).where(eq(accounts.id, req.ctx.accountId)).limit(1);
    if (!a) throw new NotFoundError('account');
    const { mollieCustomerId, mollieMandateId, mollieSubscriptionId, ...safe } = a;
    return { ...safe, billing: { hasMandate: !!mollieMandateId, hasSubscription: !!mollieSubscriptionId } };
  });

  app.patch('/account', { preHandler: requireUser }, async (req) => {
    requireRole(req.ctx, 'MANAGER');
    const patch = settingsSchema.parse(req.body);
    const [before] = await db.select().from(accounts).where(eq(accounts.id, req.ctx.accountId)).limit(1);
    if (!before) throw new NotFoundError('account');
    const settings = patch.settings ? { ...before.settings, ...patch.settings } : before.settings;
    const [after] = await db.update(accounts).set({ ...patch, settings, updatedAt: new Date() }).where(eq(accounts.id, req.ctx.accountId)).returning();
    const d = diff({ name: before.name, stationery: before.stationery, currency: before.currency, settings: before.settings }, { name: after!.name, stationery: after!.stationery, currency: after!.currency, settings: after!.settings });
    if (d.changed) await audit(req.ctx, { action: 'account.updated', entityType: 'account', entityId: req.ctx.accountId, before: d.before, after: d.after });
    return after;
  });

  // ---- warehouses ----
  app.get('/warehouses', { preHandler: requireAuth }, async (req) =>
    db.select().from(warehouses).where(and(eq(warehouses.accountId, req.ctx.accountId), isNull(warehouses.deletedAt))).orderBy(desc(warehouses.isDefault), warehouses.name));

  app.post('/warehouses', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'methods:write', 'MANAGER');
    const input = warehouseSchema.parse(req.body);
    const [row] = await db.transaction(async (tx) => {
      if (input.isDefault) await tx.update(warehouses).set({ isDefault: false }).where(eq(warehouses.accountId, req.ctx.accountId));
      return tx.insert(warehouses).values({ ...input, accountId: req.ctx.accountId }).returning();
    });
    await audit(req.ctx, { action: 'warehouse.created', entityType: 'warehouse', entityId: row!.id, after: input });
    return reply.status(201).send(row);
  });

  app.patch('/warehouses/:id', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'methods:write', 'MANAGER');
    const { id } = req.params as { id: string };
    const patch = warehouseSchema.partial().parse(req.body);
    const [before] = await db.select().from(warehouses).where(and(eq(warehouses.id, id), eq(warehouses.accountId, req.ctx.accountId), isNull(warehouses.deletedAt))).limit(1);
    if (!before) throw new NotFoundError('warehouse', id);
    const [after] = await db.transaction(async (tx) => {
      if (patch.isDefault) await tx.update(warehouses).set({ isDefault: false }).where(eq(warehouses.accountId, req.ctx.accountId));
      return tx.update(warehouses).set({ ...patch, updatedAt: new Date() }).where(eq(warehouses.id, id)).returning();
    });
    const d = diff(before as Record<string, unknown>, after as Record<string, unknown>);
    if (d.changed) await audit(req.ctx, { action: 'warehouse.updated', entityType: 'warehouse', entityId: id, before: d.before, after: d.after });
    return after;
  });

  app.delete('/warehouses/:id', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'methods:write', 'MANAGER');
    const { id } = req.params as { id: string };
    const [w] = await db.select().from(warehouses).where(and(eq(warehouses.id, id), eq(warehouses.accountId, req.ctx.accountId), isNull(warehouses.deletedAt))).limit(1);
    if (!w) throw new NotFoundError('warehouse', id);
    if (w.isDefault) throw new ValidationError('Make another warehouse the default first');
    await db.update(warehouses).set({ deletedAt: new Date() }).where(eq(warehouses.id, id));
    await audit(req.ctx, { action: 'warehouse.deleted', entityType: 'warehouse', entityId: id, before: { name: w.name } });
    return reply.status(204).send();
  });

  // ---- address book ----
  const entrySchema = addressSchema.extend({ label: z.string().min(1).max(120) });

  app.get('/address-book', { preHandler: requireAuth }, async (req) => {
    const q = ((req.query as { q?: string }).q ?? '').trim().toLowerCase();
    const rows = await db.select().from(addressBook).where(and(eq(addressBook.accountId, req.ctx.accountId), isNull(addressBook.deletedAt))).orderBy(desc(addressBook.lastUsedAt), addressBook.label);
    if (!q) return rows;
    return rows.filter((r) => [r.label, r.contactName, r.company, r.city, r.postCode, r.email].some((v) => v?.toLowerCase().includes(q)));
  });

  app.post('/address-book', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'orders:write');
    const input = entrySchema.parse(req.body);
    const [row] = await db.insert(addressBook).values({ ...input, accountId: req.ctx.accountId }).returning();
    await audit(req.ctx, { action: 'address.created', entityType: 'address', entityId: row!.id, after: input });
    return reply.status(201).send(row);
  });

  app.patch('/address-book/:id', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'orders:write');
    const { id } = req.params as { id: string };
    const patch = entrySchema.partial().parse(req.body);
    const [before] = await db.select().from(addressBook).where(and(eq(addressBook.id, id), eq(addressBook.accountId, req.ctx.accountId), isNull(addressBook.deletedAt))).limit(1);
    if (!before) throw new NotFoundError('address', id);
    const [after] = await db.update(addressBook).set({ ...patch, updatedAt: new Date() }).where(eq(addressBook.id, id)).returning();
    const d = diff(before as Record<string, unknown>, after as Record<string, unknown>);
    if (d.changed) await audit(req.ctx, { action: 'address.updated', entityType: 'address', entityId: id, before: d.before, after: d.after });
    return after;
  });

  app.delete('/address-book/:id', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'orders:write');
    const { id } = req.params as { id: string };
    const r = await db.update(addressBook).set({ deletedAt: new Date() }).where(and(eq(addressBook.id, id), eq(addressBook.accountId, req.ctx.accountId))).returning({ id: addressBook.id });
    if (!r.length) throw new NotFoundError('address', id);
    await audit(req.ctx, { action: 'address.deleted', entityType: 'address', entityId: id });
    return reply.status(204).send();
  });

  // ---- API keys and MCP connections ----
  app.get('/api-keys', { preHandler: requireUser }, async (req) => {
    requireRole(req.ctx, 'MANAGER');
    return db.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scopes: apiKeys.scopes, kind: apiKeys.kind, clientName: apiKeys.clientName, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt })
      .from(apiKeys).where(eq(apiKeys.accountId, req.ctx.accountId)).orderBy(desc(apiKeys.createdAt));
  });

  app.post('/api-keys', { preHandler: requireUser }, async (req, reply) => {
    requireRole(req.ctx, 'MANAGER');
    const input = z.object({ name: z.string().min(1).max(120), scopes: z.array(z.enum(API_SCOPES)).min(1), kind: z.enum(['api', 'mcp']).default('api'), clientName: z.string().max(120).optional() }).parse(req.body);
    const gen = generateApiKey();
    const [row] = await db.insert(apiKeys).values({ accountId: req.ctx.accountId, name: input.name, prefix: gen.prefix, keyHash: gen.hash, scopes: input.scopes, kind: input.kind, clientName: input.clientName ?? null }).returning();
    await audit(req.ctx, { action: 'api_key.created', entityType: 'api_key', entityId: row!.id, after: { name: input.name, scopes: input.scopes, kind: input.kind } });
    // The raw key is shown once.
    return reply.status(201).send({ id: row!.id, name: row!.name, prefix: row!.prefix, scopes: row!.scopes, kind: row!.kind, key: gen.raw });
  });

  app.delete('/api-keys/:id', { preHandler: requireUser }, async (req, reply) => {
    requireRole(req.ctx, 'MANAGER');
    const { id } = req.params as { id: string };
    const r = await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.accountId, req.ctx.accountId))).returning({ id: apiKeys.id });
    if (!r.length) throw new NotFoundError('api key', id);
    await audit(req.ctx, { action: 'api_key.revoked', entityType: 'api_key', entityId: id });
    return reply.status(204).send();
  });

  // ---- webhooks ----
  const WEBHOOK_EVENTS = ['order.label_generated', 'order.shipped', 'order.in_transit', 'order.delivered', 'order.problem', 'order.cancelled'] as const;

  app.get('/webhooks', { preHandler: requireAuth }, async (req) => {
    requireRole(req.ctx, 'MANAGER');
    const rows = await db.select().from(webhooks).where(eq(webhooks.accountId, req.ctx.accountId));
    return rows.map(({ secret, ...r }) => ({ ...r, secretPreview: `${secret.slice(0, 6)}…` }));
  });

  app.post('/webhooks', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'orders:write', 'MANAGER');
    const input = z.object({ url: z.string().url().max(500), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) }).parse(req.body);
    const secret = randomToken(24);
    const [row] = await db.insert(webhooks).values({ accountId: req.ctx.accountId, url: input.url, events: input.events, secret }).returning();
    await audit(req.ctx, { action: 'webhook.created', entityType: 'webhook', entityId: row!.id, after: input });
    return reply.status(201).send({ ...row, secret });
  });

  app.delete('/webhooks/:id', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'orders:write', 'MANAGER');
    const { id } = req.params as { id: string };
    const r = await db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.accountId, req.ctx.accountId))).returning({ id: webhooks.id });
    if (!r.length) throw new NotFoundError('webhook', id);
    await audit(req.ctx, { action: 'webhook.deleted', entityType: 'webhook', entityId: id });
    return reply.status(204).send();
  });
}
