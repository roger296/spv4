/**
 * AI job 1 (spec section 11): suggest the action for a problem shipment. Sends tracking facts
 * and the town, never the full address. Falls back to the rule-based suggestion without a key.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { orders, problems, trackingEvents } from '../../db/schema/index.js';
import type { Ctx } from '../../shared/context.js';
import { NotFoundError } from '../../shared/errors.js';
import { audit } from '../../shared/audit.js';
import { askClaude, isAiConfigured } from './claude.js';

const SYSTEM = `You help a small UK online retailer deal with a parcel problem. You are given the facts Smooth Parcel holds. Reply with 3 to 6 short numbered steps in British English, most useful first, each one a concrete action the retailer can take today (who to contact, what to say, what to check). Mention the tracking number where a step needs it. If the customer should be told something, draft the one-line message. No preamble.`;

export async function suggestProblemAction(ctx: Ctx, problemId: string) {
  const db = getDb();
  const [p] = await db.select().from(problems).where(and(eq(problems.id, problemId), eq(problems.accountId, ctx.accountId))).limit(1);
  if (!p) throw new NotFoundError('problem', problemId);
  const [o] = await db.select().from(orders).where(eq(orders.id, p.orderId)).limit(1);
  if (!o) throw new NotFoundError('order');
  const events = await db.select().from(trackingEvents).where(eq(trackingEvents.orderId, o.id)).orderBy(trackingEvents.occurredAt);
  const facts = [
    `Problem: ${p.kind} — ${p.description}`,
    `Opened: ${p.openedAt.toISOString()}`,
    `Order: ${o.orderNumber}, status ${o.status}, courier ${o.courierName ?? 'none'} ${o.methodName ?? ''}, tracking ${o.trackingNumber ?? 'none'}`,
    `Destination: ${o.city ?? ''}, ${o.country ?? ''}; delivery promise ${o.deliveryPromise}`,
    `Shipped at: ${o.shippedAt?.toISOString() ?? 'not scanned'}; last event ${o.lastEventAt?.toISOString() ?? 'none'}`,
    `Tracking history: ${events.length ? events.map((e) => `${e.occurredAt.toISOString().slice(0, 16)} ${e.courierStatus}${e.location ? ` @ ${e.location}` : ''}`).join(' | ') : 'no scans'}`,
  ].join('\n');
  if (!isAiConfigured()) {
    return { suggestion: p.suggestedAction ?? 'Check the tracking history and contact the courier', source: 'rules' as const };
  }
  const r = await askClaude({ accountId: ctx.accountId, job: 'problem_triage', system: SYSTEM, user: facts, maxTokens: 600 });
  await db.update(problems).set({ suggestedAction: r.text.slice(0, 2000) }).where(eq(problems.id, p.id));
  await audit(ctx, { action: 'problem.ai_suggested', entityType: 'order', entityId: o.id, after: { problemId: p.id, costGbp: r.costGbp } });
  return { suggestion: r.text, source: 'ai' as const, costGbp: r.costGbp };
}
