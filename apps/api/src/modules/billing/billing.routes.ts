import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BillingService } from './billing.service.js';
import { requireUser } from '../../shared/auth-middleware.js';
import { requireRole } from '../../shared/context.js';

export async function billingRoutes(app: FastifyInstance) {
  const svc = new BillingService();

  app.get('/billing', { preHandler: requireUser }, async (req) => svc.summary(req.ctx));

  app.post('/billing/start', { preHandler: requireUser }, async (req) => {
    requireRole(req.ctx, 'OWNER');
    const { returnUrl } = z.object({ returnUrl: z.string().url().optional() }).parse(req.body ?? {});
    return svc.start(req.ctx, returnUrl);
  });

  /** Mollie posts `id=tr_xxx` as a form body; the payment is always re-fetched. */
  app.post('/billing/webhook', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = String(body.id ?? '');
    if (!id) return reply.status(400).send({ ok: false });
    const r = await svc.handleWebhook(id);
    return reply.status(200).send({ ok: true, ...r });
  });
}
