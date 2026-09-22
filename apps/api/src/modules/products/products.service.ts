import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { getDb, type Tx } from '../../config/database.js';
import { products } from '../../db/schema/index.js';
import { audit, diff } from '../../shared/audit.js';
import type { Ctx } from '../../shared/context.js';
import { NotFoundError } from '../../shared/errors.js';
import { toAlpha2 } from '../../shared/countries.js';

export interface ProductInput {
  stockCode: string;
  name?: string;
  ean?: string | null;
  brand?: string | null;
  description?: string | null;
  weight?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  hsCode?: string | null;
  countryOfOrigin?: string | null;
  customsDescription?: string | null;
  unitValue?: number | null;
  integrationSkus?: Record<string, string>;
  dataSource?: 'manual' | 'api' | 'import' | 'ai_suggested' | 'csv';
  dataConfidence?: number | null;
  dataSourceUrl?: string | null;
}

const num = (v: number | null | undefined) => (v === undefined ? undefined : v === null ? null : String(v));

export function isComplete(p: { weight: string | null; length: string | null; width: string | null; height: string | null }): boolean {
  return [p.weight, p.length, p.width, p.height].every((v) => v !== null && Number(v) > 0);
}

export class ProductsService {
  private db = getDb();

  async list(ctx: Ctx, opts: { q?: string; incomplete?: boolean; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
    const conds = [eq(products.accountId, ctx.accountId), isNull(products.deletedAt)];
    if (opts.q) {
      const like = `%${opts.q.trim()}%`;
      conds.push(or(ilike(products.name, like), ilike(products.stockCode, like), ilike(products.ean, like), ilike(products.brand, like))!);
    }
    if (opts.incomplete) {
      conds.push(or(isNull(products.weight), isNull(products.length), isNull(products.width), isNull(products.height), sql`${products.weight} <= 0`)!);
    }
    const where = and(...conds);
    const [rows, countRows] = await Promise.all([
      this.db.select().from(products).where(where).orderBy(asc(products.stockCode)).limit(pageSize).offset((page - 1) * pageSize),
      this.db.select({ count: sql<number>`count(*)::int` }).from(products).where(where),
    ]);
    return { items: rows.map((r) => ({ ...r, complete: isComplete(r) })), page, pageSize, total: countRows[0]?.count ?? 0 };
  }

  async getBySku(ctx: Ctx, sku: string) {
    const [p] = await this.db.select().from(products).where(and(eq(products.accountId, ctx.accountId), eq(products.stockCode, sku), isNull(products.deletedAt))).limit(1);
    if (!p) throw new NotFoundError('product', sku);
    return { ...p, complete: isComplete(p) };
  }

  /** Create or update by SKU. Returns the row and whether it was created. */
  async upsert(ctx: Ctx, input: ProductInput, tx?: Tx) {
    const db = tx ?? this.db;
    const [existing] = await db.select().from(products).where(and(eq(products.accountId, ctx.accountId), eq(products.stockCode, input.stockCode), isNull(products.deletedAt))).limit(1);
    const values = {
      name: input.name ?? existing?.name ?? input.stockCode,
      ean: input.ean, brand: input.brand, description: input.description,
      weight: num(input.weight), length: num(input.length), width: num(input.width), height: num(input.height),
      hsCode: input.hsCode, countryOfOrigin: input.countryOfOrigin ? toAlpha2(input.countryOfOrigin) : input.countryOfOrigin,
      customsDescription: input.customsDescription, unitValue: num(input.unitValue),
      integrationSkus: input.integrationSkus, dataSource: input.dataSource, dataConfidence: num(input.dataConfidence), dataSourceUrl: input.dataSourceUrl,
    };
    const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Partial<typeof products.$inferInsert>;
    if (existing) {
      const [row] = await db.update(products).set({ ...clean, updatedAt: new Date() }).where(eq(products.id, existing.id)).returning();
      const d = diff(existing as Record<string, unknown>, row as Record<string, unknown>);
      if (d.changed) await audit(ctx, { action: 'product.updated', entityType: 'product', entityId: existing.id, before: d.before, after: d.after }, db);
      return { product: row!, created: false };
    }
    const [row] = await db.insert(products).values({ accountId: ctx.accountId, stockCode: input.stockCode, name: values.name, ...clean, dataSource: input.dataSource ?? (ctx.actorKind === 'user' ? 'manual' : 'api') }).returning();
    await audit(ctx, { action: 'product.created', entityType: 'product', entityId: row!.id, after: clean }, db);
    return { product: row!, created: true };
  }

  /** Bulk update from the incomplete-products list or an AI task. */
  async bulkUpsert(ctx: Ctx, inputs: ProductInput[]) {
    const results: { sku: string; created: boolean; complete: boolean }[] = [];
    for (const input of inputs) {
      const { product, created } = await this.upsert(ctx, input);
      results.push({ sku: product.stockCode, created, complete: isComplete(product) });
    }
    return results;
  }

  /** Fill only the fields the product lacks. Used when an order line carries product data. */
  async fillGaps(ctx: Ctx, sku: string, name: string | undefined, data: Partial<ProductInput>, tx?: Tx) {
    const db = tx ?? this.db;
    const [existing] = await db.select().from(products).where(and(eq(products.accountId, ctx.accountId), eq(products.stockCode, sku), isNull(products.deletedAt))).limit(1);
    if (!existing) return this.upsert(ctx, { stockCode: sku, name, ...data, dataSource: ctx.actorKind === 'user' ? 'manual' : 'api' }, tx);
    const patch: ProductInput = { stockCode: sku };
    if (existing.weight === null && data.weight) patch.weight = data.weight;
    if (existing.length === null && data.length) patch.length = data.length;
    if (existing.width === null && data.width) patch.width = data.width;
    if (existing.height === null && data.height) patch.height = data.height;
    if (!existing.hsCode && data.hsCode) patch.hsCode = data.hsCode;
    if (!existing.countryOfOrigin && data.countryOfOrigin) patch.countryOfOrigin = data.countryOfOrigin;
    if (!existing.customsDescription && data.customsDescription) patch.customsDescription = data.customsDescription;
    if (existing.unitValue === null && data.unitValue) patch.unitValue = data.unitValue;
    if (Object.keys(patch).length === 1) return { product: existing, created: false };
    return this.upsert(ctx, patch, tx);
  }

  async acceptSuggestion(ctx: Ctx, sku: string) {
    const p = await this.getBySku(ctx, sku);
    if (!p.suggested) return p;
    const s = p.suggested;
    const [row] = await this.db.update(products).set({
      weight: s.weight !== undefined ? String(s.weight) : p.weight,
      length: s.length !== undefined ? String(s.length) : p.length,
      width: s.width !== undefined ? String(s.width) : p.width,
      height: s.height !== undefined ? String(s.height) : p.height,
      dataSource: 'ai_suggested', dataConfidence: String(s.confidence), dataSourceUrl: s.sourceUrl ?? null, suggested: null, updatedAt: new Date(),
    }).where(eq(products.id, p.id)).returning();
    await audit(ctx, { action: 'product.suggestion_accepted', entityType: 'product', entityId: p.id, before: { weight: p.weight, length: p.length, width: p.width, height: p.height }, after: s });
    return { ...row!, complete: isComplete(row!) };
  }

  async rejectSuggestion(ctx: Ctx, sku: string) {
    const p = await this.getBySku(ctx, sku);
    await this.db.update(products).set({ suggested: null, updatedAt: new Date() }).where(eq(products.id, p.id));
    await audit(ctx, { action: 'product.suggestion_rejected', entityType: 'product', entityId: p.id, before: p.suggested });
  }

  async remove(ctx: Ctx, sku: string) {
    const p = await this.getBySku(ctx, sku);
    await this.db.update(products).set({ deletedAt: new Date() }).where(eq(products.id, p.id));
    await audit(ctx, { action: 'product.deleted', entityType: 'product', entityId: p.id, before: { stockCode: p.stockCode } });
  }

  async bySkus(ctx: Ctx, skus: string[], tx?: Tx) {
    if (!skus.length) return [];
    return (tx ?? this.db).select().from(products).where(and(eq(products.accountId, ctx.accountId), inArray(products.stockCode, skus), isNull(products.deletedAt)));
  }

  async recentIncompleteCount(ctx: Ctx) {
    const countRows = await this.db.select({ count: sql<number>`count(*)::int` }).from(products)
      .where(and(eq(products.accountId, ctx.accountId), isNull(products.deletedAt), or(isNull(products.weight), isNull(products.length), isNull(products.width), isNull(products.height))!));
    return countRows[0]?.count ?? 0;
  }
}

export const productOrderBy = { desc, asc };
