import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../shared/auth-middleware.js';
import { requireWrite } from '../../shared/context.js';
import { findProductData } from './product-data.js';
import { reconcileInvoice } from './invoice-reconciliation.js';
import { isAiConfigured, spentTodayGbp } from './claude.js';
import { getEnv } from '../../config/env.js';

export async function aiRoutes(app: FastifyInstance) {
  app.get('/ai/status', { preHandler: requireAuth }, async (req) => ({ configured: isAiConfigured(), model: getEnv().ANTHROPIC_MODEL, spentTodayGbp: await spentTodayGbp(req.ctx.accountId), budgetGbp: getEnv().AI_DAILY_BUDGET_GBP }));

  app.post('/ai/product-data', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'products:write');
    const { skus } = z.object({ skus: z.array(z.string()).max(25).optional() }).parse(req.body ?? {});
    return findProductData(req.ctx, skus);
  });

  app.post('/ai/reconcile-invoice', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'methods:write', 'MANAGER');
    const { text } = z.object({ text: z.string().min(20).max(200_000) }).parse(req.body);
    return reconcileInvoice(req.ctx, text);
  });
}
