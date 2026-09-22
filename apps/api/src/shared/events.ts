/**
 * In-process order events. Listeners (labels, tracking, webhooks) subscribe by name.
 * Webhook events are also queued in webhook_deliveries for the worker to send.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '../config/database.js';
import { webhookDeliveries, webhooks } from '../db/schema/index.js';
import type { Ctx } from './context.js';

export type OrderEventName =
  | 'order.label_generated' | 'order.shipped' | 'order.in_transit' | 'order.delivered' | 'order.problem' | 'order.cancelled'
  | 'order.edited_after_label' | 'order.void_requested' | 'order.ready_for_label';

export interface OrderEventPayload {
  id: string; orderNumber: string; status: string; problemReason?: string | null;
  courierName?: string | null; methodName?: string | null; trackingNumber?: string | null; trackingLink?: string | null; cost?: string | null;
}

type Listener = (ctx: Ctx, payload: OrderEventPayload) => Promise<void>;
const listeners = new Map<OrderEventName, Listener[]>();

export function onOrderEvent(name: OrderEventName, fn: Listener): void {
  const list = listeners.get(name) ?? [];
  list.push(fn);
  listeners.set(name, list);
}

export function clearOrderListeners(): void { listeners.clear(); }

const WEBHOOK_EVENTS = new Set<OrderEventName>(['order.label_generated', 'order.shipped', 'order.in_transit', 'order.delivered', 'order.problem', 'order.cancelled']);

export async function emitOrderEvent(ctx: Ctx, name: OrderEventName, order: OrderEventPayload & Record<string, unknown>): Promise<void> {
  const payload: OrderEventPayload = {
    id: order.id, orderNumber: order.orderNumber, status: order.status, problemReason: order.problemReason ?? null,
    courierName: order.courierName ?? null, methodName: order.methodName ?? null, trackingNumber: order.trackingNumber ?? null, trackingLink: order.trackingLink ?? null, cost: order.cost ?? null,
  };
  for (const fn of listeners.get(name) ?? []) {
    try { await fn(ctx, payload); } catch (err) { console.error(`[events] ${name} listener failed`, err); }
  }
  if (WEBHOOK_EVENTS.has(name)) {
    const db = getDb();
    const hooks = await db.select().from(webhooks).where(and(eq(webhooks.accountId, ctx.accountId), eq(webhooks.active, true)));
    const targets = hooks.filter((h) => h.events.includes(name));
    if (targets.length) {
      await db.insert(webhookDeliveries).values(targets.map((h) => ({ webhookId: h.id, event: name, payload: { event: name, occurredAt: new Date().toISOString(), order: { reference: payload.orderNumber, ...payload } } })));
    }
  }
}
