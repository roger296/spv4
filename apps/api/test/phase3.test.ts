import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { auth, signUp, testApp, ukAddress, type TestAccount } from './helpers.js';
import { startFakeCourier, type FakeState } from './fake-courier.js';
import { closeDatabase, getDb } from '../src/config/database.js';
import { BUILTIN_PROFILES } from '../src/couriers/builtin/index.js';
import { TrackingService } from '../src/modules/tracking/tracking.service.js';
import { orders, warehouses } from '../src/db/schema/index.js';
import { webhookDeliver } from '../src/worker/jobs.js';
import { setMollieTransportForTests } from '../src/modules/billing/billing.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { lastMails } from '../src/shared/mail.js';

let app: FastifyInstance;
let acct: TestAccount;
let fake: { app: FastifyInstance; url: string; state: FakeState };
let dpdAccountId: string;

beforeAll(async () => {
  app = await testApp();
  acct = await signUp(app, 'Tracking Ltd');
  fake = await startFakeCourier();
  const dpd = BUILTIN_PROFILES.find((p) => p.key === 'dpd-uk')!;
  const prof = await app.inject({ method: 'POST', url: '/v4/courier-profiles', headers: auth(acct.token), payload: { name: 'Fake DPD', definition: { ...dpd.definition, baseUrl: `${fake.url}/dpd` }, credentialSchema: dpd.credentialSchema, services: dpd.services } });
  const ca = await app.inject({ method: 'POST', url: '/v4/courier-accounts', headers: auth(acct.token), payload: { profileId: prof.json().id, name: 'DPD', credentials: { username: 'dpduser', password: 'dpdpass', accountNumber: 'ACC1' } } });
  dpdAccountId = ca.json().id;
  await app.inject({ method: 'POST', url: '/v4/methods', headers: auth(acct.token), payload: { courierAccountId: dpdAccountId, name: 'DPD Next Day', serviceCode: '1^12', destinationCountries: ['GB'], maxTransitDays: 1, bands: [{ minWeightKg: 0, maxWeightKg: 30, cost: 5.5 }] } });
  await app.inject({ method: 'POST', url: '/v4/webhooks', headers: auth(acct.token), payload: { url: `${fake.url}/hooks`, events: ['order.label_generated', 'order.delivered', 'order.problem'] } });
});
afterAll(async () => {
  setMollieTransportForTests(null);
  await fake.app.close();
  await app.close();
  await closeDatabase();
});

const H = () => auth(acct.token);

describe('tracking', () => {
  it('buys, polls and moves the order through in transit to delivered', async () => {
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: H(), payload: { reference: 'T-1', deliveryAddress: ukAddress, parcels: [{ weight: 1, length: 20, width: 20, height: 8 }] } });
    expect(res.statusCode).toBe(201);
    const tracking = res.json().trackingNumber as string;
    fake.state.trackingEvents[tracking] = [{ status: 'Collected from sender', time: '2026-09-22T10:00:00Z', location: 'Manchester' }, { status: 'At delivery depot', time: '2026-09-22T18:00:00Z', location: 'Stockport' }];
    const r1 = await app.inject({ method: 'POST', url: '/v4/orders/T-1/refresh-tracking', headers: H() });
    expect(r1.json().events).toBe(2);
    let got = await app.inject({ method: 'GET', url: '/v4/orders/T-1', headers: H() });
    expect(got.json().status).toBe('IN_TRANSIT');
    expect(got.json().trackingEvents).toHaveLength(2);
    expect(got.json().trackingEvents[0].mappedStatus).toBe('IN_TRANSIT');
    fake.state.trackingEvents[tracking]!.push({ status: 'Delivered - signed by JONES', time: '2026-09-23T09:12:00Z' });
    await app.inject({ method: 'POST', url: '/v4/orders/T-1/refresh-tracking', headers: H() });
    got = await app.inject({ method: 'GET', url: '/v4/orders/T-1', headers: H() });
    expect(got.json().status).toBe('DELIVERED');
    expect(got.json().deliveredAt).toBeTruthy();
    // Again: no duplicate events.
    await app.inject({ method: 'POST', url: '/v4/orders/T-1/refresh-tracking', headers: H() });
    got = await app.inject({ method: 'GET', url: '/v4/orders/T-1', headers: H() });
    expect(got.json().trackingEvents).toHaveLength(3);
  });

  it('opens a delivery_failed problem from a courier status and clears it on delivery', async () => {
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: H(), payload: { reference: 'T-2', deliveryAddress: ukAddress, parcels: [{ weight: 1, length: 20, width: 20, height: 8 }] } });
    const tracking = res.json().trackingNumber as string;
    fake.state.trackingEvents[tracking] = [{ status: 'Collected', time: '2026-09-22T10:00:00Z' }, { status: 'Unable to deliver - carded', time: '2026-09-23T11:00:00Z' }];
    await app.inject({ method: 'POST', url: '/v4/orders/T-2/refresh-tracking', headers: H() });
    let got = await app.inject({ method: 'GET', url: '/v4/orders/T-2', headers: H() });
    expect(got.json().status).toBe('PROBLEM');
    expect(got.json().problemReason).toBe('delivery_failed');
    const probs = await app.inject({ method: 'GET', url: '/v4/problems', headers: H() });
    expect(probs.json().items.some((p: { orderNumber: string; kind: string }) => p.orderNumber === 'T-2' && p.kind === 'delivery_failed')).toBe(true);
    fake.state.trackingEvents[tracking]!.push({ status: 'Delivered', time: '2026-09-24T11:00:00Z' });
    await app.inject({ method: 'POST', url: '/v4/orders/T-2/refresh-tracking', headers: H() });
    got = await app.inject({ method: 'GET', url: '/v4/orders/T-2', headers: H() });
    expect(got.json().status).toBe('DELIVERED');
    expect(got.json().problems.every((p: { resolvedAt: string | null }) => p.resolvedAt)).toBe(true);
  });

  it('flags a label with no scan after the warehouse deadline', async () => {
    await app.inject({ method: 'POST', url: '/v4/orders', headers: H(), payload: { reference: 'T-3', deliveryAddress: ukAddress, parcels: [{ weight: 1, length: 20, width: 20, height: 8 }] } });
    await getDb().update(warehouses).set({ shippedAfterHours: 1 }).where(eq(warehouses.id, acct.warehouseId));
    await getDb().update(orders).set({ updatedAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(orders.orderNumber, 'T-3'));
    const r = await new TrackingService().applyTimeRules(acct.accountId);
    expect(r.noScan).toBeGreaterThanOrEqual(1);
    const got = await app.inject({ method: 'GET', url: '/v4/orders/T-3', headers: H() });
    expect(got.json().status).toBe('PROBLEM');
    expect(got.json().problemReason).toBe('no_scan');
    const shipped = await app.inject({ method: 'POST', url: '/v4/orders/T-3/shipped', headers: H() });
    expect(shipped.json().status).toBe('SHIPPED');
  });

  it('accepts courier push notifications on the webhook URL', async () => {
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: H(), payload: { reference: 'T-4', deliveryAddress: ukAddress, parcels: [{ weight: 1, length: 20, width: 20, height: 8 }] } });
    const tracking = res.json().trackingNumber as string;
    const push = await app.inject({ method: 'POST', url: `/v4/courier-webhooks/${dpdAccountId}`, payload: { trackingNumber: tracking, data: { trackingEvent: [{ trackingEventStatus: 'Collected from sender', trackingEventDate: '2026-09-22T12:00:00Z' }] } } });
    expect(push.json().handled).toBe(1);
    const got = await app.inject({ method: 'GET', url: '/v4/orders/T-4', headers: H() });
    expect(got.json().status).toBe('SHIPPED');
  });

  it('serves the public tracking page and takes a problem report', async () => {
    const got = await app.inject({ method: 'GET', url: '/v4/orders/T-1', headers: H() });
    const slug = (await app.inject({ method: 'GET', url: '/v4/account', headers: H() })).json().slug;
    const page = await app.inject({ method: 'GET', url: `/v4/track/${slug}/${got.json().trackingNumber}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Delivered');
    expect(page.body).toContain('Manchester');
    expect(page.body).not.toContain('12 High Street');
    const report = await app.inject({ method: 'POST', url: `/v4/track/${slug}/${got.json().trackingNumber}/report`, payload: { message: 'Left with neighbour but not received' } });
    expect(report.json().ok).toBe(true);
    const probs = await app.inject({ method: 'GET', url: '/v4/problems?kind=customer_reported', headers: H() });
    expect(probs.json().items).toHaveLength(1);
    const resolved = await app.inject({ method: 'POST', url: `/v4/problems/${probs.json().items[0].id}/resolve`, headers: H(), payload: { resolution: 'Found in shed' } });
    expect(resolved.statusCode).toBe(200);
  });

  it('delivers webhooks with a signature', async () => {
    const r = await webhookDeliver();
    expect(r.sent).toBeGreaterThan(0);
    const received = fake.state.webhooks;
    expect(received.length).toBeGreaterThan(0);
    expect(received[0]!.headers['x-spv4-signature']).toMatch(/^[0-9a-f]{64}$/);
    const events = received.map((x) => (x.body as { event: string }).event);
    expect(events).toContain('order.label_generated');
    expect(events).toContain('order.delivered');
  });

  it('lists returns and a dashboard', async () => {
    await app.inject({ method: 'POST', url: '/v4/orders/T-1/return-label', headers: H() });
    const ret = await app.inject({ method: 'GET', url: '/v4/returns', headers: H() });
    expect(ret.json()).toHaveLength(1);
    const dash = await app.inject({ method: 'GET', url: '/v4/dashboard', headers: H() });
    expect(dash.json().labelsThisWeek[0].courier).toBe('DPD');
    expect(dash.json().costThisWeek).toBeGreaterThan(0);
  });
});

describe('CSV order import', () => {
  it('imports rows with per-row outcomes', async () => {
    const tpl = await app.inject({ method: 'GET', url: '/v4/orders/import/template', headers: H() });
    expect(tpl.body).toContain('deliveryAddress.postCode');
    const csv = 'reference,deliveryAddress.contactName,deliveryAddress.line1,deliveryAddress.city,deliveryAddress.postCode,deliveryAddress.country,parcels.1.weight,parcels.1.length,parcels.1.width,parcels.1.height,lines.1.sku,lines.1.quantity\n' +
      'C-1,Ann Lee,1 Road,Manchester,M1 1AA,GB,1,20,20,8,,\n' +
      'C-2,Bob Roe,2 Road,Manchester,M2 2BB,GB,,,,,UNKNOWN-SKU,1\n' +
      'C-3,,3 Road,Manchester,M3 3CC,GB,1,20,20,8,,\n';
    const res = await app.inject({ method: 'POST', url: '/v4/orders/import', headers: H(), payload: { csv } });
    expect(res.statusCode).toBe(200);
    const byRef = Object.fromEntries(res.json().results.map((r: { reference: string }) => [r.reference, r]));
    expect(byRef['C-1'].status).toBe('LABEL_GENERATED');
    expect(byRef['C-2'].status).toBe('UPDATE_PRODUCT');
    expect(byRef['C-2'].missing[0].path).toBe('lines[0].weight');
    expect(res.json().results[2].status).toBe('invalid');
  });
});

describe('billing with a fake Mollie', () => {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  it('starts a subscription and handles paid and failed webhooks', async () => {
    setMollieTransportForTests(async (method, path, body) => {
      calls.push({ method, path, body });
      if (path === '/customers') return { id: 'cst_1' };
      if (path === '/payments') return { id: 'tr_first', status: 'open', _links: { checkout: { href: 'https://mollie.test/checkout/tr_first' } } };
      if (path === '/payments/tr_first') return { id: 'tr_first', status: 'paid', sequenceType: 'first', customerId: 'cst_1', mandateId: 'mdt_1', paidAt: '2026-09-22T10:00:00Z', amount: { value: '15.00' }, metadata: { accountId: acct.accountId } };
      if (path === '/customers/cst_1/subscriptions') return { id: 'sub_1', status: 'active' };
      if (path.startsWith('/payments/tr_fail')) return { id: path.slice(10), status: 'failed', sequenceType: 'recurring', customerId: 'cst_1', amount: { value: '15.00' }, metadata: { accountId: acct.accountId } };
      if (path.startsWith('/customers/cst_1/subscriptions/sub_1')) return { id: 'sub_1', status: 'active' };
      throw new Error(`unexpected ${method} ${path}`);
    });
    const start = await app.inject({ method: 'POST', url: '/v4/billing/start', headers: H(), payload: {} });
    expect(start.json().checkoutUrl).toContain('mollie.test');
    const hook = await app.inject({ method: 'POST', url: '/v4/billing/webhook', payload: 'id=tr_first', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(hook.statusCode).toBe(200);
    let sum = await app.inject({ method: 'GET', url: '/v4/billing', headers: H() });
    expect(sum.json().status).toBe('ACTIVE');
    expect(sum.json().hasMandate).toBe(true);
    expect(sum.json().hasSubscription).toBe(true);
    expect(calls.some((c) => c.path === '/customers/cst_1/subscriptions' && (c.body as { interval: string }).interval === '1 week')).toBe(true);
    for (const id of ['tr_fail1', 'tr_fail2', 'tr_fail3']) await app.inject({ method: 'POST', url: '/v4/billing/webhook', payload: { id } });
    sum = await app.inject({ method: 'GET', url: '/v4/billing', headers: H() });
    expect(sum.json().status).toBe('ARREARS');
    expect(lastMails.some((m) => /payment failed/i.test(m.subject))).toBe(true);
    // Labels are blocked in arrears.
    const blocked = await app.inject({ method: 'POST', url: '/v4/orders', headers: H(), payload: { reference: 'B-1', deliveryAddress: ukAddress, parcels: [{ weight: 1, length: 20, width: 20, height: 8 }] } });
    expect(blocked.statusCode).toBe(402);
    await app.inject({ method: 'POST', url: '/v4/billing/webhook', payload: { id: 'tr_first' } });
    sum = await app.inject({ method: 'GET', url: '/v4/billing', headers: H() });
    expect(sum.json().status).toBe('ACTIVE');
  });
});

describe('admin portal', () => {
  it('signs in an admin, lists accounts, publishes a submitted profile and impersonates', async () => {
    const email = `admin-${Date.now()}@example.test`;
    await new AuthService().createAdmin(email, 'Admin', 'admin-pass-123');
    const si = await app.inject({ method: 'POST', url: '/v4/admin/auth/sign-in', payload: { email, password: 'admin-pass-123' } });
    expect(si.statusCode).toBe(200);
    const A = auth(si.json().token);
    const list = await app.inject({ method: 'GET', url: '/v4/admin/accounts', headers: A });
    expect(list.statusCode).toBe(200);
    const mine = list.json().find((a: { id: string }) => a.id === acct.accountId);
    expect(mine.labels30d).toBeGreaterThan(0);
    const view = await app.inject({ method: 'GET', url: `/v4/admin/accounts/${acct.accountId}`, headers: A });
    expect(view.json().team[0].role).toBe('OWNER');
    // Admin can read the account with the X-Account-Id header.
    const asAcct = await app.inject({ method: 'GET', url: '/v4/orders?all=true', headers: { ...A, 'x-account-id': acct.accountId } });
    expect(asAcct.json().total).toBeGreaterThan(0);
    // Non-admin users cannot reach admin routes.
    const denied = await app.inject({ method: 'GET', url: '/v4/admin/accounts', headers: H() });
    expect(denied.statusCode).toBe(401);
    // Catalogue review.
    const profiles = await app.inject({ method: 'GET', url: '/v4/courier-profiles', headers: H() });
    const own = profiles.json().find((p: { origin: string }) => p.origin === 'own');
    const pub = await app.inject({ method: 'POST', url: `/v4/admin/courier-profiles/${own.id}/publish`, headers: A });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().origin).toBe('shared');
    const other = await signUp(app, 'Other Co');
    const catalogue = await app.inject({ method: 'GET', url: '/v4/courier-profiles', headers: auth(other.token) });
    expect(catalogue.json().some((p: { origin: string; name: string }) => p.origin === 'shared' && p.name === 'Fake DPD')).toBe(true);
    // Impersonation issues a token and emails the owner.
    const imp = await app.inject({ method: 'POST', url: `/v4/admin/accounts/${acct.accountId}/impersonate`, headers: A, payload: { reason: 'Support ticket 42' } });
    expect(imp.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/v4/auth/me', headers: auth(imp.json().token) });
    expect(me.json().account.id).toBe(acct.accountId);
    expect(lastMails.some((m) => /support accessed/i.test(m.subject))).toBe(true);
    const health = await app.inject({ method: 'GET', url: '/v4/admin/health', headers: A });
    expect(health.json().couriers24h.length).toBeGreaterThan(0);
  });
});
