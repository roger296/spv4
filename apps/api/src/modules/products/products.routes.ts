import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ProductsService } from './products.service.js';
import { requireAuth } from '../../shared/auth-middleware.js';
import { requireScope, requireWrite } from '../../shared/context.js';
import { parse } from 'csv-parse/sync';
import { ValidationError } from '../../shared/errors.js';

const productSchema = z.object({
  stockCode: z.string().min(1).max(100),
  name: z.string().min(1).max(500).optional(),
  ean: z.string().max(50).nullish(),
  brand: z.string().max(120).nullish(),
  description: z.string().nullish(),
  weight: z.number().min(0).max(1000).nullish(),
  length: z.number().min(0).max(1000).nullish(),
  width: z.number().min(0).max(1000).nullish(),
  height: z.number().min(0).max(1000).nullish(),
  hsCode: z.string().max(20).nullish(),
  countryOfOrigin: z.string().max(60).nullish(),
  customsDescription: z.string().max(200).nullish(),
  unitValue: z.number().min(0).nullish(),
  integrationSkus: z.record(z.string()).optional(),
  dataSource: z.enum(['manual', 'api', 'import', 'ai_suggested', 'csv']).optional(),
  dataConfidence: z.number().min(0).max(1).nullish(),
  dataSourceUrl: z.string().max(500).nullish(),
});

export async function productRoutes(app: FastifyInstance) {
  const svc = new ProductsService();

  app.get('/products', { preHandler: requireAuth }, async (req) => {
    requireScope(req.ctx, 'products:read');
    const q = z.object({ q: z.string().optional(), incomplete: z.coerce.boolean().optional(), page: z.coerce.number().optional(), pageSize: z.coerce.number().optional() }).parse(req.query);
    return svc.list(req.ctx, q);
  });

  app.get('/products/:sku', { preHandler: requireAuth }, async (req) => {
    requireScope(req.ctx, 'products:read');
    return svc.getBySku(req.ctx, decodeURIComponent((req.params as { sku: string }).sku));
  });

  app.put('/products/:sku', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'products:write');
    const sku = decodeURIComponent((req.params as { sku: string }).sku);
    const input = productSchema.omit({ stockCode: true }).parse(req.body);
    const { product, created } = await svc.upsert(req.ctx, { ...input, stockCode: sku });
    return { ...product, created };
  });

  app.post('/products/bulk', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'products:write');
    const items = z.array(productSchema).min(1).max(500).parse(req.body);
    return { results: await svc.bulkUpsert(req.ctx, items) };
  });

  /** CSV import: header row with stockCode,name,ean,brand,weight,length,width,height,hsCode,countryOfOrigin,customsDescription,unitValue */
  app.post('/products/import', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'products:write');
    const { csv } = z.object({ csv: z.string().min(1) }).parse(req.body);
    let rows: Record<string, string>[];
    try {
      rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    } catch (e) {
      throw new ValidationError(`Could not read CSV: ${(e as Error).message}`);
    }
    const inputs = rows.map((r, i) => {
      const n = (k: string) => (r[k] === undefined || r[k] === '' ? undefined : Number(r[k]));
      const parsed = productSchema.safeParse({
        stockCode: r.stockCode ?? r.sku ?? r.SKU, name: r.name || undefined, ean: r.ean || undefined, brand: r.brand || undefined,
        weight: n('weight'), length: n('length'), width: n('width'), height: n('height'),
        hsCode: r.hsCode || undefined, countryOfOrigin: r.countryOfOrigin || undefined, customsDescription: r.customsDescription || undefined, unitValue: n('unitValue'), dataSource: 'csv',
      });
      if (!parsed.success) throw new ValidationError(`Row ${i + 2}: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join(', ')}`);
      return parsed.data;
    });
    return { results: await svc.bulkUpsert(req.ctx, inputs) };
  });

  app.post('/products/:sku/accept-suggestion', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'products:write');
    return svc.acceptSuggestion(req.ctx, decodeURIComponent((req.params as { sku: string }).sku));
  });

  app.post('/products/:sku/reject-suggestion', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'products:write');
    await svc.rejectSuggestion(req.ctx, decodeURIComponent((req.params as { sku: string }).sku));
    return reply.status(204).send();
  });

  app.delete('/products/:sku', { preHandler: requireAuth }, async (req, reply) => {
    requireWrite(req.ctx, 'products:write', 'MANAGER');
    await svc.remove(req.ctx, decodeURIComponent((req.params as { sku: string }).sku));
    return reply.status(204).send();
  });
}
