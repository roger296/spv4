import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CourierService } from './courier.service.js';
import { requireAuth } from '../../shared/auth-middleware.js';
import { requireRole, requireWrite } from '../../shared/context.js';
import { OPERATION_NAMES } from '../../couriers/profile-schema.js';
import { draftProfileFromDocumentation } from '../ai/profile-drafter.js';

const credentialField = z.object({ key: z.string().min(1), label: z.string().min(1), secret: z.boolean().optional(), help: z.string().optional(), required: z.boolean().optional() });
const serviceDef = z.object({
  code: z.string().min(1), name: z.string().min(1), tracked: z.boolean().optional(), signature: z.boolean().optional(), express: z.boolean().optional(),
  maxTransitDays: z.number().optional(), domestic: z.boolean().optional(), international: z.boolean().optional(),
  limits: z.object({ minWeightKg: z.number().optional(), maxWeightKg: z.number().optional(), maxLengthCm: z.number().optional(), maxGirthCm: z.number().optional(), maxThinnestCm: z.number().optional() }).optional(),
});

export async function courierRoutes(app: FastifyInstance) {
  const svc = new CourierService();

  app.get('/courier-profiles', { preHandler: requireAuth }, async (req) => svc.listProfiles(req.ctx));
  app.get('/courier-profiles/:id', { preHandler: requireAuth }, async (req) => svc.getProfile(req.ctx, (req.params as { id: string }).id));

  app.post('/courier-profiles', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'couriers:write', 'MANAGER');
    const input = z.object({ name: z.string().min(1).max(120), key: z.string().max(80).optional(), definition: z.unknown(), credentialSchema: z.array(credentialField).optional(), services: z.array(serviceDef).optional(), aiSuggested: z.boolean().optional() }).parse(req.body);
    return reply.status(201).send(await svc.createProfile(req.ctx, { ...input, definition: input.definition ?? {} }));
  });

  app.put('/courier-profiles/:id', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'couriers:write', 'MANAGER');
    const patch = z.object({ name: z.string().min(1).max(120).optional(), definition: z.unknown().optional(), credentialSchema: z.array(credentialField).optional(), services: z.array(serviceDef).optional(), optOutSharing: z.boolean().optional() }).parse(req.body);
    return svc.updateProfile(req.ctx, (req.params as { id: string }).id, patch);
  });

  app.delete('/courier-profiles/:id', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'couriers:write', 'MANAGER');
    await svc.deleteProfile(req.ctx, (req.params as { id: string }).id);
    return reply.status(204).send();
  });

  app.post('/courier-profiles/:id/submit', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'couriers:write', 'MANAGER');
    const { contributorName } = z.object({ contributorName: z.string().max(120).optional() }).parse(req.body ?? {});
    return svc.submitProfile(req.ctx, (req.params as { id: string }).id, contributorName);
  });

  app.post('/courier-profiles/:id/test', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'couriers:write', 'MANAGER');
    const input = z.object({ courierAccountId: z.string().uuid(), operation: z.enum(OPERATION_NAMES), sampleOrderReference: z.string().optional() }).parse(req.body);
    return svc.testOperation(req.ctx, { ...input, profileId: (req.params as { id: string }).id });
  });

  /** AI: draft a profile from pasted documentation or a URL. */
  app.post('/courier-profiles/draft', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'couriers:write', 'MANAGER');
    const input = z.object({ name: z.string().max(120).optional(), documentation: z.string().max(400_000).optional(), url: z.string().url().optional() }).refine((v) => v.documentation || v.url, 'documentation or url is required').parse(req.body);
    return draftProfileFromDocumentation(req.ctx, input);
  });

  // ---- courier accounts ----
  app.get('/courier-accounts', { preHandler: requireAuth }, async (req) => svc.listAccounts(req.ctx));

  app.post('/courier-accounts', { preHandler: requireAuth }, async (req, reply) => {
    requireRole(req.ctx, 'MANAGER');
    const input = z.object({ profileId: z.string().uuid(), name: z.string().max(120).optional(), credentials: z.record(z.string()), sandbox: z.boolean().optional() }).parse(req.body);
    return reply.status(201).send(await svc.createAccount(req.ctx, input));
  });

  app.patch('/courier-accounts/:id', { preHandler: requireAuth }, async (req) => {
    requireRole(req.ctx, 'MANAGER');
    const patch = z.object({ name: z.string().max(120).optional(), credentials: z.record(z.string()).optional(), sandbox: z.boolean().optional(), active: z.boolean().optional() }).parse(req.body);
    return svc.updateAccount(req.ctx, (req.params as { id: string }).id, patch);
  });

  app.delete('/courier-accounts/:id', { preHandler: requireAuth }, async (req, reply) => {
    requireRole(req.ctx, 'MANAGER');
    await svc.deleteAccount(req.ctx, (req.params as { id: string }).id);
    return reply.status(204).send();
  });

  app.post('/courier-accounts/:id/test', { preHandler: requireAuth }, async (req) => {
    requireRole(req.ctx, 'MANAGER');
    const { operation, sampleOrderReference } = z.object({ operation: z.enum(OPERATION_NAMES).default('auth_test'), sampleOrderReference: z.string().optional() }).parse(req.body ?? {});
    return svc.testOperation(req.ctx, { courierAccountId: (req.params as { id: string }).id, operation, sampleOrderReference });
  });
}
