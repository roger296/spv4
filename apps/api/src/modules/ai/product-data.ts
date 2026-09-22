/**
 * AI job 4 (spec section 11): find weights and dimensions for incomplete products from public
 * sources, using Claude with the Anthropic web-search tool. Results land as suggestions
 * (products.suggested) unless the account trusts values above a confidence threshold.
 */
import { and, eq, isNull, or, inArray } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { getEnv } from '../../config/env.js';
import { accounts, aiUsage, products } from '../../db/schema/index.js';
import type { Ctx } from '../../shared/context.js';
import { audit } from '../../shared/audit.js';
import { AppError } from '../../shared/errors.js';
import { isAiConfigured, spentTodayGbp, extractJson } from './claude.js';

const SYSTEM = `You find the shipping weight and packaged dimensions of retail products for a UK online shop. For each product, search manufacturer pages, retailer listings and barcode databases. Prefer packaged (boxed) weight and dimensions over bare product ones. Report kilograms and centimetres. Give a confidence between 0 and 1 (1 = manufacturer specification found; 0.5 = inferred from a similar product; below 0.3 = a guess). Always include the URL you took the values from. Output only JSON: {"products":[{"sku":"...","weightKg":1.25,"lengthCm":21,"widthCm":21,"heightCm":7,"confidence":0.8,"sourceUrl":"https://...","note":"..."}]}. If you cannot find a product, include it with confidence 0 and no values.`;

export interface ProductDataResult { sku: string; weightKg?: number; lengthCm?: number; widthCm?: number; heightCm?: number; confidence: number; sourceUrl?: string; note?: string }

export type ProductSearchTransport = (body: Record<string, unknown>) => Promise<{ content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } }>;
let transport: ProductSearchTransport | null = null;
export function setProductSearchTransportForTests(fn: ProductSearchTransport | null): void { transport = fn; }

export async function findProductData(ctx: Ctx, skus?: string[]) {
  const env = getEnv();
  if (!transport && !isAiConfigured()) throw new AppError(503, 'ai_unavailable', 'AI features need ANTHROPIC_API_KEY to be set');
  const db = getDb();
  const where = and(eq(products.accountId, ctx.accountId), isNull(products.deletedAt), skus?.length ? inArray(products.stockCode, skus) : or(isNull(products.weight), isNull(products.length), isNull(products.width), isNull(products.height)));
  const rows = await db.select().from(products).where(where).limit(25);
  if (!rows.length) return { searched: 0, suggested: 0, applied: 0, results: [] as ProductDataResult[] };
  if ((await spentTodayGbp(ctx.accountId)) >= env.AI_DAILY_BUDGET_GBP) throw new AppError(429, 'ai_budget', `Today's AI budget of £${env.AI_DAILY_BUDGET_GBP} is used up`);

  const user = `Products:\n${rows.map((p) => `- sku ${p.stockCode}: ${p.name}${p.brand ? ` (brand ${p.brand})` : ''}${p.ean ? ` EAN ${p.ean}` : ''}${p.description ? ` — ${p.description.slice(0, 200)}` : ''}`).join('\n')}`;
  const body = { model: env.ANTHROPIC_MODEL, max_tokens: 4096, system: SYSTEM, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: Math.min(20, rows.length * 2) }], messages: [{ role: 'user', content: user }] };
  let data: Awaited<ReturnType<ProductSearchTransport>>;
  if (transport) data = await transport(body);
  else {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    if (!res.ok) throw new AppError(502, 'ai_error', `Claude API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    data = (await res.json()) as Awaited<ReturnType<ProductSearchTransport>>;
  }
  const text = data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
  const costGbp = (data.usage.input_tokens * 2.4 + data.usage.output_tokens * 12) / 1_000_000 + 0.008 * Math.min(20, rows.length);
  await db.insert(aiUsage).values({ accountId: ctx.accountId, job: 'product_data', model: env.ANTHROPIC_MODEL, inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens, costGbp: costGbp.toFixed(4) });
  const parsed = extractJson<{ products: ProductDataResult[] }>(text);
  const [acct] = await db.select({ settings: accounts.settings }).from(accounts).where(eq(accounts.id, ctx.accountId)).limit(1);
  const trust = acct?.settings.trustAiAboveConfidence ?? null;
  let suggested = 0, applied = 0;
  for (const r of parsed.products ?? []) {
    const p = rows.find((x) => x.stockCode === r.sku);
    if (!p || !(r.weightKg && r.lengthCm && r.widthCm && r.heightCm)) continue;
    const values = { weight: String(r.weightKg), length: String(r.lengthCm), width: String(r.widthCm), height: String(r.heightCm) };
    if (trust !== null && r.confidence >= trust) {
      await db.update(products).set({ ...values, dataSource: 'ai_suggested', dataConfidence: String(r.confidence), dataSourceUrl: r.sourceUrl ?? null, suggested: null, updatedAt: new Date() }).where(eq(products.id, p.id));
      await audit(ctx, { action: 'product.ai_applied', entityType: 'product', entityId: p.id, after: { ...r } });
      applied++;
    } else {
      await db.update(products).set({ suggested: { weight: r.weightKg, length: r.lengthCm, width: r.widthCm, height: r.heightCm, confidence: r.confidence, sourceUrl: r.sourceUrl, suggestedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(products.id, p.id));
      await audit(ctx, { action: 'product.ai_suggested', entityType: 'product', entityId: p.id, after: { ...r } });
      suggested++;
    }
  }
  return { searched: rows.length, suggested, applied, costGbp: Number(costGbp.toFixed(4)), results: parsed.products ?? [] };
}
