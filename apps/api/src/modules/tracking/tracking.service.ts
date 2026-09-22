/**
 * Tracking (spec section 10): poll each courier profile's `track` operation for live
 * shipments, store events, move the order's status, and apply exception rules that open
 * problems early (no scan, stalled, late, delivery failed, held, returning, damaged/lost).
 */
import { and, desc, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { accounts, courierAccounts, courierProfiles, orders, problems, shipments, shippingMethods, trackingEvents, unmappedStatuses, warehouses } from '../../db/schema/index.js';
import { audit } from '../../shared/audit.js';
import { systemCtx, type Ctx } from '../../shared/context.js';
import { emitOrderEvent } from '../../shared/events.js';
import { ConnectorEngine, loadEngineAccount } from '../../couriers/engine.js';
import { parseDefinition } from '../../couriers/profile-schema.js';
import { getPath } from '../../couriers/template.js';
import { OrderService } from '../orders/order.service.js';
import { workingDaysBetween } from '../labels/selection.js';
import { createHash } from 'node:crypto';

type ShipmentRow = typeof shipments.$inferSelect;
type OrderStatus = typeof orders.$inferSelect['status'];

const LIVE_ORDER_STATUSES: OrderStatus[] = ['LABEL_GENERATED', 'SHIPPED', 'IN_TRANSIT', 'PROBLEM'];
const RANK: Record<string, number> = { LABEL_GENERATED: 0, SHIPPED: 1, IN_TRANSIT: 2, DELIVERED: 3 };

export interface PollOutcome { shipmentId: string; events: number; status: OrderStatus | null; problem?: string | null; error?: string }

export class TrackingService {
  private db = getDb();
  private orders = new OrderService();

  /** Shipments that still need polling: live outbound shipments on live orders, not older than 30 days. */
  async dueShipments(accountId?: string, limit = 500) {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    return this.db.select({ s: shipments, orderStatus: orders.status, orderNumber: orders.orderNumber })
      .from(shipments).innerJoin(orders, eq(orders.id, shipments.orderId))
      .where(and(
        eq(shipments.status, 'CREATED'), inArray(orders.status, LIVE_ORDER_STATUSES), isNull(orders.deletedAt), sql`${shipments.createdAt} > ${cutoff}`,
        accountId ? eq(shipments.accountId, accountId) : sql`true`,
        or(isNull(shipments.lastTrackedAt), lt(shipments.lastTrackedAt, new Date(Date.now() - 30 * 60_000))),
      )).orderBy(shipments.lastTrackedAt).limit(limit);
  }

  /** Poll one shipment. Returns what changed. */
  async poll(shipment: ShipmentRow, opts: { ctx?: Ctx } = {}): Promise<PollOutcome> {
    const ctx = opts.ctx ?? systemCtx(shipment.accountId, 'tracking');
    const [ca] = await this.db.select().from(courierAccounts).where(eq(courierAccounts.id, shipment.courierAccountId)).limit(1);
    const [profile] = await this.db.select().from(courierProfiles).where(eq(courierProfiles.id, shipment.profileId)).limit(1);
    if (!ca || !profile) return { shipmentId: shipment.id, events: 0, status: null, error: 'courier account or profile missing' };
    const def = parseDefinition(profile.definition);
    if (!def.operations.track) {
      await this.db.update(shipments).set({ lastTrackedAt: new Date() }).where(eq(shipments.id, shipment.id));
      return { shipmentId: shipment.id, events: 0, status: null, error: 'profile has no track operation' };
    }
    if (!shipment.trackingNumber) return { shipmentId: shipment.id, events: 0, status: null, error: 'no tracking number' };
    const engine = new ConnectorEngine(def, await loadEngineAccount(ca));
    const res = await engine.run('track', { shipment: { reference: shipment.idempotencyKey, courierReference: shipment.courierReference, trackingNumber: shipment.trackingNumber, attempt: shipment.attempt } });
    await this.db.update(shipments).set({ lastTrackedAt: new Date() }).where(eq(shipments.id, shipment.id));
    if (!res.ok) {
      // Tracking failures are not problems for the customer; note them for the health page only.
      return { shipmentId: shipment.id, events: 0, status: null, error: res.message ?? `HTTP ${res.status}` };
    }
    const map = def.operations.track.response;
    let root: unknown = res.body;
    if (map.batchItems) {
      const items = getPath(res.body, map.batchItems);
      root = Array.isArray(items) ? items.find((it) => String(getPath(it, map.batchKey ?? 'trackingNumber')) === shipment.trackingNumber) ?? null : null;
    }
    const rawEvents = getPath(root, map.events);
    const list = Array.isArray(rawEvents) ? rawEvents : [];
    return this.ingest(ctx, shipment, engine, list.map((e) => ({
      status: String(getPath(e, map.status) ?? ''),
      time: String(getPath(e, map.time) ?? ''),
      location: map.location ? (getPath(e, map.location) as string | undefined) ?? null : null,
      description: map.description ? (getPath(e, map.description) as string | undefined) ?? null : null,
      raw: e,
    })), profile.id);
  }

  /** Store new events and move the order. Shared by the poll and courier webhooks. */
  async ingest(ctx: Ctx, shipment: ShipmentRow, engine: ConnectorEngine, events: { status: string; time: string; location?: string | null; description?: string | null; raw?: unknown }[], profileId: string): Promise<PollOutcome> {
    const existing = await this.db.select({ dedupeKey: trackingEvents.dedupeKey }).from(trackingEvents).where(eq(trackingEvents.shipmentId, shipment.id));
    const seen = new Set(existing.map((e) => e.dedupeKey));
    let inserted = 0;
    let best: { rank: number; status: OrderStatus; problem: string | null; at: Date } | null = null;
    let latestAt: Date | null = null;
    for (const e of events) {
      if (!e.status) continue;
      const at = e.time && !Number.isNaN(Date.parse(e.time)) ? new Date(e.time) : new Date();
      const dedupeKey = createHash('sha1').update(`${e.status}|${at.toISOString()}|${e.location ?? ''}`).digest('hex');
      const mapped = engine.mapStatus(e.status);
      if (!mapped) await this.noteUnmapped(profileId, e.status, e.description ?? undefined);
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        inserted++;
        await this.db.insert(trackingEvents).values({ accountId: shipment.accountId, shipmentId: shipment.id, orderId: shipment.orderId, occurredAt: at, courierStatus: e.status.slice(0, 120), mappedStatus: mapped?.status ?? null, problemKind: (mapped?.problem as 'held' | undefined) ?? null, location: e.location?.slice(0, 200) ?? null, description: e.description?.slice(0, 1000) ?? null, raw: e.raw ?? null, dedupeKey });
      }
      if (!latestAt || at > latestAt) latestAt = at;
      if (mapped) {
        const rank = mapped.status === 'PROBLEM' ? 2.5 : RANK[mapped.status] ?? 0;
        // The most recent event decides, with DELIVERED winning outright.
        if (!best || at > best.at || mapped.status === 'DELIVERED') best = { rank, status: mapped.status, problem: mapped.problem ?? null, at };
      }
    }
    if (!best) return { shipmentId: shipment.id, events: inserted, status: null };
    const [order] = await this.db.select().from(orders).where(eq(orders.id, shipment.orderId)).limit(1);
    if (!order || order.shipmentId !== shipment.id) return { shipmentId: shipment.id, events: inserted, status: null };
    const prev = order.status;
    const set: Partial<typeof orders.$inferInsert> = { lastEventAt: latestAt ?? new Date(), updatedAt: new Date() };
    if (best.status === 'PROBLEM' && best.problem) {
      await this.orders.openProblem(ctx, order.id, best.problem as 'held', `${shipment.courierName ?? 'Courier'} reports: ${events.at(-1)?.status ?? best.problem}`, suggestedActionFor(best.problem));
      await this.db.update(orders).set(set).where(eq(orders.id, order.id));
      return { shipmentId: shipment.id, events: inserted, status: 'PROBLEM', problem: best.problem };
    }
    const currentRank = order.status === 'PROBLEM' ? 1.5 : RANK[order.status] ?? 0;
    if (best.status === 'DELIVERED' || best.rank > currentRank || (order.status === 'PROBLEM' && best.status !== 'LABEL_GENERATED')) {
      set.status = best.status;
      set.problemReason = null;
      if (best.status !== 'LABEL_GENERATED' && !order.shippedAt) set.shippedAt = best.at;
      if (best.status === 'DELIVERED') set.deliveredAt = best.at;
      await this.db.update(orders).set(set).where(eq(orders.id, order.id));
      // Courier movement clears tracking problems.
      await this.db.update(problems).set({ resolvedAt: new Date(), resolution: `Courier now reports ${best.status.toLowerCase().replace('_', ' ')}`, resolvedBy: 'tracking' })
        .where(and(eq(problems.orderId, order.id), isNull(problems.resolvedAt), inArray(problems.kind, ['no_scan', 'stalled', 'late', 'delivery_failed', 'held', 'returning'])));
      if (prev !== best.status) {
        await audit(ctx, { action: 'order.status', entityType: 'order', entityId: order.id, before: { status: prev }, after: { status: best.status, source: 'tracking' } });
        const eventName = best.status === 'DELIVERED' ? 'order.delivered' : best.status === 'IN_TRANSIT' ? 'order.in_transit' : best.status === 'SHIPPED' ? 'order.shipped' : null;
        if (eventName) await emitOrderEvent(ctx, eventName, { ...order, status: best.status });
      }
      return { shipmentId: shipment.id, events: inserted, status: best.status };
    }
    await this.db.update(orders).set(set).where(eq(orders.id, order.id));
    return { shipmentId: shipment.id, events: inserted, status: order.status };
  }

  private async noteUnmapped(profileId: string, status: string, sample?: string) {
    const [row] = await this.db.select().from(unmappedStatuses).where(and(eq(unmappedStatuses.profileId, profileId), eq(unmappedStatuses.courierStatus, status.slice(0, 120)))).limit(1);
    if (row) await this.db.update(unmappedStatuses).set({ seen: row.seen + 1, lastSeenAt: new Date() }).where(eq(unmappedStatuses.id, row.id));
    else await this.db.insert(unmappedStatuses).values({ profileId, courierStatus: status.slice(0, 120), sample: sample ?? null });
  }

  /** Poll everything due (the worker's job). */
  async pollDue(accountId?: string): Promise<{ polled: number; events: number; errors: number }> {
    const due = await this.dueShipments(accountId);
    let events = 0, errors = 0;
    for (const { s } of due) {
      try { const r = await this.poll(s); events += r.events; if (r.error) errors++; } catch { errors++; }
    }
    return { polled: due.length, events, errors };
  }

  async refresh(ctx: Ctx, idOrRef: string) {
    const order = await this.orders.rawGet(ctx, idOrRef);
    const [sh] = await this.db.select().from(shipments).where(and(eq(shipments.orderId, order.id), eq(shipments.status, 'CREATED'), eq(shipments.kind, 'outbound'))).orderBy(desc(shipments.attempt)).limit(1);
    if (!sh) return { polled: false, reason: 'No live shipment' };
    const r = await this.poll(sh, { ctx });
    await audit(ctx, { action: 'tracking.refreshed', entityType: 'order', entityId: order.id, after: r });
    return { polled: true, ...r };
  }

  /** Exception rules that depend on time rather than on a courier event. */
  async applyTimeRules(accountId?: string): Promise<{ noScan: number; stalled: number; late: number }> {
    const now = new Date();
    const counts = { noScan: 0, stalled: 0, late: 0 };
    const rows = await this.db.select({ o: orders, w: warehouses, m: shippingMethods })
      .from(orders).innerJoin(warehouses, eq(warehouses.id, orders.warehouseId)).leftJoin(shipments, eq(shipments.id, orders.shipmentId)).leftJoin(shippingMethods, eq(shippingMethods.id, shipments.methodId))
      .where(and(inArray(orders.status, ['LABEL_GENERATED', 'SHIPPED', 'IN_TRANSIT']), isNull(orders.deletedAt), accountId ? eq(orders.accountId, accountId) : sql`true`));
    for (const { o, w, m } of rows) {
      const ctx = systemCtx(o.accountId, 'tracking');
      if (o.status === 'LABEL_GENERATED') {
        const ageH = (now.getTime() - o.updatedAt.getTime()) / 3_600_000;
        if (ageH >= w.shippedAfterHours) { await this.orders.openProblem(ctx, o.id, 'no_scan', `Label printed ${Math.floor(ageH)} hours ago and the courier has not scanned it`, 'Check the parcel left the building; mark shipped by hand if it did, or re-label if it did not'); counts.noScan++; }
        continue;
      }
      const lastMove = o.lastEventAt ?? o.shippedAt ?? o.updatedAt;
      const stalledDays = workingDaysBetween(lastMove, now);
      if (o.status === 'IN_TRANSIT' && stalledDays >= 2) { await this.orders.openProblem(ctx, o.id, 'stalled', `No courier movement for ${stalledDays} working days`, 'Ask the courier where the parcel is; warn the customer of a delay'); counts.stalled++; continue; }
      const maxTransit = (m?.maxTransitDays ?? 3) + 1;
      const sinceShip = o.shippedAt ? workingDaysBetween(o.shippedAt, now) : 0;
      if (sinceShip > maxTransit) { await this.orders.openProblem(ctx, o.id, 'late', `${sinceShip} working days since first scan; ${m?.name ?? 'the service'} promises ${maxTransit - 1}`, 'Contact the courier with the tracking number; tell the customer'); counts.late++; }
    }
    return counts;
  }

  // ---- problems, returns, dashboard ----
  async listProblems(ctx: Ctx, opts: { open?: boolean; kind?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
    const where = and(eq(problems.accountId, ctx.accountId), opts.open === false ? sql`true` : isNull(problems.resolvedAt), opts.kind ? eq(problems.kind, opts.kind as 'held') : sql`true`);
    const [rows, countRows] = await Promise.all([
      this.db.select({ p: problems, orderNumber: orders.orderNumber, trackingNumber: orders.trackingNumber, courierName: orders.courierName, lastEventAt: orders.lastEventAt, orderStatus: orders.status, contactName: orders.contactName, country: orders.country })
        .from(problems).innerJoin(orders, eq(orders.id, problems.orderId)).where(where).orderBy(problems.openedAt).limit(pageSize).offset((page - 1) * pageSize),
      this.db.select({ count: sql<number>`count(*)::int` }).from(problems).where(where),
    ]);
    return { items: rows.map((r) => ({ ...r.p, orderNumber: r.orderNumber, trackingNumber: r.trackingNumber, courierName: r.courierName, lastEventAt: r.lastEventAt, orderStatus: r.orderStatus, contactName: r.contactName, country: r.country })), total: countRows[0]?.count ?? 0, page, pageSize };
  }

  async resolveProblem(ctx: Ctx, problemId: string, resolution: string) {
    const [p] = await this.db.select().from(problems).where(and(eq(problems.id, problemId), eq(problems.accountId, ctx.accountId))).limit(1);
    if (!p) return null;
    return this.orders.resolveProblem(ctx, p.orderId, problemId, resolution);
  }

  async listReturns(ctx: Ctx) {
    const rows = await this.db.select({ s: shipments, orderNumber: orders.orderNumber, contactName: orders.contactName })
      .from(shipments).innerJoin(orders, eq(orders.id, shipments.orderId))
      .where(and(eq(shipments.accountId, ctx.accountId), eq(shipments.kind, 'return'))).orderBy(desc(shipments.createdAt)).limit(500);
    return rows.map(({ s, orderNumber, contactName }) => ({ id: s.id, orderId: s.orderId, orderNumber, contactName, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl, courierName: s.courierName, methodName: s.methodName, status: s.status, cost: s.cost, createdAt: s.createdAt, documentUrl: `/v4/orders/${encodeURIComponent(orderNumber)}/print?kinds=return_label` }));
  }

  async dashboard(ctx: Ctx) {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [counts, openProblems, labels, incomplete, acct] = await Promise.all([
      this.orders.counts(ctx),
      this.db.select({ count: sql<number>`count(*)::int` }).from(problems).where(and(eq(problems.accountId, ctx.accountId), isNull(problems.resolvedAt))),
      this.db.select({ courier: shipments.courierName, count: sql<number>`count(*)::int`, cost: sql<string>`coalesce(sum(${shipments.cost}), 0)` }).from(shipments)
        .where(and(eq(shipments.accountId, ctx.accountId), eq(shipments.kind, 'outbound'), notInArray(shipments.status, ['FAILED']), sql`${shipments.createdAt} > ${weekAgo}`)).groupBy(shipments.courierName),
      this.db.select({ count: sql<number>`count(*)::int` }).from(sql`products`).where(sql`account_id = ${ctx.accountId} and deleted_at is null and (weight is null or length is null or width is null or height is null)`),
      this.db.select({ status: accounts.status, trialEndsAt: accounts.trialEndsAt }).from(accounts).where(eq(accounts.id, ctx.accountId)).limit(1),
    ]);
    return {
      counts, openProblems: openProblems[0]?.count ?? 0,
      labelsThisWeek: labels.map((l) => ({ courier: l.courier ?? 'Unknown', count: l.count })),
      costThisWeek: Number(labels.reduce((s, l) => s + Number(l.cost), 0).toFixed(2)),
      incompleteProducts: incomplete[0]?.count ?? 0,
      account: acct[0] ?? null,
    };
  }
}

function suggestedActionFor(kind: string): string {
  switch (kind) {
    case 'delivery_failed': return 'Contact the customer to rearrange delivery or confirm the address';
    case 'held': return 'Check whether duty or a customs document is outstanding; contact the courier';
    case 'returning': return 'Decide whether to re-send or refund once the parcel is back';
    case 'damaged_lost': return 'Open a claim with the courier; contact the customer about a replacement';
    default: return 'Check the tracking history and contact the courier if needed';
  }
}
