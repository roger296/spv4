import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { auth, signUp, testApp, type TestAccount } from './helpers.js';
import { startFakeCourier, type FakeState } from './fake-courier.js';
import { closeDatabase } from '../src/config/database.js';
import { BUILTIN_PROFILES } from '../src/couriers/builtin/index.js';
import { setProductSearchTransportForTests } from '../src/modules/ai/product-data.js';
import { matchInvoice } from '../src/modules/ai/invoice-reconciliation.js';
import { systemCtx } from '../src/shared/context.js';

let app: FastifyInstance;
let acct: TestAccount;
let fake: { app: FastifyInstance; url: string; state: FakeState };
let accessToken: string;

beforeAll(async () => {
  app = await testApp();
  acct = await signUp(app, 'MCP Ltd');
  fake = await startFakeCourier();
  const rm = BUILTIN_PROFILES.find((p) => p.key === 'royal-mail-click-and-drop')!;
  const prof = await app.inject({ method: 'POST', url: '/v4/courier-profiles', headers: auth(acct.token), payload: { name: 'Fake RM', definition: { ...rm.definition, baseUrl: `${fake.url}/cd` }, credentialSchema: rm.credentialSchema, services: rm.services } });
  const ca = await app.inject({ method: 'POST', url: '/v4/courier-accounts', headers: auth(acct.token), payload: { profileId: prof.json().id, name: 'Royal Mail', credentials: { apiKey: 'cd-key-123' } } });
  await app.inject({ method: 'POST', url: '/v4/methods', headers: auth(acct.token), payload: { courierAccountId: ca.json().id, name: 'RM Tracked 48', serviceCode: 'TPS', destinationCountries: ['GB'], maxTransitDays: 2, bands: [{ minWeightKg: 0, maxWeightKg: 20, cost: 3.5 }] } });
  await app.inject({ method: 'POST', url: '/v4/address-book', headers: auth(acct.token), payload: { label: 'Mum', contactName: 'Margaret Butterworth', line1: '1 Example Lane', city: 'Macclesfield', postCode: 'SK10 1AA', country: 'GB', phone: '01625111111' } });
});
afterAll(async () => {
  setProductSearchTransportForTests(null);
  await fake.app.close();
  await app.close();
  await closeDatabase();
});

async function rpc(method: string, params: Record<string, unknown>, token = accessToken) {
  const res = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, payload: { jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method, params } });
  expect(res.statusCode).toBe(200);
  // Streamable HTTP may answer as SSE; take the last data: line.
  const text = res.body;
  const line = text.split('\n').filter((l) => l.startsWith('data:')).pop();
  return JSON.parse(line ? line.slice(5) : text);
}

describe('OAuth for MCP clients', () => {
  it('discovers, registers, signs in with PKCE and gets a token that works', async () => {
    const meta = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });
    expect(meta.json().code_challenge_methods_supported).toEqual(['S256']);
    const reg = await app.inject({ method: 'POST', url: '/mcp/oauth/register', payload: { client_name: 'Claude Cowork', redirect_uris: ['https://client.test/callback'] } });
    expect(reg.statusCode).toBe(201);
    const clientId = reg.json().client_id as string;
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const page = await app.inject({ method: 'GET', url: `/mcp/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://client.test/callback')}&response_type=code&state=xyz&code_challenge=${challenge}&code_challenge_method=S256` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Connect Claude Cowork');
    const wrong = await app.inject({ method: 'POST', url: '/mcp/oauth/authorize', payload: { client_id: clientId, redirect_uri: 'https://client.test/callback', response_type: 'code', state: 'xyz', code_challenge: challenge, code_challenge_method: 'S256', email: acct.email, password: 'wrong-password-1' } });
    expect(wrong.statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/mcp/oauth/authorize', payload: { client_id: clientId, redirect_uri: 'https://client.test/callback', response_type: 'code', state: 'xyz', code_challenge: challenge, code_challenge_method: 'S256', email: acct.email, password: 'correct-horse-9' } });
    expect(login.statusCode).toBe(302);
    const loc = new URL(login.headers.location as string);
    expect(loc.searchParams.get('state')).toBe('xyz');
    const code = loc.searchParams.get('code')!;
    const bad = await app.inject({ method: 'POST', url: '/mcp/oauth/token', payload: { grant_type: 'authorization_code', code, redirect_uri: 'https://client.test/callback', client_id: clientId, code_verifier: 'not-the-verifier-at-all-12345' } });
    expect(bad.statusCode).toBe(400);
    const tok = await app.inject({ method: 'POST', url: '/mcp/oauth/token', payload: { grant_type: 'authorization_code', code, redirect_uri: 'https://client.test/callback', client_id: clientId, code_verifier: verifier } });
    expect(tok.statusCode).toBe(200);
    accessToken = tok.json().access_token;
    expect(accessToken).toMatch(/^sp_/);
    // Codes are single use.
    const reuse = await app.inject({ method: 'POST', url: '/mcp/oauth/token', payload: { grant_type: 'authorization_code', code, redirect_uri: 'https://client.test/callback', client_id: clientId, code_verifier: verifier } });
    expect(reuse.statusCode).toBe(400);
    // The connection shows on the Integrations page as an MCP key.
    const keys = await app.inject({ method: 'GET', url: '/v4/api-keys', headers: auth(acct.token) });
    expect(keys.json().some((k: { kind: string; clientName: string }) => k.kind === 'mcp' && k.clientName === 'Claude Cowork')).toBe(true);
    const unauth = await app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.headers['www-authenticate']).toContain('resource_metadata');
  });
});

describe('MCP tools', () => {
  it('lists tools and ships a parcel to mum', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(init.result.serverInfo.name).toBe('smooth-parcel');
    const list = await rpc('tools/list', {});
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['find_recipient', 'quote_shipment', 'create_shipment', 'get_shipment', 'update_product', 'update_method_bands', 'draft_courier_profile']));
    const found = await rpc('tools/call', { name: 'find_recipient', arguments: { query: 'mum' } });
    const hit = JSON.parse(found.result.content[0].text);
    expect(hit.addressBook[0].contactName).toBe('Margaret Butterworth');
    const quote = await rpc('tools/call', { name: 'quote_shipment', arguments: { country: 'GB', postCode: hit.addressBook[0].postCode, parcels: [{ weight: 1.5, length: 30, width: 20, height: 10 }] } });
    expect(JSON.parse(quote.result.content[0].text).chosen.cost).toBe(3.5);
    const a = hit.addressBook[0];
    const created = await rpc('tools/call', { name: 'create_shipment', arguments: { reference: 'MUM-1', deliveryAddress: { contactName: a.contactName, line1: a.line1, city: a.city, postCode: a.postCode, country: a.country, phone: a.phone }, parcels: [{ weight: 1.5, length: 30, width: 20, height: 10 }] } });
    const shipped = JSON.parse(created.result.content[0].text);
    expect(shipped.order.status).toBe('LABEL_GENERATED');
    expect(shipped.order.trackingNumber).toMatch(/^TT/);
    expect(shipped.order.documents.some((d: { kind: string }) => d.kind === 'label')).toBe(true);
    const doc = await rpc('tools/call', { name: 'get_document', arguments: { reference: 'MUM-1', kind: 'label', inline: true } });
    expect(JSON.parse(doc.result.content[0].text).base64.startsWith('JVBERi')).toBe(true);
    const hist = await app.inject({ method: 'GET', url: '/v4/orders/MUM-1/history', headers: auth(acct.token) });
    expect(hist.json().some((h: { clientName: string }) => h.clientName === 'Claude Cowork')).toBe(true);
  });

  it('asks for missing information instead of failing', async () => {
    const r = await rpc('tools/call', { name: 'create_shipment', arguments: { reference: 'MUM-2', deliveryAddress: { contactName: 'M B', line1: '1 Example Lane', city: 'Macclesfield', postCode: 'SK10 1AA', country: 'GB' }, lines: [{ sku: 'GIFT', name: 'Gift', quantity: 1 }] } });
    expect(r.result.isError).toBe(true);
    const body = JSON.parse(r.result.content[0].text);
    expect(body.status).toBe('needs_information');
    expect(body.missing[0].path).toBe('lines[0].weight');
    const upd = await rpc('tools/call', { name: 'update_product', arguments: { products: [{ sku: 'GIFT', weight: 0.4, length: 15, width: 10, height: 5, confidence: 0.9, sourceUrl: 'https://example.com/gift' }] } });
    expect(JSON.parse(upd.result.content[0].text).results[0].complete).toBe(true);
    const bought = await rpc('tools/call', { name: 'buy_label', arguments: { reference: 'MUM-2' } });
    expect(JSON.parse(bought.result.content[0].text).order.status).toBe('LABEL_GENERATED');
    const suggestion = await rpc('tools/call', { name: 'update_product', arguments: { products: [{ sku: 'GIFT2', name: 'Gift 2', weight: 0.5, length: 10, width: 10, height: 10, confidence: 0.4 }], asSuggestion: true } });
    expect(JSON.parse(suggestion.result.content[0].text).results[0].suggested).toBe(true);
    const p = await app.inject({ method: 'GET', url: '/v4/products/GIFT2', headers: auth(acct.token) });
    expect(p.json().suggested.confidence).toBe(0.4);
    expect(p.json().complete).toBe(false);
    const accepted = await app.inject({ method: 'POST', url: '/v4/products/GIFT2/accept-suggestion', headers: auth(acct.token) });
    expect(accepted.json().complete).toBe(true);
  });

  it('updates cost bands with attribution and refuses without scope', async () => {
    const methods = JSON.parse((await rpc('tools/call', { name: 'list_methods', arguments: {} })).result.content[0].text);
    const r = await rpc('tools/call', { name: 'update_method_bands', arguments: { methodId: methods[0].id, bands: [{ minWeightKg: 0, maxWeightKg: 20, cost: 3.85 }], note: 'Fuel surcharge from September invoice' } });
    expect(r.result.isError).toBeFalsy();
    const bands = await app.inject({ method: 'GET', url: `/v4/methods/${methods[0].id}/bands`, headers: auth(acct.token) });
    expect(bands.json()[0].source).toBe('invoice_reconciliation');
    const limited = await app.inject({ method: 'POST', url: '/v4/api-keys', headers: auth(acct.token), payload: { name: 'read only', scopes: ['orders:read'], kind: 'mcp' } });
    const denied = await rpc('tools/call', { name: 'update_method_bands', arguments: { methodId: methods[0].id, bands: [{ minWeightKg: 0, maxWeightKg: 20, cost: 1 }] } }, limited.json().key);
    expect(denied.result.isError).toBe(true);
    expect(JSON.parse(denied.result.content[0].text).error).toBe('forbidden');
  });
});

describe('AI product data with a fake model', () => {
  it('stores suggestions, or applies them above the trust threshold', async () => {
    setProductSearchTransportForTests(async () => ({ content: [{ type: 'text', text: JSON.stringify({ products: [{ sku: 'NOZZLE', weightKg: 0.02, lengthCm: 5, widthCm: 3, heightCm: 1, confidence: 0.9, sourceUrl: 'https://maker.test/nozzle' }, { sku: 'MYSTERY', confidence: 0 }] }) }], usage: { input_tokens: 500, output_tokens: 100 } }));
    await app.inject({ method: 'PUT', url: '/v4/products/NOZZLE', headers: auth(acct.token), payload: { name: 'Brass nozzle' } });
    await app.inject({ method: 'PUT', url: '/v4/products/MYSTERY', headers: auth(acct.token), payload: { name: 'Unknown thing' } });
    let r = await app.inject({ method: 'POST', url: '/v4/ai/product-data', headers: auth(acct.token), payload: { skus: ['NOZZLE', 'MYSTERY'] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().suggested).toBe(1);
    let p = await app.inject({ method: 'GET', url: '/v4/products/NOZZLE', headers: auth(acct.token) });
    expect(p.json().suggested.confidence).toBe(0.9);
    await app.inject({ method: 'PATCH', url: '/v4/account', headers: auth(acct.token), payload: { settings: { trustAiAboveConfidence: 0.8 } } });
    r = await app.inject({ method: 'POST', url: '/v4/ai/product-data', headers: auth(acct.token), payload: { skus: ['NOZZLE'] } });
    expect(r.json().applied).toBe(1);
    p = await app.inject({ method: 'GET', url: '/v4/products/NOZZLE', headers: auth(acct.token) });
    expect(p.json().complete).toBe(true);
    expect(p.json().dataSource).toBe('ai_suggested');
  });
});

describe('invoice reconciliation matching', () => {
  it('matches invoice lines to shipments and proposes band changes', async () => {
    const order = (await app.inject({ method: 'GET', url: '/v4/orders/MUM-1', headers: auth(acct.token) })).json();
    const r = await matchInvoice(systemCtx(acct.accountId), {
      invoice: { courier: 'Royal Mail', number: 'INV-1', date: '2026-09-30', currency: 'GBP', total: 4.1 },
      lines: [{ trackingNumber: order.trackingNumber, service: 'Tracked 48', baseCharge: 3.5, surcharges: [{ name: 'Fuel surcharge', amount: 0.6 }], total: 4.1 }, { trackingNumber: 'UNKNOWN1', total: 9 }],
    });
    expect(r.unmatched).toBe(1);
    expect(r.overcharged).toBe(1);
    expect(r.matches[0]!.difference).toBe(0.6);
    expect(r.proposals[0]!.suggestion).toMatch(/Raise every band by 0.60/);
    expect(r.proposals[0]!.surcharges[0]).toMatchObject({ name: 'Fuel surcharge', amount: 0.6 });
  });
});
