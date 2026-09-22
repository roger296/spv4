import { and, eq, isNull, lt, sql, inArray } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '../config/database.js';
import { getEnv } from '../config/env.js';
import { accounts, documents, problems, orders, webhookDeliveries, webhooks } from '../db/schema/index.js';
import { TrackingService } from '../modules/tracking/tracking.service.js';
import { documentsDir } from '../modules/labels/documents.js';
import { sendMail } from '../shared/mail.js';
import { BillingService } from '../modules/billing/billing.service.js';

export const JOBS = {
  'tracking-poll': { cron: '15 */4 * * *', run: trackingPoll },
  'exception-rules': { cron: '40 * * * *', run: exceptionRules },
  'webhook-deliver': { cron: '* * * * *', run: webhookDeliver },
  'document-retention': { cron: '10 3 * * *', run: documentRetention },
  'problem-digest': { cron: '30 7 * * *', run: problemDigest },
  'subscription-check': { cron: '0 6 * * *', run: subscriptionCheck },
} as const;

export async function runJob(name: keyof typeof JOBS): Promise<unknown> {
  return JOBS[name].run();
}

async function trackingPoll() {
  return new TrackingService().pollDue();
}

async function exceptionRules() {
  return new TrackingService().applyTimeRules();
}

/** Deliver queued webhooks: HMAC-SHA256 signature over the body, up to 8 attempts with backoff. */
export async function webhookDeliver(limit = 200) {
  const db = getDb();
  const due = await db.select({ d: webhookDeliveries, w: webhooks }).from(webhookDeliveries).innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
    .where(and(isNull(webhookDeliveries.deliveredAt), lt(webhookDeliveries.attempts, 8), eq(webhooks.active, true))).orderBy(webhookDeliveries.createdAt).limit(limit);
  let sent = 0, failed = 0;
  for (const { d, w } of due) {
    // Backoff: 1, 2, 4, 8 ... minutes after the last attempt.
    const waitMin = d.attempts === 0 ? 0 : 2 ** (d.attempts - 1);
    if (d.attempts > 0 && Date.now() - d.createdAt.getTime() < waitMin * 60_000 * d.attempts) continue;
    const body = JSON.stringify(d.payload);
    const signature = createHmac('sha256', w.secret).update(body).digest('hex');
    try {
      const res = await fetch(w.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spv4-signature': signature, 'x-spv4-event': d.event, 'x-spv4-delivery': d.id }, body, signal: AbortSignal.timeout(15_000) });
      await db.update(webhookDeliveries).set({ attempts: d.attempts + 1, lastStatus: res.status, lastError: res.ok ? null : (await res.text()).slice(0, 500), deliveredAt: res.ok ? new Date() : null }).where(eq(webhookDeliveries.id, d.id));
      if (res.ok) sent++; else failed++;
    } catch (err) {
      await db.update(webhookDeliveries).set({ attempts: d.attempts + 1, lastStatus: 0, lastError: (err as Error).message.slice(0, 500) }).where(eq(webhookDeliveries.id, d.id));
      failed++;
    }
  }
  return { due: due.length, sent, failed };
}

async function documentRetention() {
  const db = getDb();
  const cutoff = new Date(Date.now() - getEnv().DOCUMENT_RETENTION_DAYS * 86_400_000);
  const old = await db.select().from(documents).where(lt(documents.createdAt, cutoff)).limit(1000);
  let deleted = 0;
  for (const d of old) {
    await unlink(join(documentsDir(), d.filePath)).catch(() => undefined);
    await db.delete(documents).where(eq(documents.id, d.id));
    deleted++;
  }
  return { deleted };
}

async function problemDigest() {
  const db = getDb();
  const accts = await db.select().from(accounts).where(and(sql`${accounts.settings}->>'dailyProblemEmail' = 'true'`, inArray(accounts.status, ['TRIAL', 'ACTIVE', 'ARREARS'])));
  let sentCount = 0;
  for (const a of accts) {
    const to = a.settings.notificationEmails ?? [];
    if (!to.length) continue;
    const open = await db.select({ p: problems, orderNumber: orders.orderNumber, tracking: orders.trackingNumber }).from(problems).innerJoin(orders, eq(orders.id, problems.orderId)).where(and(eq(problems.accountId, a.id), isNull(problems.resolvedAt))).orderBy(problems.openedAt).limit(100);
    if (!open.length) continue;
    const lines = open.map(({ p, orderNumber, tracking }) => `- ${orderNumber} (${tracking ?? 'no tracking'}): ${p.kind.replace('_', ' ')} — ${p.description}${p.suggestedAction ? `\n    Suggested: ${p.suggestedAction}` : ''}`).join('\n');
    await sendMail({ to: to.join(','), subject: `${open.length} shipment problem${open.length === 1 ? '' : 's'} need attention`, text: `Open problems for ${a.name}, oldest first:\n\n${lines}\n\nOpen Smooth Parcel: ${getEnv().APP_ORIGIN}/problems` });
    sentCount++;
  }
  return { accounts: accts.length, sent: sentCount };
}

async function subscriptionCheck() {
  return new BillingService().dailyCheck();
}
