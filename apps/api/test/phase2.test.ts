import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, signUp, testApp, ukAddress, type TestAccount } from './helpers.js';
import { startFakeCourier, type FakeState } from './fake-courier.js';
import { closeDatabase } from '../src/config/database.js';
import { BUILTIN_PROFILES } from '../src/couriers/builtin/index.js';

let app: FastifyInstance;
let acct: TestAccount;
let fake: { app: FastifyInstance; url: string; state: FakeState };
let cdAccountId: string;
let dpdAccountId: string;
let rmMethodId: string;
let dpdMethodId: string;

beforeAll(async () => {
  app = await testApp();
  acct = await signUp(app, 'Labels Ltd');
  fake = await startFakeCourier();
});
afterAll(async () => {
  await fake.app.close();
  await app.close();
  await closeDatabase();
});

const H = () => auth(acct.token);

describe('courier profiles and accounts', () => {
  it('lists the built-in catalogue', async () => {
    const res = await app.inject({ method: 'GET', url: '/v4/courier-profiles', headers: H() });
    expect(res.statusCode).toBe(200);
    const keys = res.json().map((p: { key: string }) => p.key);
    expect(keys).toContain('royal-mail-click-and-drop');
    expect(keys).toContain('dpd-uk');
  });

  it('creates own profiles pointing at the fake courier (Click & Drop shape, then DPD login shape)', async () => {
    const rm = BUILTIN_PROFILES.find((p) => p.key === 'royal-mail-click-and-drop')!;
    const cd = await app.inject({ method: 'POST', url: '/v4/courier-profiles', headers: H(), payload: { name: 'Fake Click & Drop', definition: { ...rm.definition, baseUrl: `${fake.url}/cd` }, credentialSchema: rm.credentialSchema, services: rm.services } });
    expect(cd.statusCode).toBe(201);
    const dpd = BUILTIN_PROFILES.find((p) => p.key === 'dpd-uk')!;
    const dp = await app.inject({ method: 'POST', url: '/v4/courier-profiles', headers: H(), payload: { name: 'Fake DPD', definition: { ...dpd.definition, baseUrl: `${fake.url}/dpd` }, credentialSchema: dpd.credentialSchema, services: dpd.services } });
    expect(dp.statusCode).toBe(201);

    const a1 = await app.inject({ method: 'POST', url: '/v4/courier-accounts', headers: H(), payload: { profileId: cd.json().id, name: 'Royal Mail', credentials: { apiKey: 'cd-key-123' } } });
    expect(a1.statusCode).toBe(201);
    expect(a1.json().credentialsPreview.apiKey).toBe('••••••');
    cdAccountId = a1.json().id;
    const a2 = await app.inject({ method: 'POST', url: '/v4/courier-accounts', headers: H(), payload: { profileId: dp.json().id, name: 'DPD', credentials: { username: 'dpduser', password: 'dpdpass', accountNumber: 'ACC1' } } });
    expect(a2.statusCode).toBe(201);
    dpdAccountId = a2.json().id;
    const missing = await app.inject({ method: 'POST', url: '/v4/courier-accounts', headers: H(), payload: { profileId: dp.json().id, credentials: { username: 'x' } } });
    expect(missing.statusCode).toBe(400);
  });

  it('tests a connection: header auth and login exchange', async () => {
    const t1 = await app.inject({ method: 'POST', url: `/v4/courier-accounts/${cdAccountId}/test`, headers: H(), payload: { operation: 'auth_test' } });
    expect(t1.json().ok).toBe(true);
    const t2 = await app.inject({ method: 'POST', url: `/v4/courier-accounts/${dpdAccountId}/test`, headers: H(), payload: { operation: 'auth_test' } });
    expect(t2.json().ok).toBe(true);
    expect(fake.state.logins).toBe(1);
    const t3 = await app.inject({ method: 'POST', url: `/v4/courier-accounts/${dpdAccountId}/test`, headers: H(), payload: { operation: 'auth_test' } });
    expect(t3.json().ok).toBe(true);
    expect(fake.state.logins).toBe(1); // session reused
    const bad = await app.inject({ method: 'PATCH', url: `/v4/courier-accounts/${cdAccountId}`, headers: H(), payload: { credentials: { apiKey: 'wrong' } } });
    expect(bad.statusCode).toBe(200);
    const t4 = await app.inject({ method: 'POST', url: `/v4/courier-accounts/${cdAccountId}/test`, headers: H(), payload: { operation: 'auth_test' } });
    expect(t4.json().ok).toBe(false);
    await app.inject({ method: 'PATCH', url: `/v4/courier-accounts/${cdAccountId}`, headers: H(), payload: { credentials: { apiKey: 'cd-key-123' } } });
  });
});

describe('Royal Mail Pro Shipping (v3 REST) profile', () => {
  it('logs in with the IBM client headers, creates and voids a shipment', async () => {
    const pro = BUILTIN_PROFILES.find((p) => p.key === 'royal-mail-pro-shipping')!;
    const prof = await app.inject({ method: 'POST', url: '/v4/courier-profiles', headers: H(), payload: { name: 'Fake RM Pro', definition: { ...pro.definition, baseUrl: `${fake.url}/rmpro` }, credentialSchema: pro.credentialSchema, services: pro.services } });
    expect(prof.statusCode).toBe(201);
    const ca = await app.inject({ method: 'POST', url: '/v4/courier-accounts', headers: H(), payload: { profileId: prof.json().id, name: 'Royal Mail Pro', credentials: { clientId: 'rm-client', clientSecret: 'rm-secret', username: 'rmuser', password: 'rmpass', postingLocation: '1234567890' } } });
    expect(ca.statusCode).toBe(201);
    const logins = fake.state.logins;
    const t = await app.inject({ method: 'POST', url: `/v4/courier-accounts/${ca.json().id}/test`, headers: H(), payload: { operation: 'auth_test' } });
    expect(t.json().ok).toBe(true);
    expect(fake.state.logins).toBe(logins + 1);
    const m = await app.inject({ method: 'POST', url: '/v4/methods', headers: H(), payload: { courierAccountId: ca.json().id, name: 'RM Pro Tracked 24', serviceCode: 'TPN', destinationCountries: ['GB'], maxTransitDays: 1, bands: [{ minWeightKg: 0, maxWeightKg: 20, cost: 2.9 }] } });
    expect(m.statusCode).toBe(201);
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: H(), payload: { reference: 'PRO-1', deliveryAddress: ukAddress, parcels: [{ weight: 0.9, length: 20, width: 15, height: 10 }], method: 'RM Pro Tracked 24' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().courierName).toBe('Royal Mail Pro');
    expect(res.json().trackingNumber).toMatch(/^RM\d+GB$/);
    expect(res.json().trackingLink).toBe(res.json().shipments[0].trackingUrl);
    expect(fake.state.logins).toBe(logins + 1); // token reused
    const sent = fake.state.created.at(-1)?.body as { shipper: { shipperReference: string; postcode: string }; destination: { postcode: string; countryCode: string }; shipmentInformation: { serviceCode: string; totalPackages: number; totalWeight: number; packages: { packageOccurrence: number; weight: number }[]; serviceOptions: { postingLocation: string } } };
    expect(sent.shipper.shipperReference).toBe('PRO-1');
    expect(sent.shipper.postcode).toBe('SK9 6BH');
    expect(sent.destination).toMatchObject({ postcode: 'M1 1AA', countryCode: 'GB' });
    expect(sent.shipmentInformation).toMatchObject({ serviceCode: 'TPN', totalPackages: 1, totalWeight: 0.9 });
    expect(sent.shipmentInformation.packages[0]).toMatchObject({ packageOccurrence: 1, weight: 0.9 });
    expect(sent.shipmentInformation.serviceOptions.postingLocation).toBe('1234567890');
    const cancel = await app.inject({ method: 'POST', url: '/v4/orders/PRO-1/cancel', headers: H() });
    expect(cancel.json().status).toBe('CANCELLED');
    expect(fake.state.voided.at(-1)).toBe(res.json().shipments[0].courierReference);
    await app.inject({ method: 'PATCH', url: `/v4/courier-accounts/${ca.json().id}`, headers: H(), payload: { active: false } });
  });
});

describe('shipping methods', () => {
  it('creates methods from services and sets append-only bands', async () => {
    const fs = await app.inject({ method: 'POST', url: '/v4/methods/from-services', headers: H(), payload: { courierAccountId: cdAccountId, serviceCodes: ['TPS', 'TPN'] } });
    expect(fs.statusCode).toBe(201);
    expect(fs.json()).toHaveLength(2);
    rmMethodId = fs.json().find((m: { serviceCode: string }) => m.serviceCode === 'TPS').id;
    const b1 = await app.inject({ method: 'PUT', url: `/v4/methods/${rmMethodId}/bands`, headers: H(), payload: { bands: [{ minWeightKg: 0, maxWeightKg: 1, cost: 3.2 }, { minWeightKg: 1, maxWeightKg: 2, cost: 3.6 }, { minWeightKg: 2, maxWeightKg: 20, cost: 6.5 }], effectiveFrom: '2026-01-01' } });
    expect(b1.statusCode).toBe(200);
    const b2 = await app.inject({ method: 'PUT', url: `/v4/methods/${rmMethodId}/bands`, headers: H(), payload: { bands: [{ minWeightKg: 0, maxWeightKg: 1, cost: 3.4 }, { minWeightKg: 1, maxWeightKg: 2, cost: 3.9 }, { minWeightKg: 2, maxWeightKg: 20, cost: 6.9 }], effectiveFrom: '2026-09-01', note: 'Fuel surcharge' } });
    expect(b2.json()).toHaveLength(6); // history keeps both sets
    const list = await app.inject({ method: 'GET', url: '/v4/methods', headers: H() });
    const rm = list.json().find((m: { id: string }) => m.id === rmMethodId);
    expect(rm.currentBands.map((b: { cost: number }) => b.cost)).toEqual([3.4, 3.9, 6.9]);
    const overlap = await app.inject({ method: 'PUT', url: `/v4/methods/${rmMethodId}/bands`, headers: H(), payload: { bands: [{ minWeightKg: 0, maxWeightKg: 2, cost: 1 }, { minWeightKg: 1, maxWeightKg: 3, cost: 2 }] } });
    expect(overlap.statusCode).toBe(400);
    const dm = await app.inject({ method: 'POST', url: '/v4/methods', headers: H(), payload: { courierAccountId: dpdAccountId, name: 'DPD Next Day', serviceCode: '1^12', destinationCountries: ['GB'], maxTransitDays: 1, signature: true, maxWeightKg: 30, bands: [{ minWeightKg: 0, maxWeightKg: 30, cost: 5.5 }] } });
    expect(dm.statusCode).toBe(201);
    dpdMethodId = dm.json().id;
  });

  it('quotes without an order', async () => {
    const q = await app.inject({ method: 'POST', url: '/v4/quotes', headers: H(), payload: { deliveryAddress: { country: 'GB', postCode: 'M1 1AA' }, parcels: [{ weight: 1.3, length: 20, width: 20, height: 8 }] } });
    expect(q.statusCode).toBe(200);
    expect(q.json().chosen.cost).toBe(3.9);
    expect(q.json().ranked.map((r: { name: string }) => r.name)).toContain('DPD Next Day');
    const nd = await app.inject({ method: 'POST', url: '/v4/quotes', headers: H(), payload: { deliveryAddress: { country: 'GB' }, parcels: [{ weight: 1.3, length: 20, width: 20, height: 8 }], deliveryPromise: 'next_day' } });
    expect(nd.json().chosen.name).toBe('DPD Next Day');
  });

  it('exports and imports the CSV template', async () => {
    const ex = await app.inject({ method: 'GET', url: '/v4/methods/export', headers: H() });
    expect(ex.statusCode).toBe(200);
    expect(ex.body).toContain('ShipingMethodName');
    const csv = 'ShipingMethodName,CourierAccount,ServiceCode,MinWeight,MaxWeight,BaseCost,MaxTransit,StartCountry,DeliveryCountry\nRM Large Letter,Royal Mail,BPL2,0,750,1.55,3,GB,GB\n';
    const im = await app.inject({ method: 'POST', url: '/v4/methods/import', headers: H(), payload: { csv } });
    expect(im.statusCode).toBe(200);
    expect(im.json().results[0]).toMatchObject({ name: 'RM Large Letter', created: true, bands: 1 });
  });
});

describe('labels', () => {
  it('buys a label in one call, storing documents on stationery', async () => {
    await app.inject({ method: 'PUT', url: '/v4/products/SPOOL', headers: H(), payload: { name: 'PLA spool', weight: 1.2, length: 20, width: 20, height: 8, unitValue: 18 } });
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: H(), payload: { reference: 'L-1', deliveryAddress: ukAddress, lines: [{ sku: 'SPOOL', quantity: 1 }] } });
    expect(res.statusCode).toBe(201);
    const o = res.json();
    expect(o.status).toBe('LABEL_GENERATED');
    expect(o.courierName).toBe('Royal Mail');
    expect(o.methodName).toMatch(/Tracked 48/);
    expect(o.cost).toBe('3.90');
    expect(o.trackingNumber).toMatch(/^TT\d+GB$/);
    expect(o.trackingLink).toContain('royalmail.com');
    expect(o.selection.reason).toMatch(/cheapest/);
    expect(o.parcels[0].estimated).toBe(true);
    expect(o.parcels[0].weight).toBe('1.250'); // 1.2 kg + 50 g packaging
    const kinds = o.documents.map((d: { kind: string }) => d.kind).sort();
    expect(kinds).toEqual(['label', 'packing_note']);
    expect(fake.state.created.at(-1)?.flavour).toBe('cd');
    const sent = fake.state.created.at(-1)?.body as { items: { recipient: { address: { postcode: string } }; packages: { weightInGrams: number }[] }[] };
    expect(sent.items[0]!.recipient.address.postcode).toBe('M1 1AA');
    expect(sent.items[0]!.packages[0]!.weightInGrams).toBe(1250);

    const pdf = await app.inject({ method: 'GET', url: `${o.documents[0].url}?token=${acct.token}` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const print = await app.inject({ method: 'GET', url: '/v4/orders/L-1/print', headers: H() });
    expect(print.statusCode).toBe(200);
    const batch = await app.inject({ method: 'POST', url: '/v4/orders/print', headers: H(), payload: { references: ['L-1'] } });
    expect(batch.statusCode).toBe(200);
  });

  it('re-labels with another method, voiding the first shipment', async () => {
    const voidedBefore = fake.state.voided.length;
    const res = await app.inject({ method: 'POST', url: '/v4/orders/L-1/relabel', headers: H(), payload: { method: 'DPD Next Day' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().courierName).toBe('DPD');
    expect(res.json().shipments).toHaveLength(2);
    expect(res.json().shipments.find((s: { attempt: number }) => s.attempt === 1).status).toBe('VOID');
    expect(fake.state.voided).toHaveLength(voidedBefore + 1);
    expect(fake.state.labelFetches).toBeGreaterThan(0); // DPD label fetched by a second call
    const hist = await app.inject({ method: 'GET', url: '/v4/orders/L-1/history', headers: H() });
    expect(hist.json().map((h: { action: string }) => h.action)).toContain('shipment.voided');
  });

  it('cancelling a labelled order voids it', async () => {
    const voidedBefore = fake.state.voided.length;
    const res = await app.inject({ method: 'POST', url: '/v4/orders/L-1/cancel', headers: H() });
    expect(res.json().status).toBe('CANCELLED');
    expect(fake.state.voided).toHaveLength(voidedBefore + 1);
  });

  it('records a courier rejection as a problem the caller can read', async () => {
    fake.state.failNextCreate = { status: 400, message: 'Postcode not served' };
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: H(), payload: { reference: 'L-2', deliveryAddress: ukAddress, parcels: [{ weight: 1, length: 20, width: 20, height: 8 }], deliveryPromise: 'economy', method: 'Royal Mail Tracked 48' } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('courier_rejected');
    expect(res.json().error.message).toContain('Postcode not served');
    const got = await app.inject({ method: 'GET', url: '/v4/orders/L-2', headers: H() });
    expect(got.json().status).toBe('PROBLEM');
    expect(got.json().problemReason).toBe('courier_error');
    expect(got.json().shipments[0].status).toBe('FAILED');
    // Try again succeeds and clears the problem.
    const again = await app.inject({ method: 'POST', url: '/v4/orders/L-2/label', headers: H() });
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe('LABEL_GENERATED');
  });

  it('returns no_method with reasons when nothing fits', async () => {
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: H(), payload: { reference: 'L-3', deliveryAddress: ukAddress, parcels: [{ weight: 40, length: 20, width: 20, height: 8 }] } });
    expect(res.statusCode).toBe(422);
    expect(res.json().status).toBe('no_method');
    expect(res.json().dropped.some((d: { reason: string }) => /over 30 kg/.test(d.reason))).toBe(true);
  });

  it('creates a return label back to the warehouse', async () => {
    await app.inject({ method: 'POST', url: '/v4/orders/L-2/shipped', headers: H() });
    const res = await app.inject({ method: 'POST', url: '/v4/orders/L-2/return-label', headers: H() });
    expect(res.statusCode).toBe(200);
    expect(res.json().trackingNumber).toBeTruthy();
    const kinds = res.json().order.documents.map((d: { kind: string }) => d.kind);
    expect(kinds).toContain('return_label');
    const sent = fake.state.created.at(-1)?.body as { items: { recipient: { address: { postcode: string } } }[] };
    expect(sent.items[0]!.recipient.address.postcode).toBe('SK9 6BH'); // the warehouse
  });

  it('generates a customs invoice for an international order', async () => {
    await app.inject({ method: 'PATCH', url: `/v4/warehouses/${acct.warehouseId}`, headers: H(), payload: { eori: 'GB123456789000' } });
    await app.inject({ method: 'PATCH', url: `/v4/methods/${rmMethodId}`, headers: H(), payload: { destinationCountries: ['GB', 'FR'], maxTransitDays: 5 } });
    const res = await app.inject({ method: 'POST', url: '/v4/orders', headers: H(), payload: {
      reference: 'L-4', deliveryAddress: { ...ukAddress, country: 'FR', postCode: '75001', city: 'Paris' }, deliveryPromise: 'economy',
      lines: [{ sku: 'SPOOL', quantity: 2, hsCode: '39169090', countryOfOrigin: 'CN', customsDescription: '3D printer filament', unitValue: 18 }], customs: { incoterm: 'DDU' },
    } });
    expect(res.statusCode).toBe(201);
    expect(res.json().documents.map((d: { kind: string }) => d.kind)).toContain('customs_invoice');
    const sent = fake.state.created.at(-1)?.body as { items: { packages: { contents?: unknown[] }[]; label: { includeCN: boolean } }[] };
    expect(sent.items[0]!.packages[0]!.contents).toHaveLength(1);
    expect(sent.items[0]!.label.includeCN).toBe(true);
  });
});
