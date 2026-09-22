import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ORDER_STATUSES } from '@spv4/shared-types';
import { OrderService } from './order.service.js';
import { requireAuth } from '../../shared/auth-middleware.js';
import { requireScope, requireWrite } from '../../shared/context.js';
import { NeedsInformationError } from '../../shared/errors.js';

const addressSchema = z.object({
  contactName: z.string().min(1).max(120),
  company: z.string().max(120).nullish(),
  line1: z.string().min(1).max(255),
  line2: z.string().max(255).nullish(),
  city: z.string().min(1).max(100),
  region: z.string().max(100).nullish(),
  postCode: z.string().max(20).default(''),
  country: z.string().min(2).max(60),
  phone: z.string().max(50).nullish(),
  email: z.string().max(200).nullish(),
});

const lineSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().max(500).optional(),
  quantity: z.number().positive(),
  unitValue: z.number().min(0).optional(),
  weight: z.number().positive().optional(),
  dimensions: z.object({ length: z.number().positive(), width: z.number().positive(), height: z.number().positive() }).optional(),
  hsCode: z.string().max(20).optional(),
  countryOfOrigin: z.string().max(60).optional(),
  customsDescription: z.string().max(200).optional(),
});

const parcelSchema = z.object({
  weight: z.number().positive(), length: z.number().positive(), width: z.number().positive(), height: z.number().positive(),
  lines: z.array(z.object({ sku: z.string(), quantity: z.number().positive() })).optional(),
});

export const createOrderSchema = z.object({
  reference: z.string().min(1).max(100),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  warehouse: z.string().max(200).optional(),
  customer: z.object({ name: z.string().max(200).optional(), email: z.string().max(200).optional(), phone: z.string().max(50).optional() }).optional(),
  deliveryAddress: addressSchema,
  deliveryPromise: z.string().max(20).optional(),
  lines: z.array(lineSchema).max(200).optional(),
  parcels: z.array(parcelSchema).max(50).optional(),
  customs: z.object({ incoterm: z.enum(['DDU', 'DDP']).optional(), declaredValue: z.number().min(0).optional(), currency: z.string().length(3).optional() }).optional(),
  flags: z.object({ signature: z.boolean().optional(), fragile: z.boolean().optional(), liquid: z.boolean().optional(), batteries: z.boolean().optional() }).optional(),
  method: z.string().max(120).optional(),
  courier: z.string().max(120).optional(),
  label: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function orderRoutes(app: FastifyInstance) {
  const svc = new OrderService();
  const ref = (req: { params: unknown }) => decodeURIComponent((req.params as { reference: string }).reference);

  app.get('/orders', { preHandler: requireAuth }, async (req) => {
    requireScope(req.ctx, 'orders:read');
    const q = z.object({
      status: z.string().optional(), q: z.string().optional(), since: z.string().optional(), problem: z.string().optional(), country: z.string().optional(),
      page: z.coerce.number().optional(), pageSize: z.coerce.number().optional(), all: z.coerce.boolean().optional(),
    }).parse(req.query);
    const status = q.status ? q.status.split(',').filter((s): s is (typeof ORDER_STATUSES)[number] => (ORDER_STATUSES as readonly string[]).includes(s)) : undefined;
    return svc.list(req.ctx, { ...q, status });
  });

  app.get('/orders/counts', { preHandler: requireAuth }, async (req) => {
    requireScope(req.ctx, 'orders:read');
    return svc.counts(req.ctx);
  });

  app.post('/orders', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'orders:write');
    const input = createOrderSchema.parse(req.body);
    const source = req.ctx.actorKind === 'mcp' ? 'mcp' : req.ctx.actorKind === 'user' ? 'manual' : (req.headers['x-source'] === 'smmta' ? 'smmta' : 'api');
    const { order, duplicate } = await svc.create(req.ctx, input, source);
    if (duplicate) return reply.status(200).send({ ...order, duplicate: true });
    if (input.label !== false) {
      if (order.status === 'NEW') {
        const labelled = await svc.requestLabel(req.ctx, order.id);
        return reply.status(201).send(labelled);
      }
      // Saved, but the caller must supply more before a label can be bought.
      throw new NeedsInformationError(order.orderNumber, order.missing, order.status);
    }
    return reply.status(201).send(order);
  });

  app.get('/orders/:reference', { preHandler: requireAuth }, async (req) => {
    requireScope(req.ctx, 'orders:read');
    return svc.get(req.ctx, ref(req), { view: true });
  });

  app.get('/orders/:reference/history', { preHandler: requireAuth }, async (req) => {
    requireScope(req.ctx, 'orders:read');
    return svc.history(req.ctx, ref(req));
  });

  app.patch('/orders/:reference', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'orders:write');
    const patch = createOrderSchema.partial().omit({ reference: true, label: true }).parse(req.body);
    return svc.update(req.ctx, ref(req), patch);
  });

  app.post('/orders/:reference/label', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'orders:write');
    const body = z.object({ method: z.string().optional(), courier: z.string().optional() }).parse(req.body ?? {});
    return svc.requestLabel(req.ctx, ref(req), body);
  });

  app.post('/orders/:reference/parcels', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'orders:write');
    const body = z.object({ parcels: z.array(parcelSchema).min(1).max(50) }).parse(req.body);
    return svc.setParcels(req.ctx, ref(req), body.parcels);
  });

  app.post('/orders/:reference/cancel', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'orders:write');
    const body = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
    return svc.cancel(req.ctx, ref(req), body.reason);
  });

  app.post('/orders/:reference/shipped', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'orders:write');
    return svc.markShipped(req.ctx, ref(req));
  });

  app.post('/orders/:reference/notes', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'orders:write', 'READ_ONLY');
    const { note } = z.object({ note: z.string().min(1).max(4000) }).parse(req.body);
    await svc.note(req.ctx, ref(req), note);
    return reply.status(201).send({ ok: true });
  });

  app.post('/orders/:reference/problems/:problemId/resolve', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'problems:write');
    const { problemId } = req.params as { problemId: string };
    const { resolution } = z.object({ resolution: z.string().min(1).max(1000) }).parse(req.body);
    return svc.resolveProblem(req.ctx, ref(req), problemId, resolution);
  });
}
