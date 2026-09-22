import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { TrackingService } from './tracking.service.js';
import { requireAuth } from '../../shared/auth-middleware.js';
import { requireScope, requireWrite } from '../../shared/context.js';
import { getDb } from '../../config/database.js';
import { accounts, courierAccounts, courierProfiles, orders, shipments, trackingEvents } from '../../db/schema/index.js';
import { NotFoundError } from '../../shared/errors.js';
import { ConnectorEngine, loadEngineAccount } from '../../couriers/engine.js';
import { parseDefinition } from '../../couriers/profile-schema.js';
import { getPath } from '../../couriers/template.js';
import { systemCtx } from '../../shared/context.js';
import { OrderService } from '../orders/order.service.js';
import { suggestProblemAction } from '../ai/problem-triage.js';
import { renderTrackingPage } from './tracking-page.js';

export async function trackingRoutes(app: FastifyInstance) {
  const svc = new TrackingService();
  const db = getDb();

  app.post('/orders/:reference/refresh-tracking', { preHandler: requireAuth }, async (req) => {
    requireScope(req.ctx, 'tracking:read');
    return svc.refresh(req.ctx, decodeURIComponent((req.params as { reference: string }).reference));
  });

  app.get('/problems', { preHandler: requireAuth }, async (req) => {
    requireScope(req.ctx, 'orders:read');
    const q = z.object({ open: z.coerce.boolean().optional(), kind: z.string().optional(), page: z.coerce.number().optional(), pageSize: z.coerce.number().optional() }).parse(req.query);
    return svc.listProblems(req.ctx, { ...q, open: q.open ?? true });
  });

  app.post('/problems/:id/resolve', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'problems:write');
    const { resolution } = z.object({ resolution: z.string().min(1).max(1000) }).parse(req.body);
    const r = await svc.resolveProblem(req.ctx, (req.params as { id: string }).id, resolution);
    if (!r) throw new NotFoundError('problem');
    return r;
  });

  app.post('/problems/:id/suggest', { preHandler: requireAuth }, async (req) => {
    requireScope(req.ctx, 'orders:read');
    return suggestProblemAction(req.ctx, (req.params as { id: string }).id);
  });

  app.get('/returns', { preHandler: requireAuth }, async (req) => { requireScope(req.ctx, 'orders:read'); return svc.listReturns(req.ctx); });
  app.get('/dashboard', { preHandler: requireAuth }, async (req) => { requireScope(req.ctx, 'orders:read'); return svc.dashboard(req.ctx); });

  /**
   * Courier push notifications. A profile declares nothing special: the courier is configured
   * (by the user, in the courier's portal) to POST to this URL, which carries the courier account id.
   * The body is mapped with the profile's track.response, so the same mapping serves push and poll.
   */
  app.post('/courier-webhooks/:courierAccountId', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { courierAccountId } = req.params as { courierAccountId: string };
    const [ca] = await db.select().from(courierAccounts).where(eq(courierAccounts.id, courierAccountId)).limit(1);
    if (!ca) return reply.status(404).send({ ok: false });
    const [profile] = await db.select().from(courierProfiles).where(eq(courierProfiles.id, ca.profileId)).limit(1);
    if (!profile) return reply.status(404).send({ ok: false });
    const def = parseDefinition(profile.definition);
    const map = def.operations.track?.response;
    if (!map) return reply.status(202).send({ ok: true, ignored: 'profile has no track mapping' });
    const body = req.body as unknown;
    const items = map.batchItems ? (getPath(body, map.batchItems) as unknown[] | undefined) ?? [] : [body];
    const engine = new ConnectorEngine(def, await loadEngineAccount(ca));
    let handled = 0;
    for (const item of items) {
      const tracking = String(getPath(item, map.batchKey ?? 'trackingNumber') ?? '');
      if (!tracking) continue;
      const [sh] = await db.select().from(shipments).where(and(eq(shipments.courierAccountId, ca.id), eq(shipments.trackingNumber, tracking))).limit(1);
      if (!sh) continue;
      const rawEvents = getPath(item, map.events);
      const list = Array.isArray(rawEvents) ? rawEvents : [item];
      await svc.ingest(systemCtx(sh.accountId, 'courier-webhook'), sh, engine, list.map((e) => ({ status: String(getPath(e, map.status) ?? ''), time: String(getPath(e, map.time) ?? ''), location: map.location ? (getPath(e, map.location) as string) ?? null : null, description: map.description ? (getPath(e, map.description) as string) ?? null : null, raw: e })), profile.id);
      handled++;
    }
    return reply.status(200).send({ ok: true, handled });
  });

  /** Public tracking page: by courier tracking number or order reference, scoped to the account slug. */
  app.get('/track/:slug/:tracking', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { slug, tracking } = req.params as { slug: string; tracking: string };
    const [acct] = await db.select().from(accounts).where(eq(accounts.slug, slug)).limit(1);
    if (!acct) return reply.status(404).type('text/html').send(renderTrackingPage(null, null, [], 'Not found'));
    const t = tracking.trim();
    const [order] = await db.select().from(orders).where(and(eq(orders.accountId, acct.id), eq(orders.trackingNumber, t))).limit(1)
      .then(async (r) => (r.length ? r : db.select().from(orders).where(and(eq(orders.accountId, acct.id), eq(orders.orderNumber, t))).limit(1)));
    if (!order) return reply.status(404).type('text/html').send(renderTrackingPage(acct, null, [], 'We could not find that parcel'));
    const events = await db.select().from(trackingEvents).where(eq(trackingEvents.orderId, order.id)).orderBy(trackingEvents.occurredAt);
    return reply.type('text/html').send(renderTrackingPage(acct, order, events, null));
  });

  app.post('/track/:slug/:tracking/report', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { slug, tracking } = req.params as { slug: string; tracking: string };
    const { message } = z.object({ message: z.string().min(1).max(2000) }).parse(req.body);
    const [acct] = await db.select().from(accounts).where(eq(accounts.slug, slug)).limit(1);
    if (!acct) return reply.status(404).send({ ok: false });
    const [order] = await db.select().from(orders).where(and(eq(orders.accountId, acct.id), eq(orders.trackingNumber, tracking.trim()))).limit(1);
    if (!order) return reply.status(404).send({ ok: false });
    await new OrderService().openProblem(systemCtx(acct.id, 'customer'), order.id, 'customer_reported', `Customer reported via tracking page: ${message.slice(0, 500)}`, 'Read the customer message and reply');
    return { ok: true };
  });
}
