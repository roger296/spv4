import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, signUp, testApp, ukAddress, type TestAccount } from './helpers.js';
import { closeDatabase } from '../src/config/database.js';

let app: FastifyInstance;
let acct: TestAccount;

beforeAll(async () => {
  app = await testApp();
  acct = await signUp(app);
});
afterAll(async () => {
  await app.close();
  await closeDatabase();
});

describe('auth and account', () => {
  it('signs in and reports the account', async () => {
    const res = await app.inject({ method: 'POST', url: '/v4/auth/sign-in', payload: { email: acct.email, password: 'correct-horse-9' } });
    expect(res.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/v4/auth/me', headers: auth(res.json().token) });
    expect(me.json().account.id).toBe(acct.accountId);
    expect(me.json().user.role).toBe('OWNER');
  });
  it('rejects a wrong password', async () => {
    const res = await app.inject({ method: 'POST', url: '/v4/auth/sign-in', payload: { email: acct.email, password: 'nope-nope-1' } });
    expect(res.statusCode).toBe(401);
  });
  it('invites a team member who can then sign in with a lower role', async () => {
    const inv = await app.inject({ method: 'POST', url: '/v4/team/invite', headers: auth(acct.token), payload: { email: `op-${Date.now()}@example.test`, name: 'Op', role: 'READ_ONLY' } });
    expect(inv.statusCode).toBe(201);
    const acc = await app.inject({ method: 'POST', url: '/v4/auth/accept-invite', payload: { token: inv.json().inviteToken, password: 'another-pass-2' } });
    expect(acc.statusCode).toBe(200);
    const denied = await app.inject({ method: 'POST', url: '/v4/warehouses', headers: auth(acc.json().token), payload: { name: 'X' } });
    expect(denied.statusCode).toBe(403);
  });
  it('issues an API key that works and can be revoked', async () => {
    const created = await app.inject({ method: 'POST', url: '/v4/api-keys', headers: auth(acct.token), payload: { name: 'smmta', scopes: ['orders:read'] } });
    expect(created.statusCode).toBe(201);
    const key = created.json().key as string;
    const ok = await app.inject({ method: 'GET', url: '/v4/orders', headers: auth(key) });
    expect(ok.statusCode).toBe(200);
    const noScope = await app.inject({ method: 'POST', url: '/v4/orders', headers: auth(key), payload: { reference: 'K1', deliveryAddress: ukAddress } });
    expect(noScope.statusCode).toBe(403);
    await app.inject({ method: 'DELETE', url: `/v4/api-keys/${created.json().id}`, headers: auth(acct.token) });
    const gone = await app.inject({ method: 'GET', url: '/v4/orders', headers: auth(key) });
    expect(gone.statusCode).toBe(401);
  });
});

describe('products', () => {
  it('upserts by sku and lists incomplete products', async () => {
    const put = await app.inject({ method: 'PUT', url: '/v4/products/PLA-BLK', headers: auth(acct.token), payload: { name: 'PLA Black', weight: 1.2 } });
    expect(put.statusCode).toBe(200);
    expect(put.json().complete ?? false).toBe(false);
    const inc = await app.inject({ method: 'GET', url: '/v4/products?incomplete=true', headers: auth(acct.token) });
    expect(inc.json().items.map((p: { stockCode: string }) => p.stockCode)).toContain('PLA-BLK');
    const bulk = await app.inject({ method: 'POST', url: '/v4/products/bulk', headers: auth(acct.token), payload: [{ stockCode: 'PLA-BLK', length: 20, width: 20, height: 8 }] });
    expect(bulk.json().results[0].complete).toBe(true);
    const csv = await app.inject({ method: 'POST', url: '/v4/products/import', headers: auth(acct.token), payload: { csv: 'stockCode,name,weight,length,width,height\nPETG-RED,PETG Red,1.25,20,20,8\n' } });
    expect(csv.statusCode).toBe(200);
    expect(csv.json().results[0]).toMatchObject({ sku: 'PETG-RED', created: true, complete: true });
  });
});

describe('orders', () => {
  it('saves an order and asks for missing product data', async () => {
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: auth(acct.token), payload: { reference: 'CO-1', deliveryAddress: ukAddress, lines: [{ sku: 'NEW-SKU', name: 'Mystery', quantity: 2 }] } });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.status).toBe('needs_information');
    expect(body.orderStatus).toBe('UPDATE_PRODUCT');
    expect(body.missing.map((m: { path: string }) => m.path)).toContain('lines[0].weight');
    expect(body.resume).toBe('POST /v4/orders/CO-1/label');
    const got = await app.inject({ method: 'GET', url: '/v4/orders/CO-1', headers: auth(acct.token) });
    expect(got.json().status).toBe('UPDATE_PRODUCT');
    expect(got.json().lines[0].sku).toBe('NEW-SKU');
  });
  it('becomes NEW once the product is completed and the order is re-checked', async () => {
    await app.inject({ method: 'PUT', url: '/v4/products/NEW-SKU', headers: auth(acct.token), payload: { weight: 0.3, length: 10, width: 10, height: 5 } });
    const res = await app.inject({ method: 'POST', url: '/v4/orders/CO-1/label', headers: auth(acct.token) });
    // No courier is configured yet in phase 1, so the pipeline is unavailable: 409, but the order passed pre-flight.
    expect(res.statusCode).toBe(409);
    const got = await app.inject({ method: 'GET', url: '/v4/orders/CO-1', headers: auth(acct.token) });
    expect(got.json().status).toBe('NEW');
  });
  it('is idempotent on reference', async () => {
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: auth(acct.token), payload: { reference: 'CO-1', deliveryAddress: ukAddress, label: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json().duplicate).toBe(true);
  });
  it('accepts parcels instead of product data and saves without a label', async () => {
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: auth(acct.token), payload: { reference: 'CO-2', deliveryAddress: ukAddress, parcels: [{ weight: 1, length: 20, width: 20, height: 8 }], label: false } });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('NEW');
    expect(res.json().parcels).toHaveLength(1);
  });
  it('flags a bad address as a problem with a reason', async () => {
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: auth(acct.token), payload: { reference: 'CO-3', deliveryAddress: { ...ukAddress, postCode: 'ZZ99' }, parcels: [{ weight: 1, length: 20, width: 20, height: 8 }] } });
    expect(res.statusCode).toBe(422);
    const got = await app.inject({ method: 'GET', url: '/v4/orders/CO-3', headers: auth(acct.token) });
    expect(got.json().status).toBe('PROBLEM');
    expect(got.json().problemReason).toBe('address_failed');
    expect(got.json().problems[0].kind).toBe('address_failed');
    // Fixing the address clears it.
    const fixed = await app.inject({ method: 'PATCH', url: '/v4/orders/CO-3', headers: auth(acct.token), payload: { deliveryAddress: { ...ukAddress, postCode: 'M1 1AA' } } });
    expect(fixed.json().status).toBe('NEW');
    expect(fixed.json().problems[0].resolvedAt).not.toBeNull();
  });
  it('lists customs gaps for an international order', async () => {
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: auth(acct.token), payload: { reference: 'CO-4', deliveryAddress: { ...ukAddress, country: 'France', postCode: '75001', city: 'Paris' }, lines: [{ sku: 'PLA-BLK', quantity: 1 }] } });
    expect(res.statusCode).toBe(422);
    const paths = res.json().missing.map((m: { path: string }) => m.path);
    expect(paths).toContain('customs.incoterm');
    expect(paths).toContain('lines[0].hsCode');
  });
  it('shows problem orders first, and searches ignoring spaces and dashes', async () => {
    const list = await app.inject({ method: 'GET', url: '/v4/orders', headers: auth(acct.token) });
    expect(list.json().items[0].status).toBe('PROBLEM');
    const found = await app.inject({ method: 'GET', url: '/v4/orders?q=co2', headers: auth(acct.token) });
    expect(found.json().items.map((o: { orderNumber: string }) => o.orderNumber)).toContain('CO-2');
  });
  it('records notes and views in one history', async () => {
    await app.inject({ method: 'GET', url: '/v4/orders/CO-2', headers: auth(acct.token) });
    await app.inject({ method: 'POST', url: '/v4/orders/CO-2/notes', headers: auth(acct.token), payload: { note: 'Customer rang' } });
    const hist = await app.inject({ method: 'GET', url: '/v4/orders/CO-2/history', headers: auth(acct.token) });
    const kinds = hist.json().map((h: { kind: string }) => h.kind);
    expect(kinds).toContain('note');
    expect(kinds).toContain('view');
    expect(kinds).toContain('action');
  });
  it('cancels an unlabelled order', async () => {
    const res = await app.inject({ method: 'POST', url: '/v4/orders/CO-2/cancel', headers: auth(acct.token), payload: { reason: 'test' } });
    expect(res.json().status).toBe('CANCELLED');
  });
});

describe('tenant isolation', () => {
  it('never shows one account the other account\'s data', async () => {
    const other = await signUp(app, 'Other');
    const res = await app.inject({ method: 'GET', url: '/v4/orders/CO-1', headers: auth(other.token) });
    expect(res.statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/v4/orders?all=true', headers: auth(other.token) });
    expect(list.json().total).toBe(0);
    const prod = await app.inject({ method: 'GET', url: '/v4/products/PLA-BLK', headers: auth(other.token) });
    expect(prod.statusCode).toBe(404);
    const wh = await app.inject({ method: 'PATCH', url: `/v4/warehouses/${acct.warehouseId}`, headers: auth(other.token), payload: { name: 'Hijack' } });
    expect(wh.statusCode).toBe(404);
  });
});
