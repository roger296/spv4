/**
 * AI job 2 (spec section 11): reconcile a courier invoice against what we expected to pay.
 * Claude extracts the invoice lines; V4 matches them to shipments by tracking number, compares
 * charged cost with the band cost at purchase, and proposes band updates and surcharge rules.
 * Nothing is applied automatically: the caller (UI or Cowork) reviews and calls the methods API.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { shipments, shippingMethods } from '../../db/schema/index.js';
import type { Ctx } from '../../shared/context.js';
import { audit } from '../../shared/audit.js';
import { askClaude, extractJson, isAiConfigured } from './claude.js';
import { AppError } from '../../shared/errors.js';

const SYSTEM = `You read a courier invoice (Royal Mail, DPD or similar) that a UK retailer pastes as text. Extract every charged line. Output only JSON:
{"invoice":{"courier":"...","number":"...","date":"YYYY-MM-DD","currency":"GBP","total":123.45},
 "lines":[{"trackingNumber":"...","reference":"...","service":"...","date":"YYYY-MM-DD","weightKg":1.2,"baseCharge":3.20,"surcharges":[{"name":"Fuel surcharge","amount":0.35}],"total":3.55}],
 "globalSurcharges":[{"name":"Fuel surcharge","kind":"percent","amount":9.5}]}
Tracking numbers and references must be copied exactly. Put per-parcel extras (fuel, remote area, oversize, signature) in surcharges. If the invoice states a fuel or peak surcharge percentage, put it in globalSurcharges. Use null for unknown numbers.`;

export interface InvoiceLine { trackingNumber?: string | null; reference?: string | null; service?: string | null; date?: string | null; weightKg?: number | null; baseCharge?: number | null; surcharges?: { name: string; amount: number }[]; total?: number | null }

export async function reconcileInvoice(ctx: Ctx, text: string) {
  if (!isAiConfigured()) throw new AppError(503, 'ai_unavailable', 'AI features need ANTHROPIC_API_KEY to be set');
  const r = await askClaude({ accountId: ctx.accountId, job: 'invoice_reconciliation', system: SYSTEM, user: text.slice(0, 150_000), maxTokens: 8192 });
  const parsed = extractJson<{ invoice: Record<string, unknown>; lines: InvoiceLine[]; globalSurcharges?: { name: string; kind: 'percent' | 'flat'; amount: number }[] }>(r.text);
  return matchInvoice(ctx, parsed, r.costGbp);
}

/** Pure-ish matching, also used by tests without a model. */
export async function matchInvoice(ctx: Ctx, parsed: { invoice: Record<string, unknown>; lines: InvoiceLine[]; globalSurcharges?: { name: string; kind: 'percent' | 'flat'; amount: number }[] }, costGbp = 0) {
  const db = getDb();
  const numbers = parsed.lines.map((l) => l.trackingNumber?.replace(/\s+/g, '')).filter((x): x is string => !!x);
  const refs = parsed.lines.map((l) => l.reference).filter((x): x is string => !!x);
  const rows = numbers.length || refs.length
    ? await db.select({ s: shipments, methodName: shippingMethods.name }).from(shipments).leftJoin(shippingMethods, eq(shippingMethods.id, shipments.methodId))
      .where(and(eq(shipments.accountId, ctx.accountId), inArray(shipments.trackingNumber, numbers.length ? numbers : ['-'])))
    : [];
  const byTracking = new Map(rows.map((x) => [x.s.trackingNumber?.replace(/\s+/g, ''), x]));
  const matches: { trackingNumber: string | null; reference: string | null; shipmentId: string | null; methodId: string | null; methodName: string | null; expected: number | null; charged: number | null; difference: number | null; surcharges: { name: string; amount: number }[] }[] = [];
  const perMethod = new Map<string, { name: string; diffs: number[]; surchargeNames: Map<string, number[]> }>();
  for (const line of parsed.lines) {
    const hit = line.trackingNumber ? byTracking.get(line.trackingNumber.replace(/\s+/g, '')) : undefined;
    const charged = line.total ?? (line.baseCharge ?? 0) + (line.surcharges ?? []).reduce((s, x) => s + x.amount, 0);
    const expected = hit?.s.cost !== null && hit?.s.cost !== undefined ? Number(hit.s.cost) : null;
    const difference = expected !== null && charged !== null ? Number((charged - expected).toFixed(2)) : null;
    matches.push({ trackingNumber: line.trackingNumber ?? null, reference: line.reference ?? null, shipmentId: hit?.s.id ?? null, methodId: hit?.s.methodId ?? null, methodName: hit?.methodName ?? null, expected, charged, difference, surcharges: line.surcharges ?? [] });
    if (hit?.s.methodId && difference !== null) {
      const m = perMethod.get(hit.s.methodId) ?? { name: hit.methodName ?? '', diffs: [] as number[], surchargeNames: new Map<string, number[]>() };
      m.diffs.push(difference);
      for (const sc of line.surcharges ?? []) m.surchargeNames.set(sc.name, [...(m.surchargeNames.get(sc.name) ?? []), sc.amount]);
      perMethod.set(hit.s.methodId, m);
    }
  }
  const proposals = [...perMethod.entries()].map(([methodId, m]) => {
    const avg = m.diffs.reduce((a, b) => a + b, 0) / m.diffs.length;
    const consistent = m.diffs.every((d) => Math.abs(d - avg) < 0.05);
    return {
      methodId, methodName: m.name, lines: m.diffs.length, averageDifference: Number(avg.toFixed(2)), consistent,
      suggestion: Math.abs(avg) < 0.01 ? 'Costs match; no change' : consistent ? `Raise every band by ${avg.toFixed(2)} (or add it as a flat surcharge) from the invoice date` : 'Differences vary by parcel; check weights and remote-area surcharges before changing bands',
      surcharges: [...m.surchargeNames.entries()].map(([name, amounts]) => ({ name, kind: 'flat' as const, amount: Number((amounts.reduce((a, b) => a + b, 0) / amounts.length).toFixed(2)), seen: amounts.length })),
    };
  });
  const unmatched = matches.filter((m) => !m.shipmentId).length;
  const overcharged = matches.filter((m) => (m.difference ?? 0) > 0.01);
  await audit(ctx, { action: 'invoice.reconciled', entityType: 'account', entityId: ctx.accountId, after: { invoice: parsed.invoice, lines: parsed.lines.length, matched: matches.length - unmatched, overcharged: overcharged.length, costGbp } });
  return { invoice: parsed.invoice, matches, unmatched, overcharged: overcharged.length, totalDifference: Number(matches.reduce((s, m) => s + (m.difference ?? 0), 0).toFixed(2)), proposals, globalSurcharges: parsed.globalSurcharges ?? [], costGbp };
}
