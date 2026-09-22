/**
 * Platform admin portal (spec section 13): accounts, a read-only support view, impersonation
 * with consent recorded, courier catalogue review, health and audit.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { accounts, auditLog, courierProfiles, orders, problems, shipments, unmappedStatuses, users, webhookDeliveries } from '../../db/schema/index.js';
import { requireAdmin } from '../../shared/auth-middleware.js';
import { NotFoundError } from '../../shared/errors.js';
import { sendMail } from '../../shared/mail.js';
import { AuthService } from '../auth/auth.service.js';
import { getEnv } from '../../config/env.js';

export async function adminRoutes(app: FastifyInstance) {
  const db = getDb();
  const auth = new AuthService();

  app.get('/admin/accounts', { preHandler: requireAdmin }, async (req) => {
    const q = z.object({ q: z.string().optional(), status: z.string().optional() }).parse(req.query);
    const rows = await db.select({
      a: accounts,
      labels30d: sql<number>`(select count(*)::int from shipments s where s.account_id = accounts.id and s.kind = 'outbound' and s.status <> 'FAILED' and s.created_at > now() - interval '30 days')`,
      openProblems: sql<number>`(select count(*)::int from problems p where p.account_id = accounts.id and p.resolved_at is null)`,
      lastSignIn: sql<Date | null>`(select max(u.last_sign_in_at) from users u where u.account_id = accounts.id)`,
      ownerEmail: sql<string | null>`(select u.email from users u where u.account_id = accounts.id and u.role = 'OWNER' limit 1)`,
    }).from(accounts).orderBy(desc(accounts.createdAt)).limit(500);
    return rows
      .filter((r) => (!q.status || r.a.status === q.status) && (!q.q || `${r.a.name} ${r.a.slug} ${r.ownerEmail ?? ''}`.toLowerCase().includes(q.q.toLowerCase())))
      .map((r) => { const { mollieCustomerId, mollieMandateId, mollieSubscriptionId, ...a } = r.a; return { ...a, hasMandate: !!mollieMandateId, labels30d: r.labels30d, openProblems: r.openProblems, lastSignIn: r.lastSignIn, ownerEmail: r.ownerEmail }; });
  });

  app.get('/admin/accounts/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const [a] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    if (!a) throw new NotFoundError('account', id);
    const team = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role, lastSignInAt: users.lastSignInAt }).from(users).where(and(eq(users.accountId, id), isNull(users.deletedAt)));
    const counts = await db.select({ status: orders.status, count: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.accountId, id), isNull(orders.deletedAt))).groupBy(orders.status);
    const { mollieCustomerId, mollieMandateId, mollieSubscriptionId, ...safe } = a;
    return { ...safe, hasMandate: !!mollieMandateId, hasSubscription: !!mollieSubscriptionId, team, orderCounts: Object.fromEntries(counts.map((c) => [c.status, c.count])) };
  });

  app.patch('/admin/accounts/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const patch = z.object({ status: z.enum(['TRIAL', 'ACTIVE', 'ARREARS', 'SUSPENDED', 'CLOSED']).optional(), billingMode: z.enum(['MOLLIE', 'INVOICED', 'COMPLIMENTARY']).optional(), trialEndsAt: z.string().datetime().optional(), name: z.string().min(1).optional() }).parse(req.body);
    const [before] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    if (!before) throw new NotFoundError('account', id);
    const [after] = await db.update(accounts).set({ ...patch, trialEndsAt: patch.trialEndsAt ? new Date(patch.trialEndsAt) : before.trialEndsAt, closedAt: patch.status === 'CLOSED' ? new Date() : before.closedAt, updatedAt: new Date() }).where(eq(accounts.id, id)).returning();
    await db.insert(auditLog).values({ accountId: id, actorKind: 'admin', actorId: req.admin!.adminId, actorName: req.admin!.email, clientName: 'admin-portal', kind: 'action', action: 'admin.account_updated', entityType: 'account', entityId: id, before: { status: before.status, billingMode: before.billingMode }, after: patch });
    const { mollieCustomerId, mollieMandateId, mollieSubscriptionId, ...safe } = after!;
    return safe;
  });

  /** Impersonate: a 2-hour token as the account owner; the owner is emailed and the reason logged. */
  app.post('/admin/accounts/:id/impersonate', { preHandler: requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(req.body);
    const [owner] = await db.select().from(users).where(and(eq(users.accountId, id), eq(users.role, 'OWNER'), isNull(users.deletedAt))).limit(1);
    if (!owner) throw new NotFoundError('account owner');
    const token = app.jwt.sign(auth.userClaims(owner), { expiresIn: '2h' });
    await db.insert(auditLog).values({ accountId: id, actorKind: 'admin', actorId: req.admin!.adminId, actorName: req.admin!.email, clientName: 'admin-portal', kind: 'action', action: 'admin.impersonated', entityType: 'account', entityId: id, after: { reason, as: owner.email } });
    await sendMail({ to: owner.email, subject: 'Smooth Parcel support accessed your account', text: `A Smooth Parcel administrator (${req.admin!.email}) opened your account for support. Reason: ${reason}. If you did not ask for this, reply to this email.` });
    return { token, expiresInMinutes: 120 };
  });

  // ---- courier catalogue review ----
  app.get('/admin/courier-profiles', { preHandler: requireAdmin }, async (req) => {
    const { review } = z.object({ review: z.string().optional() }).parse(req.query);
    const rows = await db.select().from(courierProfiles).where(and(isNull(courierProfiles.deletedAt), review ? eq(courierProfiles.review, review as 'submitted') : sql`${courierProfiles.origin} <> 'own' or ${courierProfiles.review} = 'submitted'`)).orderBy(desc(courierProfiles.updatedAt));
    const unmapped = await db.select({ profileId: unmappedStatuses.profileId, count: sql<number>`count(*)::int` }).from(unmappedStatuses).groupBy(unmappedStatuses.profileId);
    const um = new Map(unmapped.map((u) => [u.profileId, u.count]));
    return rows.map((p) => ({ ...p, unmappedStatuses: um.get(p.id) ?? 0 }));
  });

  app.post('/admin/courier-profiles/:id/publish', { preHandler: requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const [p] = await db.select().from(courierProfiles).where(eq(courierProfiles.id, id)).limit(1);
    if (!p) throw new NotFoundError('courier profile', id);
    // Publishing an account's submission creates the shared catalogue copy; the original stays theirs.
    const [shared] = await db.insert(courierProfiles).values({
      accountId: null, key: p.key.replace(/-[0-9a-f]{8}$/, ''), name: p.name, origin: 'shared', review: 'published', version: 1, sourceProfileId: p.id,
      definition: p.definition, credentialSchema: p.credentialSchema, services: p.services, contributorName: p.contributorName, aiSuggested: p.aiSuggested,
    }).returning();
    await db.update(courierProfiles).set({ review: 'published', updatedAt: new Date() }).where(eq(courierProfiles.id, id));
    await db.insert(auditLog).values({ accountId: p.accountId, actorKind: 'admin', actorId: req.admin!.adminId, actorName: req.admin!.email, clientName: 'admin-portal', kind: 'action', action: 'admin.profile_published', entityType: 'courier_profile', entityId: shared!.id, after: { from: p.id, key: shared!.key } });
    return shared;
  });

  app.post('/admin/courier-profiles/:id/retire', { preHandler: requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const [p] = await db.update(courierProfiles).set({ review: 'retired', updatedAt: new Date() }).where(eq(courierProfiles.id, id)).returning();
    if (!p) throw new NotFoundError('courier profile', id);
    return p;
  });

  app.get('/admin/courier-profiles/:id/unmapped', { preHandler: requireAdmin }, async (req) =>
    db.select().from(unmappedStatuses).where(eq(unmappedStatuses.profileId, (req.params as { id: string }).id)).orderBy(desc(unmappedStatuses.seen)));

  // ---- health ----
  app.get('/admin/health', { preHandler: requireAdmin }, async () => {
    const day = new Date(Date.now() - 86_400_000);
    const [byProfile, failedLabels, webhookBacklog, pollBacklog] = await Promise.all([
      db.select({ profileId: shipments.profileId, name: courierProfiles.name, total: sql<number>`count(*)::int`, failed: sql<number>`sum(case when ${shipments.status} = 'FAILED' then 1 else 0 end)::int` })
        .from(shipments).innerJoin(courierProfiles, eq(courierProfiles.id, shipments.profileId)).where(gte(shipments.createdAt, day)).groupBy(shipments.profileId, courierProfiles.name),
      db.select({ count: sql<number>`count(*)::int` }).from(shipments).where(and(eq(shipments.status, 'FAILED'), gte(shipments.createdAt, day))),
      db.select({ count: sql<number>`count(*)::int` }).from(webhookDeliveries).where(isNull(webhookDeliveries.deliveredAt)),
      db.select({ count: sql<number>`count(*)::int` }).from(shipments).innerJoin(orders, eq(orders.id, shipments.orderId)).where(and(eq(shipments.status, 'CREATED'), sql`${orders.status} in ('LABEL_GENERATED','SHIPPED','IN_TRANSIT','PROBLEM')`, sql`coalesce(${shipments.lastTrackedAt}, ${shipments.createdAt}) < now() - interval '5 hours'`)),
    ]);
    return { couriers24h: byProfile, failedLabels24h: failedLabels[0]?.count ?? 0, webhookBacklog: webhookBacklog[0]?.count ?? 0, trackingBacklog: pollBacklog[0]?.count ?? 0, version: '4.0.0', env: getEnv().NODE_ENV };
  });

  app.get('/admin/audit', { preHandler: requireAdmin }, async (req) => {
    const q = z.object({ accountId: z.string().uuid().optional(), limit: z.coerce.number().max(500).optional() }).parse(req.query);
    return db.select().from(auditLog).where(q.accountId ? eq(auditLog.accountId, q.accountId) : eq(auditLog.actorKind, 'admin')).orderBy(desc(auditLog.createdAt)).limit(q.limit ?? 200);
  });
}
