import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MethodsService } from './methods.service.js';
import { requireAuth } from '../../shared/auth-middleware.js';
import { requireScope, requireWrite } from '../../shared/context.js';

const surcharge = z.object({
  name: z.string().min(1).max(80), kind: z.enum(['flat', 'percent']), amount: z.number().min(0),
  when: z.object({ postcodePrefixes: z.array(z.string()).optional(), minWeightKg: z.number().optional(), minLongestCm: z.number().optional(), always: z.boolean().optional() }).optional(),
  effectiveFrom: z.string().optional(), effectiveTo: z.string().optional(), source: z.string().optional(),
});
const band = z.object({ minWeightKg: z.number().min(0), maxWeightKg: z.number().positive(), cost: z.number().min(0) });
const methodSchema = z.object({
  courierAccountId: z.string().uuid(),
  name: z.string().min(1).max(120),
  serviceCode: z.string().min(1).max(80),
  originCountry: z.string().length(2).optional(),
  destinationCountries: z.array(z.string()).optional(),
  excludedPostcodePrefixes: z.array(z.string()).optional(),
  tracked: z.boolean().optional(), signature: z.boolean().optional(), express: z.boolean().optional(),
  allowsLiquid: z.boolean().optional(), allowsBatteries: z.boolean().optional(), allowsFragile: z.boolean().optional(), returnsService: z.boolean().optional(),
  maxTransitDays: z.number().int().min(0).max(60).optional(), volumetricDivisor: z.number().int().min(1000).max(10000).optional(),
  minWeightKg: z.number().min(0).optional(), maxWeightKg: z.number().positive().optional(),
  maxLengthCm: z.number().positive().nullable().optional(), maxGirthCm: z.number().positive().nullable().optional(), maxThinnestCm: z.number().positive().nullable().optional(), maxDeclaredValue: z.number().min(0).nullable().optional(),
  preferred: z.boolean().optional(), active: z.boolean().optional(),
  surcharges: z.array(surcharge).optional(),
  bands: z.array(band).optional(),
});

export async function methodRoutes(app: FastifyInstance) {
  const svc = new MethodsService();
  const id = (req: { params: unknown }) => (req.params as { id: string }).id;

  app.get('/methods', { preHandler: requireAuth }, async (req) => { requireScope(req.ctx, 'methods:read'); return svc.list(req.ctx); });
  app.get('/methods/export', { preHandler: requireAuth }, async (req, reply) => { requireScope(req.ctx, 'methods:read'); return reply.type('text/csv').header('content-disposition', 'attachment; filename="shipping-methods.csv"').send(await svc.exportCsv(req.ctx)); });
  app.get('/methods/template', { preHandler: requireAuth }, async (_req, reply) => reply.type('text/csv').send(`${MethodsService.CSV_COLUMNS.join(',')}\nRoyal Mail Tracked 48,Royal Mail (Click & Drop),TPS,0,1000,60,3.20,5000,2,false,true,true,true,true,false,GB,GB,,true\nRoyal Mail Tracked 48,Royal Mail (Click & Drop),TPS,1001,2000,60,3.60,5000,2,false,true,true,true,true,false,GB,GB,,true\n`));

  app.post('/methods', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'methods:write', 'MANAGER');
    return reply.status(201).send(await svc.create(req.ctx, methodSchema.parse(req.body)));
  });
  app.get('/methods/:id', { preHandler: requireAuth }, async (req) => { requireScope(req.ctx, 'methods:read'); return svc.get(req.ctx, id(req)); });
  app.patch('/methods/:id', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'methods:write', 'MANAGER');
    return svc.update(req.ctx, id(req), methodSchema.partial().parse(req.body));
  });
  app.delete('/methods/:id', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'methods:write', 'MANAGER');
    await svc.remove(req.ctx, id(req));
    return reply.status(204).send();
  });
  app.get('/methods/:id/bands', { preHandler: requireAuth }, async (req) => { requireScope(req.ctx, 'methods:read'); return svc.bandHistory(req.ctx, id(req)); });
  app.put('/methods/:id/bands', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'methods:write', 'MANAGER');
    const input = z.object({ bands: z.array(band).min(1), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().max(200).optional(), source: z.enum(['manual', 'csv', 'invoice_reconciliation', 'ai_suggested', 'api']).optional() }).parse(req.body);
    const source = input.source ?? (req.ctx.actorKind === 'mcp' ? 'ai_suggested' : req.ctx.actorKind === 'api_key' ? 'api' : 'manual');
    return svc.setBands(req.ctx, id(req), input.bands, { effectiveFrom: input.effectiveFrom, note: input.note, source });
  });
  app.post('/methods/from-services', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'methods:write', 'MANAGER');
    const input = z.object({ courierAccountId: z.string().uuid(), serviceCodes: z.array(z.string()).min(1) }).parse(req.body);
    return reply.status(201).send(await svc.fromServices(req.ctx, input.courierAccountId, input.serviceCodes));
  });
  app.post('/methods/import', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'methods:write', 'MANAGER');
    const { csv } = z.object({ csv: z.string().min(1) }).parse(req.body);
    return { results: await svc.importCsv(req.ctx, csv) };
  });
  app.put('/warehouses/:id/lane-default', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'methods:write', 'MANAGER');
    const input = z.object({ country: z.string().min(2), methodId: z.string().uuid().nullable() }).parse(req.body);
    await svc.setLaneDefault(req.ctx, id(req), input.country, input.methodId);
    return reply.status(204).send();
  });
}
