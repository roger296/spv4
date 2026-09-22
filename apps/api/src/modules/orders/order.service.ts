import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { CreateOrderInput, MissingField } from '@spv4/shared-types';
import { getDb, type Tx } from '../../config/database.js';
import { orderLines, orders, parcels, problems, products, warehouses, shipments, documents, trackingEvents } from '../../db/schema/index.js';
import { addNote, audit, diff, historyFor, recordView } from '../../shared/audit.js';
import type { Ctx } from '../../shared/context.js';
import { ConflictError, NeedsInformationError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { toAlpha2 } from '../../shared/countries.js';
import { ProductsService } from '../products/products.service.js';
import { runPreflight } from './preflight.js';
import { emitOrderEvent } from '../../shared/events.js';

export type OrderRow = typeof orders.$inferSelect;
export type OrderStatus = OrderRow['status'];

const OPEN_STATUSES: OrderStatus[] = ['PROBLEM', 'NEW', 'UPDATE_PRODUCT', 'LABEL_GENERATED'];
const s = (v: number | null | undefined) => (v === undefined || v === null ? null : String(v));

export interface ListOptions {
  status?: OrderStatus[];
  q?: string;
  since?: string;
  problem?: string;
  country?: string;
  page?: number;
  pageSize?: number;
  all?: boolean;
}

/** Hook the label pipeline registers; keeps orders independent of couriers. */
export type LabelHook = (ctx: Ctx, orderId: string) => Promise<void>;
let labelHook: LabelHook | null = null;
export function registerLabelHook(fn: LabelHook) { labelHook = fn; }

export class OrderService {
  private db = getDb();
  private productsSvc = new ProductsService();

  async resolveWarehouse(ctx: Ctx, ref: string | undefined, tx?: Tx) {
    const db = tx ?? this.db;
    const rows = await db.select().from(warehouses).where(and(eq(warehouses.accountId, ctx.accountId), isNull(warehouses.deletedAt)));
    if (!rows.length) throw new ValidationError('The account has no warehouse; add one in Settings');
    if (!ref) return rows.find((w) => w.isDefault) ?? rows[0]!;
    const lower = ref.toLowerCase();
    const w = rows.find((x) => x.id === ref || x.externalRef?.toLowerCase() === lower || x.name.toLowerCase() === lower);
    if (!w) throw new ValidationError(`Unknown warehouse "${ref}"`, { known: rows.map((x) => x.name) });
    return w;
  }

  /** Create (or return the existing order for the same reference). */
  async create(ctx: Ctx, input: CreateOrderInput, source: OrderRow['source']) {
    const reference = input.reference.trim();
    if (!reference) throw new ValidationError('reference is required');
    const [existing] = await this.db.select().from(orders).where(and(eq(orders.accountId, ctx.accountId), eq(orders.orderNumber, reference), isNull(orders.deletedAt))).limit(1);
    if (existing) return { order: await this.get(ctx, existing.id), duplicate: true };

    const country = toAlpha2(input.deliveryAddress.country);
    if (!country) throw new ValidationError(`Unknown country "${input.deliveryAddress.country}"`);
    const promise = parsePromise(input.deliveryPromise);

    const order = await this.db.transaction(async (tx) => {
      const warehouse = await this.resolveWarehouse(ctx, input.warehouse, tx);
      const [row] = await tx.insert(orders).values({
        accountId: ctx.accountId,
        orderNumber: reference,
        source,
        warehouseId: warehouse.id,
        orderDate: input.orderDate ?? new Date().toISOString().slice(0, 10),
        customerName: input.customer?.name ?? input.deliveryAddress.contactName,
        customerEmail: input.customer?.email ?? input.deliveryAddress.email ?? null,
        customerPhone: input.customer?.phone ?? input.deliveryAddress.phone ?? null,
        contactName: input.deliveryAddress.contactName,
        company: input.deliveryAddress.company ?? null,
        line1: input.deliveryAddress.line1,
        line2: input.deliveryAddress.line2 ?? null,
        city: input.deliveryAddress.city,
        region: input.deliveryAddress.region ?? null,
        postCode: input.deliveryAddress.postCode,
        country,
        phone: input.deliveryAddress.phone ?? input.customer?.phone ?? null,
        email: input.deliveryAddress.email ?? input.customer?.email ?? null,
        deliveryPromise: promise.kind,
        deliverBy: promise.date,
        incoterm: input.customs?.incoterm ?? null,
        declaredValue: s(input.customs?.declaredValue),
        currencyCode: input.customs?.currency ?? 'GBP',
        signature: !!input.flags?.signature,
        fragile: !!input.flags?.fragile,
        liquid: !!input.flags?.liquid,
        batteries: !!input.flags?.batteries,
        requestedMethod: input.method ?? null,
        requestedCourier: input.courier ?? null,
        labelWanted: input.label !== false,
        metadata: input.metadata ?? {},
      }).returning();

      const lines = input.lines ?? [];
      if (lines.length) {
        // Product data supplied on a line fills gaps in the product record.
        for (const l of lines) {
          await this.productsSvc.fillGaps(ctx, l.sku, l.name, {
            weight: l.weight, length: l.dimensions?.length, width: l.dimensions?.width, height: l.dimensions?.height,
            hsCode: l.hsCode, countryOfOrigin: l.countryOfOrigin, customsDescription: l.customsDescription, unitValue: l.unitValue,
          }, tx);
        }
        const prods = await this.productsSvc.bySkus(ctx, lines.map((l) => l.sku), tx);
        const byId = new Map(prods.map((p) => [p.stockCode, p]));
        await tx.insert(orderLines).values(lines.map((l, i) => ({
          orderId: row!.id, productId: byId.get(l.sku)?.id ?? null, sku: l.sku, name: l.name ?? byId.get(l.sku)?.name ?? l.sku,
          quantity: Math.max(1, Math.round(l.quantity)), unitValue: s(l.unitValue), weight: s(l.weight),
          length: s(l.dimensions?.length), width: s(l.dimensions?.width), height: s(l.dimensions?.height),
          hsCode: l.hsCode ?? null, countryOfOrigin: l.countryOfOrigin ? toAlpha2(l.countryOfOrigin) : null, customsDescription: l.customsDescription ?? null, sortOrder: i,
        })));
      }
      if (input.parcels?.length) {
        await tx.insert(parcels).values(input.parcels.map((p, i) => ({
          orderId: row!.id, sequence: i + 1, weight: String(p.weight), length: String(p.length), width: String(p.width), height: String(p.height),
          contents: p.lines ?? [], estimated: false,
        })));
      }
      await audit(ctx, { action: 'order.created', entityType: 'order', entityId: row!.id, after: { reference, source, country, lines: lines.length } }, tx);
      return row!;
    });

    await this.preflight(ctx, order.id);
    const full = await this.get(ctx, order.id);
    return { order: full, duplicate: false };
  }

  /** Runs the pre-flight check and persists status + missing list. Returns the updated order. */
  async preflight(ctx: Ctx, idOrRef: string) {
    const order = await this.rawGet(ctx, idOrRef);
    const orderId = order.id;
    if (['LABEL_GENERATED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'].includes(order.status)) return order;
    const [lines, pcls, [warehouse]] = await Promise.all([
      this.db.select().from(orderLines).where(eq(orderLines.orderId, orderId)).orderBy(asc(orderLines.sortOrder)),
      this.db.select().from(parcels).where(eq(parcels.orderId, orderId)).orderBy(asc(parcels.sequence)),
      this.db.select().from(warehouses).where(eq(warehouses.id, order.warehouseId)).limit(1),
    ]);
    const prods = await this.productsSvc.bySkus(ctx, lines.map((l) => l.sku));
    const result = runPreflight({ order, lines, parcels: pcls, products: prods, warehouse: warehouse! });

    const before = { status: order.status, problemReason: order.problemReason };
    const [updated] = await this.db.update(orders).set({ status: result.status, problemReason: result.problemReason, missing: result.missing, updatedAt: new Date() }).where(eq(orders.id, orderId)).returning();

    // Keep the problem record in step with the pre-flight outcome.
    const open = await this.db.select().from(problems).where(and(eq(problems.orderId, orderId), isNull(problems.resolvedAt), inArray(problems.kind, ['address_failed', 'customs_incomplete'])));
    if (result.status === 'PROBLEM' && result.problemReason) {
      const same = open.find((p) => p.kind === result.problemReason);
      if (!same) await this.db.insert(problems).values({ accountId: ctx.accountId, orderId, kind: result.problemReason, description: result.problemDescription ?? result.problemReason, suggestedAction: result.problemReason === 'address_failed' ? 'Correct the delivery address on the order' : 'Supply the missing customs fields' });
      for (const p of open.filter((p) => p.kind !== result.problemReason)) await this.db.update(problems).set({ resolvedAt: new Date(), resolution: 'Superseded by pre-flight', resolvedBy: 'system' }).where(eq(problems.id, p.id));
    } else {
      for (const p of open) await this.db.update(problems).set({ resolvedAt: new Date(), resolution: 'Resolved by pre-flight', resolvedBy: 'system' }).where(eq(problems.id, p.id));
    }
    if (before.status !== updated!.status) {
      await audit(ctx, { action: 'order.status', entityType: 'order', entityId: orderId, before, after: { status: updated!.status, problemReason: updated!.problemReason } });
      if (updated!.status === 'PROBLEM') await emitOrderEvent(ctx, 'order.problem', updated!);
    }
    return updated!;
  }

  /** Ask for the label: pre-flight, then hand to the label pipeline (registered by the labels module). */
  async requestLabel(ctx: Ctx, idOrRef: string, opts: { method?: string; courier?: string } = {}) {
    const order = await this.rawGet(ctx, idOrRef);
    const orderId = order.id;
    if (order.status === 'CANCELLED') throw new ConflictError('Order is cancelled');
    if (['SHIPPED', 'IN_TRANSIT', 'DELIVERED'].includes(order.status)) throw new ConflictError(`Order is already ${order.status.toLowerCase().replace('_', ' ')}`);
    if (opts.method || opts.courier) await this.db.update(orders).set({ requestedMethod: opts.method ?? order.requestedMethod, requestedCourier: opts.courier ?? order.requestedCourier, updatedAt: new Date() }).where(eq(orders.id, orderId));
    const checked = await this.preflight(ctx, orderId);
    if (checked.status !== 'NEW' && checked.status !== 'LABEL_GENERATED') {
      throw new NeedsInformationError(checked.orderNumber, checked.missing as MissingField[], checked.status);
    }
    await this.db.update(orders).set({ labelWanted: true }).where(eq(orders.id, orderId));
    if (!labelHook) throw new ConflictError('Label purchase is not available in this build');
    await labelHook(ctx, orderId);
    return this.get(ctx, orderId);
  }

  async rawGet(ctx: Ctx, idOrRef: string, tx?: Tx): Promise<OrderRow> {
    const db = tx ?? this.db;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrRef);
    const [row] = await db.select().from(orders).where(and(eq(orders.accountId, ctx.accountId), isNull(orders.deletedAt), isUuid ? eq(orders.id, idOrRef) : eq(orders.orderNumber, idOrRef))).limit(1);
    if (!row) throw new NotFoundError('order', idOrRef);
    return row;
  }

  async get(ctx: Ctx, idOrRef: string, opts: { view?: boolean } = {}) {
    const order = await this.rawGet(ctx, idOrRef);
    const [lines, pcls, shps, docs, probs, events, [warehouse]] = await Promise.all([
      this.db.select().from(orderLines).where(eq(orderLines.orderId, order.id)).orderBy(asc(orderLines.sortOrder)),
      this.db.select().from(parcels).where(eq(parcels.orderId, order.id)).orderBy(asc(parcels.sequence)),
      this.db.select().from(shipments).where(eq(shipments.orderId, order.id)).orderBy(desc(shipments.createdAt)),
      this.db.select().from(documents).where(eq(documents.orderId, order.id)).orderBy(desc(documents.createdAt)),
      this.db.select().from(problems).where(eq(problems.orderId, order.id)).orderBy(desc(problems.openedAt)),
      this.db.select().from(trackingEvents).where(eq(trackingEvents.orderId, order.id)).orderBy(desc(trackingEvents.occurredAt)),
      this.db.select().from(warehouses).where(eq(warehouses.id, order.warehouseId)).limit(1),
    ]);
    if (opts.view) await recordView(ctx, 'order', order.id);
    return {
      ...order,
      warehouse: warehouse ? { id: warehouse.id, name: warehouse.name, externalRef: warehouse.externalRef, country: warehouse.country } : null,
      lines, parcels: pcls,
      shipments: shps.map(({ requestPayload, responsePayload, ...sh }) => sh),
      documents: docs.filter((d) => !d.void).map((d) => ({ id: d.id, kind: d.kind, stationery: d.stationery, pageCount: d.pageCount, createdAt: d.createdAt, parcelId: d.parcelId, url: `/v4/orders/${encodeURIComponent(order.orderNumber)}/documents/${d.id}` })),
      problems: probs,
      trackingEvents: events,
    };
  }

  async history(ctx: Ctx, idOrRef: string) {
    const order = await this.rawGet(ctx, idOrRef);
    return historyFor(ctx, 'order', order.id);
  }

  async list(ctx: Ctx, opts: ListOptions = {}) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
    const conds: SQL[] = [eq(orders.accountId, ctx.accountId), isNull(orders.deletedAt)];
    if (opts.status?.length) conds.push(inArray(orders.status, opts.status));
    else if (!opts.all) conds.push(inArray(orders.status, OPEN_STATUSES));
    if (opts.problem) conds.push(eq(orders.problemReason, opts.problem as OrderRow['problemReason'] & string));
    if (opts.country) conds.push(eq(orders.country, opts.country.toUpperCase()));
    if (opts.since) conds.push(sql`${orders.updatedAt} >= ${new Date(opts.since)}`);
    if (opts.q) {
      const raw = opts.q.trim();
      const compact = raw.replace(/[\s-]+/g, '');
      const like = `%${raw}%`;
      conds.push(or(
        ilike(orders.orderNumber, like), ilike(orders.contactName, like), ilike(orders.customerName, like), ilike(orders.email, like),
        sql`replace(replace(coalesce(${orders.postCode},''),' ',''),'-','') ilike ${'%' + compact + '%'}`,
        sql`replace(replace(coalesce(${orders.trackingNumber},''),' ',''),'-','') ilike ${'%' + compact + '%'}`,
        sql`replace(replace(${orders.orderNumber},' ',''),'-','') ilike ${'%' + compact + '%'}`,
        sql`exists (select 1 from ${orderLines} ol where ol.order_id = ${orders.id} and ol.sku ilike ${like})`,
      )!);
    }
    const where = and(...conds);
    // Problems first (oldest problem at the top), then the rest newest first.
    const [rows, countRows] = await Promise.all([
      this.db.select().from(orders).where(where)
        .orderBy(sql`case when ${orders.status} = 'PROBLEM' then 0 else 1 end`, sql`case when ${orders.status} = 'PROBLEM' then ${orders.updatedAt} end asc`, desc(orders.createdAt))
        .limit(pageSize).offset((page - 1) * pageSize),
      this.db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where),
    ]);
    return { items: rows.map(({ metadata, selection, ...r }) => r), page, pageSize, total: countRows[0]?.count ?? 0 };
  }

  async counts(ctx: Ctx) {
    const rows = await this.db.select({ status: orders.status, count: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.accountId, ctx.accountId), isNull(orders.deletedAt))).groupBy(orders.status);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r.count;
    return out;
  }

  async update(ctx: Ctx, idOrRef: string, patch: Partial<CreateOrderInput> & { customerName?: string }) {
    const order = await this.rawGet(ctx, idOrRef);
    if (['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'].includes(order.status)) throw new ConflictError(`Order is ${order.status.toLowerCase().replace('_', ' ')} and cannot be edited`);
    const set: Partial<typeof orders.$inferInsert> = { updatedAt: new Date() };
    if (patch.deliveryAddress) {
      const a = patch.deliveryAddress;
      const country = a.country ? toAlpha2(a.country) : order.country;
      if (a.country && !country) throw new ValidationError(`Unknown country "${a.country}"`);
      Object.assign(set, { contactName: a.contactName, company: a.company ?? null, line1: a.line1, line2: a.line2 ?? null, city: a.city, region: a.region ?? null, postCode: a.postCode, country, phone: a.phone ?? order.phone, email: a.email ?? order.email });
    }
    if (patch.customer) Object.assign(set, { customerName: patch.customer.name ?? order.customerName, customerEmail: patch.customer.email ?? order.customerEmail, customerPhone: patch.customer.phone ?? order.customerPhone });
    if (patch.deliveryPromise !== undefined) { const p = parsePromise(patch.deliveryPromise); set.deliveryPromise = p.kind; set.deliverBy = p.date; }
    if (patch.customs) Object.assign(set, { incoterm: patch.customs.incoterm ?? order.incoterm, declaredValue: s(patch.customs.declaredValue) ?? order.declaredValue, currencyCode: patch.customs.currency ?? order.currencyCode });
    if (patch.flags) Object.assign(set, { signature: patch.flags.signature ?? order.signature, fragile: patch.flags.fragile ?? order.fragile, liquid: patch.flags.liquid ?? order.liquid, batteries: patch.flags.batteries ?? order.batteries });
    if (patch.method !== undefined) set.requestedMethod = patch.method;
    if (patch.courier !== undefined) set.requestedCourier = patch.courier;
    if (patch.warehouse) set.warehouseId = (await this.resolveWarehouse(ctx, patch.warehouse)).id;
    if (patch.metadata) set.metadata = { ...order.metadata, ...patch.metadata };

    await this.db.transaction(async (tx) => {
      await tx.update(orders).set(set).where(eq(orders.id, order.id));
      if (patch.lines) {
        await tx.delete(orderLines).where(eq(orderLines.orderId, order.id));
        const prods = await this.productsSvc.bySkus(ctx, patch.lines.map((l) => l.sku), tx);
        const byId = new Map(prods.map((p) => [p.stockCode, p]));
        if (patch.lines.length) await tx.insert(orderLines).values(patch.lines.map((l, i) => ({
          orderId: order.id, productId: byId.get(l.sku)?.id ?? null, sku: l.sku, name: l.name ?? byId.get(l.sku)?.name ?? l.sku, quantity: Math.max(1, Math.round(l.quantity)),
          unitValue: s(l.unitValue), weight: s(l.weight), length: s(l.dimensions?.length), width: s(l.dimensions?.width), height: s(l.dimensions?.height),
          hsCode: l.hsCode ?? null, countryOfOrigin: l.countryOfOrigin ? toAlpha2(l.countryOfOrigin) : null, customsDescription: l.customsDescription ?? null, sortOrder: i,
        })));
      }
      if (patch.parcels) await this.replaceParcels(ctx, order.id, patch.parcels, tx);
      const d = diff(order as Record<string, unknown>, { ...order, ...set } as Record<string, unknown>);
      await audit(ctx, { action: 'order.updated', entityType: 'order', entityId: order.id, before: d.before, after: { ...d.after, lines: patch.lines ? patch.lines.length : undefined, parcels: patch.parcels ? patch.parcels.length : undefined } }, tx);
    });
    // Editing a labelled order voids it: the label module listens for this.
    if (order.status === 'LABEL_GENERATED') await emitOrderEvent(ctx, 'order.edited_after_label', order);
    await this.preflight(ctx, order.id);
    return this.get(ctx, order.id);
  }

  async replaceParcels(ctx: Ctx, orderId: string, input: { weight: number; length: number; width: number; height: number; lines?: { sku: string; quantity: number }[] }[], tx?: Tx) {
    const db = tx ?? this.db;
    await db.delete(parcels).where(eq(parcels.orderId, orderId));
    if (input.length) await db.insert(parcels).values(input.map((p, i) => ({ orderId, sequence: i + 1, weight: String(p.weight), length: String(p.length), width: String(p.width), height: String(p.height), contents: p.lines ?? [], estimated: false })));
    await audit(ctx, { action: 'order.parcels_set', entityType: 'order', entityId: orderId, after: { parcels: input } }, db);
  }

  async setParcels(ctx: Ctx, idOrRef: string, input: Parameters<OrderService['replaceParcels']>[2]) {
    const order = await this.rawGet(ctx, idOrRef);
    if (['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'].includes(order.status)) throw new ConflictError(`Order is ${order.status.toLowerCase()} and cannot be edited`);
    await this.replaceParcels(ctx, order.id, input);
    if (order.status === 'LABEL_GENERATED') await emitOrderEvent(ctx, 'order.edited_after_label', order);
    await this.preflight(ctx, order.id);
    return this.get(ctx, order.id);
  }

  async cancel(ctx: Ctx, idOrRef: string, reason?: string) {
    const order = await this.rawGet(ctx, idOrRef);
    if (['SHIPPED', 'IN_TRANSIT', 'DELIVERED'].includes(order.status)) throw new ConflictError('A shipped order cannot be cancelled; contact the courier');
    if (order.status === 'CANCELLED') return this.get(ctx, order.id);
    if (order.status === 'LABEL_GENERATED') await emitOrderEvent(ctx, 'order.void_requested', order);
    await this.db.update(orders).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(orders.id, order.id));
    await this.db.update(problems).set({ resolvedAt: new Date(), resolution: 'Order cancelled', resolvedBy: ctx.actorName ?? 'system' }).where(and(eq(problems.orderId, order.id), isNull(problems.resolvedAt)));
    await audit(ctx, { action: 'order.cancelled', entityType: 'order', entityId: order.id, before: { status: order.status }, after: { status: 'CANCELLED', reason } });
    await emitOrderEvent(ctx, 'order.cancelled', { ...order, status: 'CANCELLED' });
    return this.get(ctx, order.id);
  }

  async markShipped(ctx: Ctx, idOrRef: string) {
    const order = await this.rawGet(ctx, idOrRef);
    if (order.status !== 'LABEL_GENERATED' && !(order.status === 'PROBLEM' && order.problemReason === 'no_scan')) throw new ConflictError('Only an order with a label can be marked shipped');
    await this.db.update(orders).set({ status: 'SHIPPED', problemReason: null, shippedAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, order.id));
    await this.db.update(problems).set({ resolvedAt: new Date(), resolution: 'Marked shipped by hand', resolvedBy: ctx.actorName ?? 'system' }).where(and(eq(problems.orderId, order.id), isNull(problems.resolvedAt), eq(problems.kind, 'no_scan')));
    await audit(ctx, { action: 'order.marked_shipped', entityType: 'order', entityId: order.id, before: { status: order.status }, after: { status: 'SHIPPED' } });
    await emitOrderEvent(ctx, 'order.shipped', { ...order, status: 'SHIPPED' });
    return this.get(ctx, order.id);
  }

  async note(ctx: Ctx, idOrRef: string, text: string) {
    const order = await this.rawGet(ctx, idOrRef);
    if (!text.trim()) throw new ValidationError('Note is empty');
    await addNote(ctx, 'order', order.id, text.trim());
  }

  async resolveProblem(ctx: Ctx, idOrRef: string, problemId: string, resolution: string) {
    const order = await this.rawGet(ctx, idOrRef);
    const [p] = await this.db.select().from(problems).where(and(eq(problems.id, problemId), eq(problems.orderId, order.id))).limit(1);
    if (!p) throw new NotFoundError('problem', problemId);
    await this.db.update(problems).set({ resolvedAt: new Date(), resolution, resolvedBy: ctx.actorName ?? ctx.actorKind }).where(eq(problems.id, problemId));
    await audit(ctx, { action: 'problem.resolved', entityType: 'order', entityId: order.id, after: { problemId, kind: p.kind, resolution } });
    const stillOpen = await this.db.select({ id: problems.id }).from(problems).where(and(eq(problems.orderId, order.id), isNull(problems.resolvedAt)));
    if (!stillOpen.length && order.status === 'PROBLEM') {
      // Back to the state the shipment is really in.
      const next: OrderStatus = order.trackingNumber ? (order.shippedAt ? 'IN_TRANSIT' : 'LABEL_GENERATED') : 'NEW';
      await this.db.update(orders).set({ status: next, problemReason: null, updatedAt: new Date() }).where(eq(orders.id, order.id));
      if (next === 'NEW') await this.preflight(ctx, order.id);
    }
    return this.get(ctx, order.id);
  }

  async openProblem(ctx: Ctx, orderId: string, kind: typeof problems.$inferInsert['kind'], description: string, suggestedAction?: string) {
    const [existing] = await this.db.select().from(problems).where(and(eq(problems.orderId, orderId), eq(problems.kind, kind), isNull(problems.resolvedAt))).limit(1);
    if (existing) return existing;
    const [p] = await this.db.insert(problems).values({ accountId: ctx.accountId, orderId, kind, description, suggestedAction: suggestedAction ?? null }).returning();
    const [order] = await this.db.update(orders).set({ status: 'PROBLEM', problemReason: kind, updatedAt: new Date() }).where(eq(orders.id, orderId)).returning();
    await audit(ctx, { action: 'problem.opened', entityType: 'order', entityId: orderId, after: { kind, description } });
    if (order) await emitOrderEvent(ctx, 'order.problem', order);
    return p!;
  }
}

function parsePromise(v: string | undefined): { kind: 'economy' | 'standard' | 'express' | 'next_day' | 'date'; date: string | null } {
  if (!v) return { kind: 'standard', date: null };
  const lower = v.toLowerCase().replace(/[\s-]/g, '_');
  if (['economy', 'standard', 'express', 'next_day'].includes(lower)) return { kind: lower as 'economy', date: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { kind: 'date', date: v };
  throw new ValidationError(`deliveryPromise must be economy, standard, express, next_day or a YYYY-MM-DD date (got "${v}")`);
}

export { products as _productsTable };
