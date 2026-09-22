/**
 * The label pipeline: parcels → method selection → courier call → documents → order update.
 * Reliability rules (spec section 15): the courier reference and raw reply are persisted
 * before the label is fetched, so a crash between the two never buys twice; unreadable
 * replies become a problem for a person, never a retry.
 */
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { accounts, courierAccounts, courierProfiles, documents, orderLines, orders, parcels, products, shipments, warehouses, type SelectionRow } from '../../db/schema/index.js';
import { audit } from '../../shared/audit.js';
import type { Ctx } from '../../shared/context.js';
import { ConflictError, CourierRejectedError, NoMethodError, NotFoundError, SubscriptionBlockedError, ValidationError } from '../../shared/errors.js';
import { emitOrderEvent, onOrderEvent } from '../../shared/events.js';
import { needsCustoms } from '../../shared/countries.js';
import { ConnectorEngine, loadEngineAccount } from '../../couriers/engine.js';
import { parseDefinition, type ProfileDefinition } from '../../couriers/profile-schema.js';
import { getPath, renderString } from '../../couriers/template.js';
import { MethodsService } from '../methods/methods.service.js';
import { OrderService, registerLabelHook } from '../orders/order.service.js';
import { buildShipmentContext } from './context.js';
import { selectMethod, type Ranked, type SelectionInput } from './selection.js';
import { combinePdfs, readDocument, renderCustomsInvoice, renderLabelOnStationery, renderPackingNote, saveDocument, type Stationery } from './documents.js';

type OrderRow = typeof orders.$inferSelect;
type ParcelRow = typeof parcels.$inferSelect;
type WarehouseRow = typeof warehouses.$inferSelect;
const num = (v: string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

export class LabelService {
  private db = getDb();
  private methods = new MethodsService();
  private orders = new OrderService();

  /** Parcels for an order: given ones, else an estimate from products (spec section 6). */
  async ensureParcels(ctx: Ctx, order: OrderRow): Promise<ParcelRow[]> {
    const existing = await this.db.select().from(parcels).where(eq(parcels.orderId, order.id)).orderBy(asc(parcels.sequence));
    if (existing.length) return existing;
    const lines = await this.db.select({ line: orderLines, product: products }).from(orderLines).leftJoin(products, eq(products.id, orderLines.productId)).where(eq(orderLines.orderId, order.id));
    if (!lines.length) throw new ValidationError('Order has no lines and no parcels');
    const [acct] = await this.db.select({ settings: accounts.settings }).from(accounts).where(eq(accounts.id, ctx.accountId)).limit(1);
    const allowance = acct?.settings.packagingAllowanceKg ?? 0.05;
    let weight = allowance;
    let maxL = 0, maxW = 0, maxH = 0;
    for (const { line, product } of lines) {
      const w = num(line.weight) || num(product?.weight);
      const l = num(line.length) || num(product?.length);
      const wd = num(line.width) || num(product?.width);
      const h = num(line.height) || num(product?.height);
      if (!w || !l || !wd || !h) throw new ValidationError(`Product ${line.sku} has no weight or dimensions`);
      weight += w * line.quantity;
      maxL = Math.max(maxL, l); maxW = Math.max(maxW, wd);
      // Stack items: height grows with quantity for multi-unit orders.
      maxH = lines.length === 1 && line.quantity === 1 ? Math.max(maxH, h) : Math.max(maxH, h) + (line.quantity - 1) * h;
    }
    if (lines.length > 1) maxH = Math.max(maxH, lines.reduce((s, { line, product }) => s + (num(line.height) || num(product?.height)) * line.quantity, 0));
    const [p] = await this.db.insert(parcels).values({ orderId: order.id, sequence: 1, weight: weight.toFixed(3), length: maxL.toFixed(1), width: maxW.toFixed(1), height: Math.min(maxH, 200).toFixed(1), contents: lines.map(({ line }) => ({ sku: line.sku, quantity: line.quantity })), estimated: true }).returning();
    return [p!];
  }

  private selectionInput(order: OrderRow, warehouse: WarehouseRow, pcls: ParcelRow[], laneDefaultMethodId: string | null): SelectionInput {
    return {
      originCountry: warehouse.country ?? 'GB', destinationCountry: order.country ?? 'GB', postCode: order.postCode,
      parcels: pcls.map((p) => ({ weightKg: num(p.weight), lengthCm: num(p.length), widthCm: num(p.width), heightCm: num(p.height) })),
      promise: order.deliveryPromise, deliverBy: order.deliverBy, shippingDate: new Date(),
      flags: { signature: order.signature, fragile: order.fragile, liquid: order.liquid, batteries: order.batteries },
      declaredValue: num(order.declaredValue), requestedMethod: order.requestedMethod, requestedCourier: order.requestedCourier,
      allowedMethodIds: warehouse.allowedMethodIds, laneDefaultMethodId,
    };
  }

  /** Rank methods for an order and persist the explanation on it. */
  async select(ctx: Ctx, order: OrderRow, warehouse: WarehouseRow, pcls: ParcelRow[]) {
    const methods = await this.methods.selectable(ctx);
    const lane = order.requestedMethod || order.requestedCourier ? null : await this.methods.laneDefault(warehouse.id, order.country ?? 'GB');
    const result = selectMethod(methods, this.selectionInput(order, warehouse, pcls, lane));
    const selection: SelectionRow = { chosenMethodId: result.chosen?.methodId ?? null, reason: result.reason, ranked: result.ranked.map(({ parcelCosts, ...r }) => r), dropped: result.dropped, selectedAt: new Date().toISOString() };
    await this.db.update(orders).set({ selection, updatedAt: new Date() }).where(eq(orders.id, order.id));
    return { ...result, methods };
  }

  /** Quote without an order. */
  async quote(ctx: Ctx, input: { warehouse?: string; country: string; postCode?: string | null; parcels: SelectionInput['parcels']; promise?: SelectionInput['promise']; deliverBy?: string | null; flags?: Partial<SelectionInput['flags']>; declaredValue?: number }) {
    const wh = await this.orders.resolveWarehouse(ctx, input.warehouse);
    const methods = await this.methods.selectable(ctx);
    const lane = await this.methods.laneDefault(wh.id, input.country);
    return selectMethod(methods, {
      originCountry: wh.country ?? 'GB', destinationCountry: input.country, postCode: input.postCode ?? null, parcels: input.parcels, promise: input.promise ?? 'standard', deliverBy: input.deliverBy ?? null,
      flags: { signature: false, fragile: false, liquid: false, batteries: false, ...(input.flags ?? {}) }, declaredValue: input.declaredValue ?? 0, allowedMethodIds: wh.allowedMethodIds, laneDefaultMethodId: lane,
    });
  }

  private async assertCanBuy(ctx: Ctx) {
    const [a] = await this.db.select({ status: accounts.status, billingMode: accounts.billingMode }).from(accounts).where(eq(accounts.id, ctx.accountId)).limit(1);
    if (!a) throw new NotFoundError('account');
    if (a.status === 'ARREARS' || a.status === 'SUSPENDED' || a.status === 'CLOSED') throw new SubscriptionBlockedError();
  }

  /** Buy the label for an order. Called by the order service after pre-flight passes. */
  async buy(ctx: Ctx, orderId: string, opts: { kind?: 'outbound' | 'return' } = {}) {
    await this.assertCanBuy(ctx);
    const order = await this.orders.rawGet(ctx, orderId);
    const [warehouse] = await this.db.select().from(warehouses).where(eq(warehouses.id, order.warehouseId)).limit(1);
    if (!warehouse) throw new NotFoundError('warehouse');
    const pcls = await this.ensureParcels(ctx, order);
    const { chosen, methods, dropped } = await this.select(ctx, order, warehouse, pcls);
    if (!chosen) {
      await this.orders.openProblem(ctx, order.id, 'no_method', `No shipping method fits: ${dropped.slice(0, 5).map((d) => `${d.name} (${d.reason})`).join('; ')}`, 'Add a method, split the parcel or change the delivery promise');
      throw new NoMethodError(order.orderNumber, dropped.map(({ name, reason }) => ({ name, reason })));
    }
    const method = methods.find((m) => m.id === chosen.methodId)!;
    return this.purchase(ctx, order, warehouse, pcls, { id: method.id, serviceCode: method.serviceCode, name: method.name, courierAccountId: method.courierAccountId, cost: chosen.cost, chargeableKg: chosen.chargeableKg }, opts.kind ?? 'outbound');
  }

  private async purchase(ctx: Ctx, order: OrderRow, warehouse: WarehouseRow, pcls: ParcelRow[], method: { id: string; serviceCode: string; name: string; courierAccountId: string; cost: number; chargeableKg: number }, kind: 'outbound' | 'return') {
    const [ca] = await this.db.select().from(courierAccounts).where(and(eq(courierAccounts.id, method.courierAccountId), eq(courierAccounts.accountId, ctx.accountId))).limit(1);
    if (!ca) throw new NotFoundError('courier account');
    const [profile] = await this.db.select().from(courierProfiles).where(eq(courierProfiles.id, ca.profileId)).limit(1);
    if (!profile) throw new NotFoundError('courier profile');
    const def = parseDefinition(profile.definition);
    const engine = new ConnectorEngine(def, await loadEngineAccount(ca));

    const previous = await this.db.select().from(shipments).where(and(eq(shipments.orderId, order.id), eq(shipments.kind, kind))).orderBy(desc(shipments.attempt)).limit(1);
    const attempt = (previous[0]?.attempt ?? 0) + 1;
    const reference = attempt === 1 && kind === 'outbound' ? order.orderNumber : `${order.orderNumber}-${kind === 'return' ? 'R' : ''}${attempt}`;
    const idempotencyKey = `${order.id}:${kind}:${attempt}`;

    const [shipment] = await this.db.insert(shipments).values({
      accountId: ctx.accountId, orderId: order.id, kind, attempt, courierAccountId: ca.id, profileId: profile.id, profileVersion: profile.version,
      methodId: method.id, methodName: method.name, courierName: ca.name, serviceCode: method.serviceCode, status: 'PENDING', cost: method.cost.toFixed(2), chargeableKg: method.chargeableKg.toFixed(3), idempotencyKey,
    }).returning();

    const lines = await this.db.select().from(orderLines).where(eq(orderLines.orderId, order.id)).orderBy(asc(orderLines.sortOrder));
    // A return label swaps sender and recipient.
    const ctxOrder = kind === 'return' ? swapForReturn(order, warehouse) : order;
    const ctxWarehouse = kind === 'return' ? warehouseFromOrder(order, warehouse) : warehouse;
    const context = buildShipmentContext({ order: ctxOrder, lines, parcels: pcls, warehouse: ctxWarehouse, method: { id: method.id, serviceCode: method.serviceCode, name: method.name }, shipment: { id: shipment!.id, reference, attempt, courierReference: '', trackingNumber: '' }, def });

    const opName = kind === 'return' && def.operations.create_return ? 'create_return' : 'create_shipment';
    const res = await engine.run(opName, context);
    const op = def.operations[opName]!;
    const map = op.response;
    const courierReference = res.ok ? String(getPath(res.body, map.courierReference) ?? '') : '';
    const trackingNumber = res.ok ? String(getPath(res.body, map.trackingNumber) ?? '') : '';

    // Persist the outcome before touching the label, whatever happened.
    await this.db.update(shipments).set({
      status: res.ok && courierReference ? 'CREATED' : 'FAILED', courierReference: courierReference || null, trackingNumber: trackingNumber || null,
      courierCost: map.cost ? String(getPath(res.body, map.cost) ?? '') || null : null, errorMessage: res.ok ? (courierReference ? null : 'Courier reply had no shipment reference') : res.message ?? `HTTP ${res.status}`,
      requestPayload: res.request, responsePayload: typeof res.body === 'object' ? stripBase64(res.body) : res.text.slice(0, 20_000), updatedAt: new Date(),
    }).where(eq(shipments.id, shipment!.id));

    if (!res.ok || !courierReference) {
      const message = res.message ?? (res.ok ? 'Courier reply had no shipment reference' : `HTTP ${res.status}`);
      const retryable = res.ok ? false : engine.isRetryable(res);
      await this.orders.openProblem(ctx, order.id, res.ok ? 'label_failed' : 'courier_error', `${ca.name} rejected the label: ${message}`, retryable ? 'The courier was unavailable; try again shortly' : 'Read the courier message, correct the order or method, then try again');
      await audit(ctx, { action: 'shipment.failed', entityType: 'order', entityId: order.id, after: { shipmentId: shipment!.id, courier: ca.name, message, status: res.status } });
      throw new CourierRejectedError(`${ca.name}: ${message}`, retryable, { shipmentId: shipment!.id, courierStatus: res.status });
    }

    // Tracking URL.
    const trackingUrl = map.trackingUrl ? String(getPath(res.body, map.trackingUrl) ?? '') : def.trackingUrlTemplate ? String(renderString(def.trackingUrlTemplate, { ...context, shipment: { ...(context.shipment as object), courierReference, trackingNumber } }) ?? '') : '';
    await this.db.update(shipments).set({ trackingUrl: trackingUrl || null }).where(eq(shipments.id, shipment!.id));

    // Label bytes.
    let labelBytes: Uint8Array | null = null;
    let labelFormat: 'pdf' | 'png' | 'zpl' = def.label.format;
    const inline = map.labelBase64 ? getPath(res.body, map.labelBase64) : null;
    if (typeof inline === 'string' && inline.length > 100) labelBytes = Buffer.from(inline, 'base64');
    else if (def.label.source === 'url' || map.labelUrl) {
      const url = map.labelUrl ? String(getPath(res.body, map.labelUrl) ?? '') : def.label.urlTemplate ? String(renderString(def.label.urlTemplate, { ...context, shipment: { ...(context.shipment as object), courierReference, trackingNumber } })) : '';
      if (url) { const r = await fetch(url); if (r.ok) labelBytes = Buffer.from(await r.arrayBuffer()); }
    }
    if (!labelBytes && def.operations.get_label) {
      const lr = await engine.run('get_label', { ...context, shipment: { ...(context.shipment as object), courierReference, trackingNumber } });
      if (lr.ok) {
        const b = lr.body as { base64?: string; contentType?: string } | string | null;
        if (b && typeof b === 'object' && typeof b.base64 === 'string') { labelBytes = Buffer.from(b.base64, 'base64'); if (b.contentType?.includes('png')) labelFormat = 'png'; }
        else if (def.label.base64Path) { const v = getPath(lr.body, def.label.base64Path); if (typeof v === 'string') labelBytes = Buffer.from(v, 'base64'); }
        else if (typeof b === 'string' && b.startsWith('JVBERi')) labelBytes = Buffer.from(b, 'base64');
      }
    }
    if (!labelBytes) {
      await this.orders.openProblem(ctx, order.id, 'label_failed', `${ca.name} created shipment ${courierReference} but no label could be retrieved`, 'Press Reprint to fetch the label again, or void and re-label');
      throw new CourierRejectedError(`${ca.name} created the shipment but returned no label`, false, { shipmentId: shipment!.id });
    }
    if (labelFormat === 'pdf' && !Buffer.from(labelBytes.subarray(0, 5)).toString('latin1').startsWith('%PDF')) {
      // Some couriers return base64 of a PDF inside JSON with a data: prefix.
      const text = Buffer.from(labelBytes).toString('latin1');
      if (text.startsWith('JVBERi')) labelBytes = Buffer.from(text, 'base64');
      else if (text.startsWith('\x89PNG')) labelFormat = 'png';
    }

    // Documents on stationery.
    const [acct] = await this.db.select().from(accounts).where(eq(accounts.id, ctx.accountId)).limit(1);
    const stationery = (warehouse.stationery ?? acct!.stationery) as Stationery;
    const docsToCreate: { kind: 'label' | 'return_label' | 'packing_note' | 'customs_invoice'; bytes: Uint8Array; pages: number }[] = [];
    if (labelFormat === 'zpl') {
      docsToCreate.push({ kind: kind === 'return' ? 'return_label' : 'label', bytes: labelBytes, pages: 1 });
    } else {
      const rendered = await renderLabelOnStationery(labelBytes, labelFormat, stationery, acct!.settings.a4Label);
      docsToCreate.push({ kind: kind === 'return' ? 'return_label' : 'label', bytes: rendered.pdf, pages: rendered.pages });
    }
    if (kind === 'outbound' && warehouse.packingNote) {
      const note = await renderPackingNote({
        orderNumber: order.orderNumber, orderDate: order.orderDate,
        recipient: { name: order.contactName ?? '', company: order.company, lines: [order.line1, order.line2, order.city, order.region, order.postCode, order.country].filter((x): x is string => !!x) },
        sender: { name: warehouse.company ?? warehouse.name, lines: [warehouse.line1, warehouse.city, warehouse.postCode].filter((x): x is string => !!x) },
        lines: lines.map((l) => ({ sku: l.sku, name: l.name, quantity: l.quantity })), courier: ca.name, method: method.name, trackingNumber,
      }, stationery, acct!.settings.a4Label);
      docsToCreate.push({ kind: 'packing_note', bytes: note, pages: await countPages(note) });
    }
    if (kind === 'outbound' && order.country && needsCustoms(warehouse.country ?? 'GB', order.country)) {
      const inv = await renderCustomsInvoice({
        orderNumber: order.orderNumber, date: new Date().toISOString().slice(0, 10), incoterm: order.incoterm ?? 'DDU', currency: order.currencyCode,
        sender: { name: warehouse.company ?? warehouse.name, lines: [warehouse.line1, warehouse.line2, warehouse.city, warehouse.postCode, warehouse.country].filter((x): x is string => !!x), eori: warehouse.eori, vat: warehouse.vatNumber, ioss: warehouse.iossNumber },
        recipient: { name: order.contactName ?? '', lines: [order.company, order.line1, order.line2, order.city, order.region, order.postCode, order.country].filter((x): x is string => !!x), phone: order.phone, email: order.email },
        lines: lines.map((l) => ({ description: l.customsDescription ?? l.name, hsCode: l.hsCode, origin: l.countryOfOrigin, quantity: l.quantity, unitValue: num(l.unitValue), weightKg: num(l.weight) * l.quantity })),
        parcels: pcls.length, totalWeightKg: pcls.reduce((s, p) => s + num(p.weight), 0),
      });
      docsToCreate.push({ kind: 'customs_invoice', bytes: inv, pages: 1 });
    }
    for (const d of docsToCreate) {
      const saved = await saveDocument(ctx.accountId, d.bytes, labelFormat === 'zpl' && (d.kind === 'label' || d.kind === 'return_label') ? 'zpl' : 'pdf');
      const [doc] = await this.db.insert(documents).values({ accountId: ctx.accountId, orderId: order.id, shipmentId: shipment!.id, kind: d.kind, stationery, filePath: saved.filePath, pageCount: d.pages, bytes: saved.bytes }).returning();
      if ((d.kind === 'label' || d.kind === 'return_label') && pcls[0]) await this.db.update(parcels).set({ labelDocumentId: doc!.id, trackingNumber }).where(eq(parcels.id, pcls[0].id));
    }

    if (kind === 'outbound') {
      const [updated] = await this.db.update(orders).set({
        status: 'LABEL_GENERATED', problemReason: null, missing: [], shipmentId: shipment!.id, courierName: ca.name, methodName: method.name, cost: method.cost.toFixed(2),
        trackingNumber, trackingLink: trackingUrl || null, updatedAt: new Date(),
      }).where(eq(orders.id, order.id)).returning();
      await this.db.update(courierProfiles).set({ liveLabels: (profile.liveLabels ?? 0) + 1 }).where(eq(courierProfiles.id, profile.id));
      await audit(ctx, { action: 'shipment.created', entityType: 'order', entityId: order.id, after: { shipmentId: shipment!.id, courier: ca.name, method: method.name, cost: method.cost, trackingNumber, courierReference } });
      await emitOrderEvent(ctx, 'order.label_generated', updated!);
      await this.maybeAutoShare(profile);
    } else {
      await audit(ctx, { action: 'return.created', entityType: 'order', entityId: order.id, after: { shipmentId: shipment!.id, courier: ca.name, trackingNumber } });
    }
    return { shipmentId: shipment!.id, courierReference, trackingNumber, trackingUrl };
  }

  /** Own profiles that have produced live labels are submitted to the catalogue automatically (spec section 7). */
  private async maybeAutoShare(profile: typeof courierProfiles.$inferSelect) {
    if (profile.origin !== 'own' || profile.review !== 'draft' || profile.optOutSharing) return;
    if ((profile.liveLabels ?? 0) + 1 < 3) return;
    await this.db.update(courierProfiles).set({ review: 'submitted', updatedAt: new Date() }).where(and(eq(courierProfiles.id, profile.id), eq(courierProfiles.review, 'draft')));
  }

  /** Void the current shipment with the courier (where supported). */
  async voidCurrent(ctx: Ctx, order: OrderRow, note: string): Promise<{ voided: boolean; message: string }> {
    const [sh] = await this.db.select().from(shipments).where(and(eq(shipments.orderId, order.id), eq(shipments.status, 'CREATED'), eq(shipments.kind, 'outbound'))).orderBy(desc(shipments.attempt)).limit(1);
    if (!sh) return { voided: false, message: 'No live shipment' };
    if (order.shippedAt || ['SHIPPED', 'IN_TRANSIT', 'DELIVERED'].includes(order.status)) throw new ConflictError('The parcel has been scanned; contact the courier to cancel');
    const [ca] = await this.db.select().from(courierAccounts).where(eq(courierAccounts.id, sh.courierAccountId)).limit(1);
    const [profile] = await this.db.select().from(courierProfiles).where(eq(courierProfiles.id, sh.profileId)).limit(1);
    let voided = false;
    let message = 'This courier cannot void labels; discard the old label';
    if (ca && profile) {
      const def = parseDefinition(profile.definition);
      if (def.operations.void_shipment) {
        const engine = new ConnectorEngine(def, await loadEngineAccount(ca));
        const res = await engine.run('void_shipment', { shipment: { reference: order.orderNumber, courierReference: sh.courierReference, trackingNumber: sh.trackingNumber, attempt: sh.attempt }, order: { reference: order.orderNumber } });
        voided = res.ok;
        message = res.ok ? `Voided with ${ca.name}` : `${ca.name} refused to void: ${res.message}`;
      }
    }
    await this.db.update(shipments).set({ status: voided ? 'VOID' : 'VOID_FAILED', voidedAt: new Date(), voidNote: `${note}. ${message}`, updatedAt: new Date() }).where(eq(shipments.id, sh.id));
    await this.db.update(documents).set({ void: new Date() }).where(eq(documents.shipmentId, sh.id));
    await audit(ctx, { action: 'shipment.voided', entityType: 'order', entityId: order.id, after: { shipmentId: sh.id, voided, message, note } });
    return { voided, message };
  }

  /** Change method / re-label: void, then buy with the requested method. */
  async relabel(ctx: Ctx, idOrRef: string, method: string | undefined) {
    const order = await this.orders.rawGet(ctx, idOrRef);
    if (['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'].includes(order.status)) throw new ConflictError(`Order is ${order.status.toLowerCase().replace('_', ' ')}; the label cannot be changed`);
    const voidResult = await this.voidCurrent(ctx, order, 'Re-label requested');
    await this.db.update(orders).set({ status: 'NEW', shipmentId: null, trackingNumber: null, trackingLink: null, courierName: null, methodName: null, cost: null, requestedMethod: method ?? null, requestedCourier: null, updatedAt: new Date() }).where(eq(orders.id, order.id));
    await this.orders.preflight(ctx, order.id);
    const result = await this.buy(ctx, order.id);
    return { ...result, previous: voidResult };
  }

  async createReturnLabel(ctx: Ctx, idOrRef: string) {
    const order = await this.orders.rawGet(ctx, idOrRef);
    if (!['LABEL_GENERATED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED'].includes(order.status)) throw new ConflictError('Return labels are for orders that have shipped');
    await this.assertCanBuy(ctx);
    const [warehouse] = await this.db.select().from(warehouses).where(eq(warehouses.id, order.warehouseId)).limit(1);
    if (!warehouse) throw new NotFoundError('warehouse');
    const pcls = await this.ensureParcels(ctx, order);
    const methods = await this.methods.selectable(ctx);
    const result = selectMethod(methods, {
      originCountry: order.country ?? 'GB', destinationCountry: warehouse.country ?? 'GB', postCode: warehouse.postCode,
      parcels: pcls.map((p) => ({ weightKg: num(p.weight), lengthCm: num(p.length), widthCm: num(p.width), heightCm: num(p.height) })),
      promise: 'economy', flags: { signature: false, fragile: false, liquid: false, batteries: false }, declaredValue: 0,
    });
    const preferred = result.ranked.find((r) => methods.find((m) => m.id === r.methodId)?.returnsService) ?? result.chosen;
    if (!preferred) throw new NoMethodError(order.orderNumber, result.dropped.map(({ name, reason }) => ({ name, reason })));
    const m = methods.find((x) => x.id === preferred.methodId)!;
    return this.purchase(ctx, order, warehouse, pcls, { id: m.id, serviceCode: m.serviceCode, name: m.name, courierAccountId: m.courierAccountId, cost: preferred.cost, chargeableKg: preferred.chargeableKg }, 'return');
  }

  async documentBytes(ctx: Ctx, idOrRef: string, documentId: string) {
    const order = await this.orders.rawGet(ctx, idOrRef);
    const [doc] = await this.db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.orderId, order.id))).limit(1);
    if (!doc) throw new NotFoundError('document', documentId);
    return { doc, bytes: await readDocument(doc.filePath) };
  }

  /** Combined PDF of the order's live documents in print order: label, packing note, customs invoice. */
  async printSet(ctx: Ctx, idOrRef: string, kinds: ('label' | 'packing_note' | 'customs_invoice' | 'return_label')[]) {
    const order = await this.orders.rawGet(ctx, idOrRef);
    const docs = await this.db.select().from(documents).where(and(eq(documents.orderId, order.id), isNull(documents.void))).orderBy(desc(documents.createdAt));
    const order_ = ['label', 'packing_note', 'customs_invoice', 'return_label'] as const;
    const parts: Uint8Array[] = [];
    for (const k of order_) {
      if (!kinds.includes(k)) continue;
      const d = docs.find((x) => x.kind === k && x.filePath.endsWith('.pdf'));
      if (d) parts.push(await readDocument(d.filePath));
    }
    if (!parts.length) throw new NotFoundError('documents to print');
    await audit(ctx, { action: 'documents.printed', entityType: 'order', entityId: order.id, after: { kinds } });
    return combinePdfs(parts);
  }

  async batchPrint(ctx: Ctx, references: string[]) {
    const parts: Uint8Array[] = [];
    for (const ref of references) {
      try { parts.push(await this.printSet(ctx, ref, ['label', 'packing_note', 'customs_invoice'])); } catch { /* skip orders without documents */ }
    }
    if (!parts.length) throw new NotFoundError('documents to print');
    return combinePdfs(parts);
  }
}

async function countPages(bytes: Uint8Array): Promise<number> {
  const { pdfPageCount } = await import('./documents.js');
  return pdfPageCount(bytes);
}

function stripBase64(body: unknown): unknown {
  return JSON.parse(JSON.stringify(body, (_k, v) => (typeof v === 'string' && v.length > 2000 ? `<${v.length} chars>` : v)));
}

/** For a return: the customer becomes the sender and the warehouse the recipient. */
function swapForReturn(order: OrderRow, w: WarehouseRow): OrderRow {
  return { ...order, contactName: w.contactName ?? w.company ?? w.name, company: w.company ?? w.name, line1: w.line1, line2: w.line2, city: w.city, region: w.region, postCode: w.postCode, country: w.country, phone: w.phone, email: w.email, customerName: w.company ?? w.name, customerEmail: w.email, customerPhone: w.phone };
}
function warehouseFromOrder(order: OrderRow, w: WarehouseRow): WarehouseRow {
  return { ...w, name: order.contactName ?? '', contactName: order.contactName, company: order.company ?? order.contactName, line1: order.line1, line2: order.line2, city: order.city, region: order.region, postCode: order.postCode, country: order.country, phone: order.phone ?? order.customerPhone, email: order.email ?? order.customerEmail, eori: null, vatNumber: null, iossNumber: null };
}

/** Wire the pipeline into the order service and the event bus. */
export function installLabelPipeline(): void {
  const svc = new LabelService();
  registerLabelHook(async (ctx, orderId) => { await svc.buy(ctx, orderId); });
  onOrderEvent('order.edited_after_label', async (ctx, o) => {
    const order = await new OrderService().rawGet(ctx, o.id);
    await svc.voidCurrent(ctx, order, 'Order edited after label');
    await getDb().update(orders).set({ status: 'NEW', shipmentId: null, trackingNumber: null, trackingLink: null, courierName: null, methodName: null, cost: null, updatedAt: new Date() }).where(eq(orders.id, order.id));
  });
  onOrderEvent('order.void_requested', async (ctx, o) => {
    const order = await new OrderService().rawGet(ctx, o.id);
    await svc.voidCurrent(ctx, order, 'Order cancelled');
  });
}

export type { Ranked };
