import { describe, expect, it } from 'vitest';
import { runPreflight } from '../src/modules/orders/preflight.js';
import { toAlpha2, needsCustoms } from '../src/shared/countries.js';
import { generateApiKey, parseApiKey, verifyApiKey } from '../src/shared/api-key.js';
import { checkAddress } from '../src/shared/address-check.js';
import { encrypt, decrypt, encryptJson, decryptJson } from '../src/shared/crypto.js';

const warehouse = { country: 'GB', line1: '1 Test St', postCode: 'SK9 6BH', eori: 'GB123', iossNumber: null, vatNumber: null };
const order = { orderNumber: 'X1', contactName: 'A B', line1: '1 St', city: 'Manchester', postCode: 'M1 1AA', country: 'GB', incoterm: null, declaredValue: null };
const completeProduct = { stockCode: 'SKU1', weight: '0.5', length: '10', width: '10', height: '5', hsCode: null, countryOfOrigin: null, customsDescription: null, unitValue: null };
const line = { sku: 'SKU1', quantity: 1, weight: null, length: null, width: null, height: null, hsCode: null, countryOfOrigin: null, customsDescription: null, unitValue: null };

describe('preflight', () => {
  it('passes a complete UK order', () => {
    const r = runPreflight({ order, lines: [line], parcels: [], products: [completeProduct], warehouse });
    expect(r.status).toBe('NEW');
    expect(r.missing).toEqual([]);
  });
  it('asks for product data when the product is incomplete', () => {
    const r = runPreflight({ order, lines: [line], parcels: [], products: [{ ...completeProduct, weight: null }], warehouse });
    expect(r.status).toBe('UPDATE_PRODUCT');
    expect(r.missing[0]?.path).toBe('lines[0].weight');
    expect(r.missing[0]?.alternatives).toContain('parcels[0].weight');
  });
  it('accepts parcel measurements instead of product data', () => {
    const r = runPreflight({ order, lines: [line], parcels: [{ weight: '1', length: '20', width: '20', height: '8' }], products: [], warehouse });
    expect(r.status).toBe('NEW');
  });
  it('flags a bad address as a problem', () => {
    const r = runPreflight({ order: { ...order, postCode: 'NOPE' }, lines: [line], parcels: [], products: [completeProduct], warehouse });
    expect(r.status).toBe('PROBLEM');
    expect(r.problemReason).toBe('address_failed');
  });
  it('lists customs fields for an international order', () => {
    const r = runPreflight({ order: { ...order, country: 'FR', postCode: '75001', city: 'Paris' }, lines: [line], parcels: [], products: [completeProduct], warehouse });
    expect(r.status).toBe('PROBLEM');
    expect(r.problemReason).toBe('customs_incomplete');
    const paths = r.missing.map((m) => m.path);
    expect(paths).toContain('customs.incoterm');
    expect(paths).toContain('lines[0].hsCode');
    expect(paths).toContain('lines[0].unitValue');
    expect(r.missing.find((m) => m.path === 'customs.incoterm')?.options).toEqual(['DDU', 'DDP']);
  });
  it('product gaps take priority over customs gaps', () => {
    const r = runPreflight({ order: { ...order, country: 'FR', postCode: '75001' }, lines: [line], parcels: [], products: [], warehouse });
    expect(r.status).toBe('UPDATE_PRODUCT');
  });
});

describe('countries', () => {
  it('normalises names and alpha-3', () => {
    expect(toAlpha2('United Kingdom')).toBe('GB');
    expect(toAlpha2('gbr')).toBe('GB');
    expect(toAlpha2('Ireland, Republic of')).toBe('IE');
    expect(toAlpha2('fr')).toBe('FR');
    expect(toAlpha2('Atlantis')).toBeNull();
  });
  it('knows when customs apply', () => {
    expect(needsCustoms('GB', 'GB')).toBe(false);
    expect(needsCustoms('GB', 'FR')).toBe(true);
    expect(needsCustoms('GB', 'JE')).toBe(true);
  });
});

describe('api keys', () => {
  it('round-trips', () => {
    const k = generateApiKey();
    expect(k.raw).toMatch(/^sp_[0-9a-f]{8}_[0-9a-f]{32}$/);
    const parsed = parseApiKey(k.raw)!;
    expect(parsed.prefix).toBe(k.prefix);
    expect(verifyApiKey(parsed.secret, k.hash)).toBe(true);
    expect(verifyApiKey('0'.repeat(32), k.hash)).toBe(false);
  });
});

describe('address check', () => {
  it('accepts a normal UK address', () => {
    expect(checkAddress({ contactName: 'A', line1: '1', city: 'Wilmslow', postCode: 'SK9 6BH', country: 'GB' })).toEqual([]);
  });
  it('rejects a malformed postcode', () => {
    expect(checkAddress({ contactName: 'A', line1: '1', city: 'Wilmslow', postCode: '12345', country: 'GB' })[0]).toMatch(/not a valid GB postcode/);
  });
  it('spots an obviously wrong town', () => {
    expect(checkAddress({ contactName: 'A', line1: '1', city: 'Liverpool', postCode: 'M1 1AA', country: 'GB' })[0]).toMatch(/does not match town/);
  });
  it('allows countries without postcodes', () => {
    expect(checkAddress({ contactName: 'A', line1: '1', city: 'Dubai', postCode: '', country: 'AE' })).toEqual([]);
  });
});

describe('crypto', () => {
  it('encrypts and decrypts', () => {
    const c = encrypt('secret value');
    expect(c.split(':')).toHaveLength(3);
    expect(decrypt(c)).toBe('secret value');
    expect(decryptJson(encryptJson({ user: 'u', password: 'p' }))).toEqual({ user: 'u', password: 'p' });
  });
});
