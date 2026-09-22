/**
 * Subscriptions through Mollie (spec section 3): sign-up creates a Mollie customer and takes a
 * first payment with sequenceType "first", which yields a mandate; V4 then creates a weekly
 * Subscription against it. Mollie calls the webhook per payment. Test and live keys differ only
 * in the key prefix, so the whole flow runs in Mollie's test mode in development.
 * Docs: https://docs.mollie.com/docs/recurring-payments
 */
import { and, eq, inArray, lt } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { getEnv } from '../../config/env.js';
import { accounts, payments, users } from '../../db/schema/index.js';
import { audit } from '../../shared/audit.js';
import { systemCtx, type Ctx } from '../../shared/context.js';
import { AppError, NotFoundError } from '../../shared/errors.js';
import { sendMail } from '../../shared/mail.js';

export type MollieTransport = (method: string, path: string, body?: unknown) => Promise<Record<string, unknown>>;
let transport: MollieTransport | null = null;
export function setMollieTransportForTests(fn: MollieTransport | null): void { transport = fn; }

async function mollie(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  if (transport) return transport(method, path, body);
  const key = getEnv().MOLLIE_API_KEY;
  if (!key) throw new AppError(503, 'billing_unavailable', 'Billing is not configured (MOLLIE_API_KEY)');
  const res = await fetch(`https://api.mollie.com/v2${path}`, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AppError(502, 'billing_error', `Mollie ${res.status}: ${(data.detail as string) ?? (data.title as string) ?? 'error'}`);
  return data;
}

export class BillingService {
  private db = getDb();

  async summary(ctx: Ctx) {
    const [a] = await this.db.select().from(accounts).where(eq(accounts.id, ctx.accountId)).limit(1);
    if (!a) throw new NotFoundError('account');
    const history = await this.db.select().from(payments).where(eq(payments.accountId, a.id)).orderBy(payments.createdAt).limit(52);
    const env = getEnv();
    return {
      status: a.status, billingMode: a.billingMode, trialEndsAt: a.trialEndsAt, hasMandate: !!a.mollieMandateId, hasSubscription: !!a.mollieSubscriptionId,
      weeklyAmount: env.SUBSCRIPTION_WEEKLY_AMOUNT_GBP, currency: 'GBP', lastPaidAt: a.lastPaidAt, failedPayments: a.failedPayments,
      payments: history.map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, status: p.status, paidAt: p.paidAt, createdAt: p.createdAt })),
      configured: !!env.MOLLIE_API_KEY || !!transport,
    };
  }

  /** Start: Mollie customer + first payment. Returns the checkout URL to redirect to. */
  async start(ctx: Ctx, returnUrl?: string) {
    const env = getEnv();
    const [a] = await this.db.select().from(accounts).where(eq(accounts.id, ctx.accountId)).limit(1);
    if (!a) throw new NotFoundError('account');
    const [owner] = await this.db.select().from(users).where(and(eq(users.accountId, a.id), eq(users.role, 'OWNER'))).limit(1);
    let customerId = a.mollieCustomerId;
    if (!customerId) {
      const c = await mollie('POST', '/customers', { name: a.name, email: owner?.email, metadata: { accountId: a.id } });
      customerId = String(c.id);
      await this.db.update(accounts).set({ mollieCustomerId: customerId }).where(eq(accounts.id, a.id));
    }
    const payment = await mollie('POST', '/payments', {
      amount: { currency: 'GBP', value: env.SUBSCRIPTION_WEEKLY_AMOUNT_GBP },
      description: `Smooth Parcel weekly subscription for ${a.name}`,
      customerId, sequenceType: 'first',
      redirectUrl: returnUrl ?? `${env.APP_ORIGIN}/settings/billing?returned=1`,
      webhookUrl: env.MOLLIE_WEBHOOK_URL ?? `${env.API_ORIGIN}/v4/billing/webhook`,
      metadata: { accountId: a.id, kind: 'first' },
    });
    await this.db.insert(payments).values({ accountId: a.id, molliePaymentId: String(payment.id), amount: env.SUBSCRIPTION_WEEKLY_AMOUNT_GBP, status: String(payment.status ?? 'open'), sequenceType: 'first', raw: payment }).onConflictDoNothing();
    await audit(ctx, { action: 'billing.started', entityType: 'account', entityId: a.id, after: { paymentId: payment.id } });
    const links = payment._links as { checkout?: { href: string } } | undefined;
    return { checkoutUrl: links?.checkout?.href ?? null, paymentId: payment.id };
  }

  /** Mollie webhook: always re-fetch the payment rather than trusting the body. */
  async handleWebhook(paymentId: string) {
    const p = await mollie('GET', `/payments/${encodeURIComponent(paymentId)}`);
    const meta = (p.metadata ?? {}) as { accountId?: string };
    const customerId = p.customerId as string | undefined;
    let [a] = meta.accountId ? await this.db.select().from(accounts).where(eq(accounts.id, meta.accountId)).limit(1) : [];
    if (!a && customerId) [a] = await this.db.select().from(accounts).where(eq(accounts.mollieCustomerId, customerId)).limit(1);
    if (!a) return { handled: false, reason: 'no account' };
    const status = String(p.status);
    const amount = (p.amount as { value?: string })?.value ?? getEnv().SUBSCRIPTION_WEEKLY_AMOUNT_GBP;
    const paidAt = p.paidAt ? new Date(String(p.paidAt)) : null;
    await this.db.insert(payments).values({ accountId: a.id, molliePaymentId: String(p.id), amount, status, sequenceType: (p.sequenceType as string) ?? null, paidAt, raw: p })
      .onConflictDoUpdate({ target: payments.molliePaymentId, set: { status, paidAt, raw: p } });
    const ctx = systemCtx(a.id, 'mollie');
    if (status === 'paid') {
      const mandateId = (p.mandateId as string | undefined) ?? a.mollieMandateId;
      const set: Partial<typeof accounts.$inferInsert> = { status: 'ACTIVE', failedPayments: 0, lastPaidAt: paidAt ?? new Date(), mollieMandateId: mandateId ?? null, updatedAt: new Date() };
      // First payment: create the weekly subscription against the new mandate.
      if (p.sequenceType === 'first' && !a.mollieSubscriptionId && customerId && mandateId) {
        const start = new Date(Math.max(Date.now(), a.trialEndsAt?.getTime() ?? 0) + 86_400_000).toISOString().slice(0, 10);
        const sub = await mollie('POST', `/customers/${customerId}/subscriptions`, {
          amount: { currency: 'GBP', value: getEnv().SUBSCRIPTION_WEEKLY_AMOUNT_GBP }, interval: '1 week', startDate: start, description: `Smooth Parcel weekly subscription for ${a.name}`,
          mandateId, webhookUrl: getEnv().MOLLIE_WEBHOOK_URL ?? `${getEnv().API_ORIGIN}/v4/billing/webhook`, metadata: { accountId: a.id },
        });
        set.mollieSubscriptionId = String(sub.id);
      }
      await this.db.update(accounts).set(set).where(eq(accounts.id, a.id));
      await audit(ctx, { action: 'billing.paid', entityType: 'account', entityId: a.id, after: { paymentId: p.id, amount } });
      return { handled: true, status };
    }
    if (['failed', 'expired', 'canceled'].includes(status) && p.sequenceType === 'recurring') {
      const failed = a.failedPayments + 1;
      const newStatus = failed >= 3 ? 'ARREARS' : a.status;
      await this.db.update(accounts).set({ failedPayments: failed, status: newStatus, updatedAt: new Date() }).where(eq(accounts.id, a.id));
      await audit(ctx, { action: 'billing.failed', entityType: 'account', entityId: a.id, after: { paymentId: p.id, failed, status: newStatus } });
      if (newStatus === 'ARREARS') await this.notify(a.id, 'Your Smooth Parcel subscription payment failed', `Three payments have failed, so labels are paused until a payment succeeds. Update your card at ${getEnv().APP_ORIGIN}/settings/billing`);
      return { handled: true, status, failed };
    }
    return { handled: true, status };
  }

  /** Mollie cancels a subscription after its own retries; we learn of it on the next daily check. */
  async dailyCheck() {
    const now = new Date();
    const out = { trialsEnded: 0, suspended: 0 };
    const ended = await this.db.select().from(accounts).where(and(eq(accounts.status, 'TRIAL'), eq(accounts.billingMode, 'MOLLIE'), lt(accounts.trialEndsAt, now)));
    for (const a of ended) {
      if (a.mollieMandateId) { await this.db.update(accounts).set({ status: 'ACTIVE', updatedAt: now }).where(eq(accounts.id, a.id)); continue; }
      await this.db.update(accounts).set({ status: 'ARREARS', updatedAt: now }).where(eq(accounts.id, a.id));
      await this.notify(a.id, 'Your Smooth Parcel trial has ended', `Add a card to keep buying labels: ${getEnv().APP_ORIGIN}/settings/billing`);
      out.trialsEnded++;
    }
    const subscribed = await this.db.select().from(accounts).where(and(inArray(accounts.status, ['ACTIVE', 'ARREARS']), eq(accounts.billingMode, 'MOLLIE')));
    for (const a of subscribed) {
      if (!a.mollieSubscriptionId || !a.mollieCustomerId) continue;
      try {
        const sub = await mollie('GET', `/customers/${a.mollieCustomerId}/subscriptions/${a.mollieSubscriptionId}`);
        if (['canceled', 'suspended', 'completed'].includes(String(sub.status))) {
          await this.db.update(accounts).set({ status: 'SUSPENDED', updatedAt: now }).where(eq(accounts.id, a.id));
          await audit(systemCtx(a.id, 'mollie'), { action: 'billing.suspended', entityType: 'account', entityId: a.id, after: { subscriptionStatus: sub.status } });
          out.suspended++;
        }
      } catch { /* Mollie unavailable: try tomorrow */ }
    }
    return out;
  }

  private async notify(accountId: string, subject: string, text: string) {
    const [owner] = await this.db.select().from(users).where(and(eq(users.accountId, accountId), eq(users.role, 'OWNER'))).limit(1);
    if (owner) await sendMail({ to: owner.email, subject, text });
  }
}
