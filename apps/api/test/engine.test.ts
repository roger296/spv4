import { describe, expect, it } from 'vitest';
import { evaluate, getPath, render, renderString } from '../src/couriers/template.js';
import { selectMethod, chargeableWeight, type SelectableMethod } from '../src/modules/labels/selection.js';
import { parseDefinition } from '../src/couriers/profile-schema.js';
import { BUILTIN_PROFILES } from '../src/couriers/builtin/index.js';
import { ConnectorEngine } from '../src/couriers/engine.js';

describe('template', () => {
  const ctx = { order: { contactName: 'Jane Ann Tompkins', country: 'GB', international: false, lines: [{ sku: 'A', quantity: 2, weightKg: 0.5 }, { sku: 'B', quantity: 1, weightKg: 1.25 }] }, parcel: { weightKg: 1.3, lengthCm: 20.4 }, cred: { key: 'abc' } };
  it('reads paths and arrays', () => {
    expect(getPath(ctx, 'order.lines[1].sku')).toBe('B');
    expect(getPath(ctx, 'order.lines.0.quantity')).toBe(2);
    expect(getPath(ctx, 'missing.deep')).toBeUndefined();
  });
  it('applies filters and keeps types for whole expressions', () => {
    expect(renderString('{{ parcel.weightKg | grams }}', ctx)).toBe(1300);
    expect(renderString('{{ parcel.lengthCm | mm }}', ctx)).toBe(204);
    expect(renderString('{{ order.contactName | upper | truncate:8 }}', ctx)).toBe('JANE ANN');
    expect(renderString('{{ order.contactName | first_name }} / {{ order.contactName | last_name }}', ctx)).toBe('Jane Ann / Tompkins');
    expect(renderString('{{ order.country | alpha3 }}', ctx)).toBe('GBR');
    expect(renderString("{{ order.nothing | default:'n/a' }}", ctx)).toBe('n/a');
    expect(evaluate('order.lines | sum:weightKg', ctx)).toBe(1.75);
    expect(evaluate('order.lines | length', ctx)).toBe(2);
  });
  it('renders $map, $if and optional keys', () => {
    const out = render({
      ref: 'X-{{ cred.key }}',
      'company?': '{{ order.company }}',
      items: { $map: 'order.lines', as: 'l', item: { sku: '{{ l.sku }}', qty: '{{ l.quantity | int }}' } },
      customs: { $if: 'order.international', then: { cn22: true }, else: null },
      extra: { $omitIf: 'order.international | not', a: 1 },
    }, ctx) as Record<string, unknown>;
    expect(out).toEqual({ ref: 'X-abc', items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }], customs: null });
  });
});

describe('built-in profiles', () => {
  it('parse against the schema', () => {
    for (const p of BUILTIN_PROFILES) expect(() => parseDefinition(p.definition)).not.toThrow();
  });
  it('map courier statuses', () => {
    const rm = new ConnectorEngine(parseDefinition(BUILTIN_PROFILES[0]!.definition), { id: 'x', credentials: {}, sandbox: false });
    expect(rm.mapStatus('Delivered by Royal Mail')).toEqual({ status: 'DELIVERED', problem: undefined });
    expect(rm.mapStatus('Delivery attempted - no answer')).toEqual({ status: 'PROBLEM', problem: 'delivery_failed' });
    expect(rm.mapStatus('Held at customs')).toEqual({ status: 'PROBLEM', problem: 'held' });
    expect(rm.mapStatus('Something new')).toBeNull();
  });
});

describe('method selection', () => {
  const base: SelectableMethod = {
    id: 'rm48', name: 'RM Tracked 48', courierName: 'Royal Mail', courierAccountId: 'ca1', courierActive: true, serviceCode: 'TPS', originCountry: 'GB', destinationCountries: ['GB'], excludedPostcodePrefixes: [],
    tracked: true, signature: false, express: false, allowsLiquid: true, allowsBatteries: true, allowsFragile: true, maxTransitDays: 2, volumetricDivisor: 5000,
    minWeightKg: 0, maxWeightKg: 20, maxLengthCm: 61, maxGirthCm: null, maxThinnestCm: null, maxDeclaredValue: null, preferred: false, active: true, returnsService: false,
    bands: [{ minWeightKg: 0, maxWeightKg: 1, cost: 3.2 }, { minWeightKg: 1, maxWeightKg: 2, cost: 3.6 }, { minWeightKg: 2, maxWeightKg: 20, cost: 6.5 }], surcharges: [],
  };
  const dpd: SelectableMethod = { ...base, id: 'dpd', name: 'DPD Next Day', courierName: 'DPD', courierAccountId: 'ca2', serviceCode: '1^12', maxTransitDays: 1, maxWeightKg: 30, maxLengthCm: 100, signature: true, bands: [{ minWeightKg: 0, maxWeightKg: 30, cost: 5.5 }], surcharges: [{ name: 'Highlands', kind: 'flat', amount: 12, when: { postcodePrefixes: ['IV', 'KW'] } }] };
  const input = { originCountry: 'GB', destinationCountry: 'GB', postCode: 'M1 1AA', parcels: [{ weightKg: 1.3, lengthCm: 20, widthCm: 20, heightCm: 8 }], promise: 'standard' as const, flags: { signature: false, fragile: false, liquid: false, batteries: false }, declaredValue: 20 };

  it('picks the cheapest fitting method and explains', () => {
    const r = selectMethod([base, dpd], input);
    expect(r.chosen?.methodId).toBe('rm48');
    expect(r.chosen?.cost).toBe(3.6);
    expect(r.reason).toMatch(/cheapest/);
    expect(r.ranked).toHaveLength(2);
  });
  it('honours the delivery promise', () => {
    const r = selectMethod([base, dpd], { ...input, promise: 'next_day' });
    expect(r.chosen?.methodId).toBe('dpd');
    expect(r.dropped[0]?.reason).toMatch(/working days/);
  });
  it('uses volumetric weight and limits', () => {
    expect(chargeableWeight({ weightKg: 1, lengthCm: 50, widthCm: 50, heightCm: 50 }, 5000)).toBe(25);
    const r = selectMethod([base, dpd], { ...input, parcels: [{ weightKg: 1, lengthCm: 50, widthCm: 50, heightCm: 50 }] });
    expect(r.chosen?.methodId).toBe('dpd');
    expect(r.dropped.find((d) => d.methodId === 'rm48')?.reason).toMatch(/over 20 kg/);
  });
  it('applies postcode surcharges and signature requirements', () => {
    const r = selectMethod([base, dpd], { ...input, postCode: 'IV1 1AA', flags: { ...input.flags, signature: true } });
    expect(r.chosen?.methodId).toBe('dpd');
    expect(r.chosen?.cost).toBe(17.5);
  });
  it('drops everything with reasons when nothing fits', () => {
    const r = selectMethod([base, dpd], { ...input, destinationCountry: 'FR' });
    expect(r.chosen).toBeNull();
    expect(r.dropped.every((d) => /does not deliver/.test(d.reason))).toBe(true);
  });
  it('respects a requested method and warns about cheaper', () => {
    const r = selectMethod([base, dpd], { ...input, requestedMethod: 'DPD Next Day' });
    expect(r.chosen?.methodId).toBe('dpd');
    expect(r.reason).toMatch(/requested/);
  });
});
