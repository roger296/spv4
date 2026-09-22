/**
 * MCP tools (spec section 11). Each tool wraps the same services the REST API uses, runs as the
 * connected account with the key's scopes, and returns enough context for a follow-up question.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import type { Ctx } from '../shared/context.js';
import { requireWrite, requireScope } from '../shared/context.js';
import { getDb } from '../config/database.js';
import { addressBook, orders, products as productsTable } from '../db/schema/index.js';
import { OrderService } from '../modules/orders/order.service.js';
import { LabelService } from '../modules/labels/label.service.js';
import { ProductsService } from '../modules/products/products.service.js';
import { MethodsService } from '../modules/methods/methods.service.js';
import { TrackingService } from '../modules/tracking/tracking.service.js';
import { CourierService } from '../modules/couriers/courier.service.js';
import { draftProfileFromDocumentation } from '../modules/ai/profile-drafter.js';
import { suggestProblemAction } from '../modules/ai/problem-triage.js';
import { NeedsInformationError, NoMethodError, AppError } from '../shared/errors.js';
import { toAlpha2 } from '../shared/countries.js';
import { OPERATION_NAMES } from '../couriers/profile-schema.js';
import { getEnv } from '../config/env.js';
import { audit } from '../shared/audit.js';

const address = z.object({
  contactName: z.string().describe('Recipient name'), company: z.string().optional(), line1: z.string(), line2: z.string().optional(), city: z.string(),
  region: z.string().optional(), postCode: z.string().default(''), country: z.string().describe('Country name or ISO code'), phone: z.string().optional(), email: z.string().optional(),
});
const parcel = z.object({ weight: z.number().describe('kg'), length: z.number().describe('cm'), width: z.number().describe('cm'), height: z.number().describe('cm') });
const line = z.object({ sku: z.string(), name: z.string().optional(), quantity: z.number(), unitValue: z.number().optional(), weight: z.number().optional(), dimensions: z.object({ length: z.number(), width: z.number(), height: z.number() }).optional(), hsCode: z.string().optional(), countryOfOrigin: z.string().optional(), customsDescription: z.string().optional() });

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (err: unknown): ToolResult => {
  if (err instanceof NeedsInformationError) return { content: [{ type: 'text', text: JSON.stringify({ status: 'needs_information', reference: err.reference, orderStatus: err.orderStatus, missing: err.missing, hint: 'Ask the user for the missing values (or use parcels[] instead of product data), then call create_shipment again with the same reference or update_product then buy_label.' }, null, 2) }], isError: true };
  if (err instanceof NoMethodError) return { content: [{ type: 'text', text: JSON.stringify({ status: 'no_method', reference: err.reference, dropped: err.dropped, hint: 'No shipping method fits. Offer to change the delivery promise, split the parcel, or add a method.' }, null, 2) }], isError: true };
  if (err instanceof AppError) return { content: [{ type: 'text', text: JSON.stringify({ error: err.code, message: err.message, details: err.details }, null, 2) }], isError: true };
  return { content: [{ type: 'text', text: JSON.stringify({ error: 'internal', message: (err as Error).message }) }], isError: true };
};
const run = async (fn: () => Promise<unknown>): Promise<ToolResult> => { try { return ok(await fn()); } catch (e) { return fail(e); } };

function trim(order: Awaited<ReturnType<OrderService['get']>>) {
  const { metadata, selection, lines, parcels, shipments, documents, problems, trackingEvents, ...o } = order;
  const origin = getEnv().API_ORIGIN;
  return {
    ...o, lines: lines.map((l) => ({ sku: l.sku, name: l.name, quantity: l.quantity })), parcels: parcels.map((p) => ({ weightKg: p.weight, lengthCm: p.length, widthCm: p.width, heightCm: p.height, estimated: p.estimated })),
    chosenMethod: selection ? { reason: selection.reason, alternatives: selection.ranked.slice(0, 4) } : null,
    documents: documents.map((d) => ({ kind: d.kind, url: `${origin}${d.url}` })), openProblems: problems.filter((p) => !p.resolvedAt).map((p) => ({ id: p.id, kind: p.kind, description: p.description, suggestedAction: p.suggestedAction })),
    latestEvents: trackingEvents.slice(0, 5).map((e) => ({ at: e.occurredAt, status: e.courierStatus, location: e.location })),
    shipments: shipments.map((s) => ({ attempt: s.attempt, status: s.status, courier: s.courierName, method: s.methodName, trackingNumber: s.trackingNumber, cost: s.cost })),
  };
}

export function registerTools(server: McpServer, ctx: Ctx) {
  const ordersSvc = new OrderService();
  const labels = new LabelService();
  const products = new ProductsService();
  const methods = new MethodsService();
  const tracking = new TrackingService();
  const couriers = new CourierService();
  const db = getDb();

  server.tool('find_recipient', 'Search the address book and past orders for a recipient by name, label (e.g. "mum"), company, town or postcode. Use before create_shipment when the user names a person rather than an address.', { query: z.string() }, async ({ query }) => run(async () => {
    requireScope(ctx, 'orders:read');
    const q = `%${query.trim()}%`;
    const book = await db.select().from(addressBook).where(and(eq(addressBook.accountId, ctx.accountId), isNull(addressBook.deletedAt), or(ilike(addressBook.label, q), ilike(addressBook.contactName, q), ilike(addressBook.company, q), ilike(addressBook.city, q), ilike(addressBook.postCode, q)))).limit(10);
    const past = await db.select({ contactName: orders.contactName, company: orders.company, line1: orders.line1, line2: orders.line2, city: orders.city, region: orders.region, postCode: orders.postCode, country: orders.country, phone: orders.phone, email: orders.email, orderNumber: orders.orderNumber, createdAt: orders.createdAt })
      .from(orders).where(and(eq(orders.accountId, ctx.accountId), isNull(orders.deletedAt), or(ilike(orders.contactName, q), ilike(orders.customerName, q), ilike(orders.email, q), ilike(orders.postCode, q)))).orderBy(desc(orders.createdAt)).limit(10);
    return { addressBook: book.map(({ accountId, deletedAt, createdAt, updatedAt, ...a }) => a), pastOrders: past, hint: book.length + past.length === 0 ? 'No match. Ask the user for the full address and offer to save it with save_recipient.' : undefined };
  }));

  server.tool('save_recipient', 'Save a recipient to the address book with a label such as "Mum" so it can be found next time.', { label: z.string(), address }, async ({ label, address: a }) => run(async () => {
    requireWrite(ctx, 'orders:write');
    const country = toAlpha2(a.country);
    if (!country) throw new AppError(400, 'validation', `Unknown country ${a.country}`);
    const [row] = await db.insert(addressBook).values({ accountId: ctx.accountId, label, ...a, country }).returning();
    await audit(ctx, { action: 'address.created', entityType: 'address', entityId: row!.id, after: { label } });
    return { id: row!.id, label };
  }));

  server.tool('quote_shipment', 'Rank the account\'s shipping methods and costs for a destination and parcel size without creating anything. Use to tell the user what it will cost before buying.', {
    country: z.string(), postCode: z.string().optional(), parcels: z.array(parcel).min(1), deliveryPromise: z.enum(['economy', 'standard', 'express', 'next_day']).optional(), warehouse: z.string().optional(),
    flags: z.object({ signature: z.boolean().optional(), fragile: z.boolean().optional(), liquid: z.boolean().optional(), batteries: z.boolean().optional() }).optional(), declaredValue: z.number().optional(),
  }, async (input) => run(async () => {
    requireScope(ctx, 'orders:read');
    const country = toAlpha2(input.country);
    if (!country) throw new AppError(400, 'validation', `Unknown country ${input.country}`);
    const r = await labels.quote(ctx, { warehouse: input.warehouse, country, postCode: input.postCode ?? null, parcels: input.parcels.map((p) => ({ weightKg: p.weight, lengthCm: p.length, widthCm: p.width, heightCm: p.height })), promise: input.deliveryPromise, flags: input.flags, declaredValue: input.declaredValue });
    return { chosen: r.chosen, ranked: r.ranked, dropped: r.dropped, reason: r.reason };
  }));

  server.tool('create_shipment', 'Create an order and, unless label is false, buy the label. Returns tracking, courier, cost and document links. If information is missing you get a needs_information result listing exactly what to ask the user for; call again with the same reference once you have it.', {
    reference: z.string().describe('Your reference for this shipment; reusing it returns the existing order'),
    deliveryAddress: address, customer: z.object({ name: z.string().optional(), email: z.string().optional(), phone: z.string().optional() }).optional(),
    lines: z.array(line).optional(), parcels: z.array(parcel).optional().describe('Give parcels when you know the weight and size; then product data is not needed'),
    deliveryPromise: z.string().optional().describe('economy | standard | express | next_day | YYYY-MM-DD'), warehouse: z.string().optional(),
    customs: z.object({ incoterm: z.enum(['DDU', 'DDP']).optional(), declaredValue: z.number().optional(), currency: z.string().optional() }).optional(),
    flags: z.object({ signature: z.boolean().optional(), fragile: z.boolean().optional(), liquid: z.boolean().optional(), batteries: z.boolean().optional() }).optional(),
    method: z.string().optional(), courier: z.string().optional(), label: z.boolean().optional(), metadata: z.record(z.unknown()).optional(),
  }, async (input) => run(async () => {
    requireWrite(ctx, 'orders:write');
    const { order, duplicate } = await ordersSvc.create(ctx, { ...input, deliveryAddress: { ...input.deliveryAddress, postCode: input.deliveryAddress.postCode ?? '' } }, 'mcp');
    if (duplicate) return { duplicate: true, order: trim(order) };
    if (input.label !== false) {
      if (order.status !== 'NEW') throw new NeedsInformationError(order.orderNumber, order.missing, order.status);
      const labelled = await ordersSvc.requestLabel(ctx, order.id);
      return { order: trim(labelled) };
    }
    return { order: trim(order) };
  }));

  server.tool('buy_label', 'Buy (or retry) the label for an existing order, optionally naming a method or courier.', { reference: z.string(), method: z.string().optional(), courier: z.string().optional() }, async ({ reference, method, courier }) => run(async () => {
    requireWrite(ctx, 'orders:write');
    return { order: trim(await ordersSvc.requestLabel(ctx, reference, { method, courier })) };
  }));

  server.tool('get_shipment', 'Full status of one order: courier, tracking, documents, problems, latest scans, history of choices.', { reference: z.string() }, async ({ reference }) => run(async () => {
    requireScope(ctx, 'orders:read');
    return trim(await ordersSvc.get(ctx, reference, { view: true }));
  }));

  server.tool('list_shipments', 'List orders. Without filters, the open set (problems first). Use status to filter (comma-separated), q to search reference, name, postcode, tracking or SKU.', { status: z.string().optional(), q: z.string().optional(), since: z.string().optional(), problem: z.string().optional(), all: z.boolean().optional(), page: z.number().optional() }, async (input) => run(async () => {
    requireScope(ctx, 'orders:read');
    const status = input.status?.split(',').map((s) => s.trim().toUpperCase()) as ('NEW')[] | undefined;
    const r = await ordersSvc.list(ctx, { ...input, status, pageSize: 50 });
    return { total: r.total, page: r.page, items: r.items.map((o) => ({ reference: o.orderNumber, status: o.status, problemReason: o.problemReason, recipient: o.contactName, town: o.city, country: o.country, courier: o.courierName, method: o.methodName, cost: o.cost, trackingNumber: o.trackingNumber, updatedAt: o.updatedAt })) };
  }));

  server.tool('get_document', 'Get a document (label, packing_note, customs_invoice, return_label) for an order as a URL the user can open, plus base64 PDF when inline is true.', { reference: z.string(), kind: z.enum(['label', 'packing_note', 'customs_invoice', 'return_label']).default('label'), inline: z.boolean().optional() }, async ({ reference, kind, inline }) => run(async () => {
    requireScope(ctx, 'labels:read');
    const order = await ordersSvc.get(ctx, reference);
    const doc = order.documents.find((d) => d.kind === kind);
    if (!doc) throw new AppError(404, 'not_found', `No ${kind} for ${reference}`);
    const url = `${getEnv().API_ORIGIN}${doc.url}`;
    if (!inline) return { kind, url, hint: 'Open the URL with the user\'s Smooth Parcel session, or call again with inline=true for the bytes.' };
    const { bytes } = await labels.documentBytes(ctx, reference, doc.id);
    return { kind, url, base64: bytes.toString('base64') };
  }));

  server.tool('cancel_shipment', 'Cancel an order and void its label with the courier (only before the parcel is scanned).', { reference: z.string(), reason: z.string().optional() }, async ({ reference, reason }) => run(async () => { requireWrite(ctx, 'orders:write'); return { order: trim(await ordersSvc.cancel(ctx, reference, reason)) }; }));
  server.tool('relabel_shipment', 'Void the current label and buy a new one with another method (by name or id).', { reference: z.string(), method: z.string().optional() }, async ({ reference, method }) => run(async () => { requireWrite(ctx, 'orders:write'); await labels.relabel(ctx, reference, method); return { order: trim(await ordersSvc.get(ctx, reference)) }; }));
  server.tool('create_return_label', 'Create a return label from the customer back to the warehouse that shipped the order.', { reference: z.string() }, async ({ reference }) => run(async () => { requireWrite(ctx, 'orders:write'); const r = await labels.createReturnLabel(ctx, reference); return { ...r, order: trim(await ordersSvc.get(ctx, reference)) }; }));
  server.tool('mark_shipped', 'Mark an order shipped by hand when the courier never scanned it.', { reference: z.string() }, async ({ reference }) => run(async () => { requireWrite(ctx, 'orders:write'); return { order: trim(await ordersSvc.markShipped(ctx, reference)) }; }));
  server.tool('refresh_tracking', 'Ask the courier for the latest tracking events now.', { reference: z.string() }, async ({ reference }) => run(async () => { requireScope(ctx, 'tracking:read'); return tracking.refresh(ctx, reference); }));
  server.tool('add_note', 'Add a note to an order\'s history (append-only, attributed to this connection).', { reference: z.string(), note: z.string() }, async ({ reference, note }) => run(async () => { requireWrite(ctx, 'orders:write', 'READ_ONLY'); await ordersSvc.note(ctx, reference, note); return { ok: true }; }));

  server.tool('list_problems', 'Open problems oldest first, with kind, description and suggested action.', { kind: z.string().optional(), page: z.number().optional() }, async ({ kind, page }) => run(async () => { requireScope(ctx, 'orders:read'); return tracking.listProblems(ctx, { kind, page, open: true }); }));
  server.tool('resolve_problem', 'Close a problem with a resolution note.', { problemId: z.string(), resolution: z.string() }, async ({ problemId, resolution }) => run(async () => { requireWrite(ctx, 'problems:write'); const r = await tracking.resolveProblem(ctx, problemId, resolution); if (!r) throw new AppError(404, 'not_found', 'problem'); return { order: trim(r) }; }));
  server.tool('suggest_problem_action', 'Get suggested steps for a problem (uses the account\'s AI budget).', { problemId: z.string() }, async ({ problemId }) => run(async () => { requireScope(ctx, 'orders:read'); return suggestProblemAction(ctx, problemId); }));

  server.tool('list_products', 'List products; incomplete=true lists those missing weight or dimensions.', { q: z.string().optional(), incomplete: z.boolean().optional(), page: z.number().optional() }, async (input) => run(async () => { requireScope(ctx, 'products:read'); const r = await products.list(ctx, { ...input, pageSize: 100 }); return { total: r.total, items: r.items.map((p) => ({ sku: p.stockCode, name: p.name, ean: p.ean, weightKg: p.weight, lengthCm: p.length, widthCm: p.width, heightCm: p.height, hsCode: p.hsCode, countryOfOrigin: p.countryOfOrigin, complete: p.complete, dataSource: p.dataSource, suggested: p.suggested })) }; }));
  server.tool('update_product', 'Set weight (kg), dimensions (cm) and customs data on one or many products by SKU. Changes are attributed to this connection; set confidence and sourceUrl when the values came from research.', {
    products: z.array(z.object({ sku: z.string(), name: z.string().optional(), weight: z.number().optional(), length: z.number().optional(), width: z.number().optional(), height: z.number().optional(), hsCode: z.string().optional(), countryOfOrigin: z.string().optional(), customsDescription: z.string().optional(), unitValue: z.number().optional(), ean: z.string().optional(), confidence: z.number().min(0).max(1).optional(), sourceUrl: z.string().optional() })).min(1).max(200),
    asSuggestion: z.boolean().optional().describe('true = store as a suggestion for a person to accept rather than applying directly'),
  }, async ({ products: items, asSuggestion }) => run(async () => {
    requireWrite(ctx, 'products:write');
    const results = [];
    for (const it of items) {
      if (asSuggestion) {
        const p = await products.getBySku(ctx, it.sku).catch(() => null) ?? (await products.upsert(ctx, { stockCode: it.sku, name: it.name })).product;
        await db.update(productsTable).set({ suggested: { weight: it.weight, length: it.length, width: it.width, height: it.height, confidence: it.confidence ?? 0.5, sourceUrl: it.sourceUrl, suggestedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(productsTable.id, p.id));
        await audit(ctx, { action: 'product.suggested', entityType: 'product', entityId: p.id, after: { weight: it.weight, length: it.length, width: it.width, height: it.height, confidence: it.confidence, sourceUrl: it.sourceUrl } });
        results.push({ sku: it.sku, suggested: true });
      } else {
        const { product, created } = await products.upsert(ctx, { stockCode: it.sku, name: it.name, weight: it.weight, length: it.length, width: it.width, height: it.height, hsCode: it.hsCode, countryOfOrigin: it.countryOfOrigin, customsDescription: it.customsDescription, unitValue: it.unitValue, ean: it.ean, dataSource: 'ai_suggested', dataConfidence: it.confidence, dataSourceUrl: it.sourceUrl });
        results.push({ sku: product.stockCode, created, complete: !!(product.weight && product.length && product.width && product.height) });
      }
    }
    return { results };
  }));

  server.tool('list_methods', 'The account\'s shipping methods with their current cost bands.', {}, async () => run(async () => { requireScope(ctx, 'methods:read'); return (await methods.list(ctx)).map((m) => ({ id: m.id, name: m.name, courier: m.courierName, serviceCode: m.serviceCode, destinations: m.destinationCountries, maxTransitDays: m.maxTransitDays, limits: { minKg: m.minWeightKg, maxKg: m.maxWeightKg, maxLengthCm: m.maxLengthCm }, active: m.active, currentBands: m.currentBands, surcharges: m.surcharges })); }));
  server.tool('update_method_bands', 'Replace a method\'s cost bands from a date (append-only history). Use after reconciling a courier invoice; give a note saying why.', { methodId: z.string(), bands: z.array(z.object({ minWeightKg: z.number(), maxWeightKg: z.number(), cost: z.number() })).min(1), effectiveFrom: z.string().optional(), note: z.string().optional() }, async ({ methodId, bands, effectiveFrom, note }) => run(async () => { requireWrite(ctx, 'methods:write', 'MANAGER'); return methods.setBands(ctx, methodId, bands, { effectiveFrom, note, source: 'invoice_reconciliation' }); }));
  server.tool('add_surcharge', 'Add a surcharge rule to a method (fuel, peak, remote area).', { methodId: z.string(), name: z.string(), kind: z.enum(['flat', 'percent']), amount: z.number(), postcodePrefixes: z.array(z.string()).optional(), always: z.boolean().optional() }, async ({ methodId, name, kind, amount, postcodePrefixes, always }) => run(async () => {
    requireWrite(ctx, 'methods:write', 'MANAGER');
    const m = await methods.get(ctx, methodId);
    return methods.update(ctx, methodId, { surcharges: [...m.surcharges, { name, kind, amount, when: { postcodePrefixes, always: always ?? !postcodePrefixes }, source: ctx.clientName ?? 'mcp' }] });
  }));

  server.tool('list_courier_profiles', 'Courier profiles available to this account (built-in, shared, own) with their credential fields and services.', {}, async () => run(async () => couriers.listProfiles(ctx)));
  server.tool('draft_courier_profile', 'Draft a courier profile from API documentation text or a URL (AI). Returns the draft to review; save it with save_courier_profile.', { name: z.string().optional(), documentation: z.string().optional(), url: z.string().optional() }, async (input) => run(async () => { requireWrite(ctx, 'couriers:write', 'MANAGER'); return draftProfileFromDocumentation(ctx, input); }));
  server.tool('save_courier_profile', 'Save a profile definition as the account\'s own courier profile.', { name: z.string(), definition: z.record(z.unknown()), credentialSchema: z.array(z.object({ key: z.string(), label: z.string(), secret: z.boolean().optional(), required: z.boolean().optional(), help: z.string().optional() })).optional(), services: z.array(z.record(z.unknown())).optional(), aiSuggested: z.boolean().optional() }, async (input) => run(async () => { requireWrite(ctx, 'couriers:write', 'MANAGER'); return couriers.createProfile(ctx, input as Parameters<CourierService['createProfile']>[1]); }));
  server.tool('test_courier_profile', 'Run one operation of a courier account against the courier (auth_test, create_shipment, get_label, track, void_shipment) and return the raw exchange.', { courierAccountId: z.string(), operation: z.enum(OPERATION_NAMES).default('auth_test'), sampleOrderReference: z.string().optional() }, async (input) => run(async () => { requireWrite(ctx, 'couriers:write', 'MANAGER'); return couriers.testOperation(ctx, input); }));

  server.tool('get_account_summary', 'Today\'s counts by status, open problems, labels and spend this week, incomplete products.', {}, async () => run(async () => { requireScope(ctx, 'orders:read'); return tracking.dashboard(ctx); }));
}
