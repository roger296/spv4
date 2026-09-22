import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LabelService } from './label.service.js';
import { requireAuth } from '../../shared/auth-middleware.js';
import { requireScope, requireWrite } from '../../shared/context.js';
import { OrderService } from '../orders/order.service.js';
import { toAlpha2 } from '../../shared/countries.js';
import { ValidationError } from '../../shared/errors.js';

/** Documents may be fetched with `?token=` so a browser tab can open them. */
async function authWithQueryToken(req: Parameters<typeof requireAuth>[0], reply: Parameters<typeof requireAuth>[1]) {
  const q = req.query as { token?: string };
  if (q.token && !req.headers.authorization) req.headers.authorization = `Bearer ${q.token}`;
  await requireAuth(req, reply);
}

export async function labelRoutes(app: FastifyInstance) {
  const svc = new LabelService();
  const orderSvc = new OrderService();
  const ref = (req: { params: unknown }) => decodeURIComponent((req.params as { reference: string }).reference);

  app.post('/quotes', { preHandler: requireAuth }, async (req) => {
    requireScope(req.ctx, 'orders:read');
    const input = z.object({
      warehouse: z.string().optional(),
      deliveryAddress: z.object({ country: z.string().min(2), postCode: z.string().optional() }),
      parcels: z.array(z.object({ weight: z.number().positive(), length: z.number().positive(), width: z.number().positive(), height: z.number().positive() })).min(1),
      deliveryPromise: z.enum(['economy', 'standard', 'express', 'next_day']).optional(),
      deliverBy: z.string().optional(),
      flags: z.object({ signature: z.boolean().optional(), fragile: z.boolean().optional(), liquid: z.boolean().optional(), batteries: z.boolean().optional() }).optional(),
      declaredValue: z.number().min(0).optional(),
    }).parse(req.body);
    const country = toAlpha2(input.deliveryAddress.country);
    if (!country) throw new ValidationError(`Unknown country ${input.deliveryAddress.country}`);
    const r = await svc.quote(req.ctx, {
      warehouse: input.warehouse, country, postCode: input.deliveryAddress.postCode ?? null,
      parcels: input.parcels.map((p) => ({ weightKg: p.weight, lengthCm: p.length, widthCm: p.width, heightCm: p.height })),
      promise: input.deliverBy ? 'date' : input.deliveryPromise, deliverBy: input.deliverBy, flags: input.flags, declaredValue: input.declaredValue,
    });
    return { chosen: r.chosen, ranked: r.ranked, dropped: r.dropped, reason: r.reason };
  });

  app.get('/orders/:reference/documents/:id', { preHandler: authWithQueryToken }, async (req, reply) => {
    requireScope(req.ctx, 'labels:read');
    const { doc, bytes } = await svc.documentBytes(req.ctx, ref(req), (req.params as { id: string }).id);
    const isZpl = doc.filePath.endsWith('.zpl');
    return reply.type(isZpl ? 'text/plain' : 'application/pdf').header('cache-control', 'private, no-store').header('content-disposition', `inline; filename="${doc.kind}-${ref(req)}.${isZpl ? 'zpl' : 'pdf'}"`).send(bytes);
  });

  app.get('/orders/:reference/print', { preHandler: authWithQueryToken }, async (req, reply) => {
    requireScope(req.ctx, 'labels:read');
    const kinds = (((req.query as { kinds?: string }).kinds ?? 'label,packing_note,customs_invoice').split(',') as ('label' | 'packing_note' | 'customs_invoice' | 'return_label')[]);
    const pdf = await svc.printSet(req.ctx, ref(req), kinds);
    return reply.type('application/pdf').header('cache-control', 'private, no-store').send(Buffer.from(pdf));
  });

  app.post('/orders/print', { preHandler: requireAuth }, async (req, reply) => {
    requireScope(req.ctx, 'labels:read');
    const { references } = z.object({ references: z.array(z.string()).min(1).max(200) }).parse(req.body);
    const pdf = await svc.batchPrint(req.ctx, references);
    return reply.type('application/pdf').header('cache-control', 'private, no-store').send(Buffer.from(pdf));
  });

  app.post('/orders/:reference/relabel', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'orders:write');
    const { method } = z.object({ method: z.string().optional() }).parse(req.body ?? {});
    await svc.relabel(req.ctx, ref(req), method);
    return orderSvc.get(req.ctx, ref(req));
  });

  app.post('/orders/:reference/return-label', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'orders:write');
    const r = await svc.createReturnLabel(req.ctx, ref(req));
    return { ...r, order: await orderSvc.get(req.ctx, ref(req)) };
  });
}
