import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { getDb } from '../../config/database.js';
import { courierAccounts, courierProfiles, laneDefaults, shippingMethodBands, shippingMethods, type SurchargeRule } from '../../db/schema/index.js';
import { audit, diff } from '../../shared/audit.js';
import type { Ctx } from '../../shared/context.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { toAlpha2 } from '../../shared/countries.js';
import type { SelectableMethod } from '../labels/selection.js';

export type MethodRow = typeof shippingMethods.$inferSelect;
export type BandRow = typeof shippingMethodBands.$inferSelect;

export interface BandInput { minWeightKg: number; maxWeightKg: number; cost: number }

export interface MethodInput {
  courierAccountId: string;
  name: string;
  serviceCode: string;
  originCountry?: string;
  destinationCountries?: string[];
  excludedPostcodePrefixes?: string[];
  tracked?: boolean; signature?: boolean; express?: boolean;
  allowsLiquid?: boolean; allowsBatteries?: boolean; allowsFragile?: boolean; returnsService?: boolean;
  maxTransitDays?: number; volumetricDivisor?: number;
  minWeightKg?: number; maxWeightKg?: number;
  maxLengthCm?: number | null; maxGirthCm?: number | null; maxThinnestCm?: number | null; maxDeclaredValue?: number | null;
  preferred?: boolean; active?: boolean;
  surcharges?: SurchargeRule[];
  bands?: BandInput[];
}

const s = (v: number | null | undefined) => (v === undefined ? undefined : v === null ? null : String(v));
const today = () => new Date().toISOString().slice(0, 10);

export class MethodsService {
  private db = getDb();

  private async courierAccount(ctx: Ctx, id: string) {
    const [row] = await this.db.select({ account: courierAccounts, profile: { name: courierProfiles.name, services: courierProfiles.services } })
      .from(courierAccounts).innerJoin(courierProfiles, eq(courierProfiles.id, courierAccounts.profileId))
      .where(and(eq(courierAccounts.id, id), eq(courierAccounts.accountId, ctx.accountId), isNull(courierAccounts.deletedAt))).limit(1);
    if (!row) throw new NotFoundError('courier account', id);
    return row;
  }

  /** Bands effective on a date: the latest effective_from per weight range. */
  async bandsOn(methodIds: string[], date = today()): Promise<Map<string, { minWeightKg: number; maxWeightKg: number; cost: number; effectiveFrom: string }[]>> {
    const out = new Map<string, { minWeightKg: number; maxWeightKg: number; cost: number; effectiveFrom: string }[]>();
    if (!methodIds.length) return out;
    const rows = await this.db.select().from(shippingMethodBands).where(and(inArray(shippingMethodBands.methodId, methodIds), lte(shippingMethodBands.effectiveFrom, date))).orderBy(desc(shippingMethodBands.effectiveFrom), desc(shippingMethodBands.createdAt));
    for (const r of rows) {
      const list = out.get(r.methodId) ?? [];
      const key = `${r.minWeightKg}-${r.maxWeightKg}`;
      if (list.some((b) => `${b.minWeightKg}-${b.maxWeightKg}` === key)) continue; // a later row already covers this range
      // A newer band set replaces older ones entirely when effective dates differ.
      if (list.length && list[0]!.effectiveFrom !== r.effectiveFrom) continue;
      list.push({ minWeightKg: Number(r.minWeightKg), maxWeightKg: Number(r.maxWeightKg), cost: Number(r.cost), effectiveFrom: r.effectiveFrom });
      out.set(r.methodId, list);
    }
    for (const list of out.values()) list.sort((a, b) => a.minWeightKg - b.minWeightKg);
    return out;
  }

  async list(ctx: Ctx) {
    const rows = await this.db.select({ m: shippingMethods, courierName: courierAccounts.name, courierActive: courierAccounts.active, profileName: courierProfiles.name })
      .from(shippingMethods)
      .innerJoin(courierAccounts, eq(courierAccounts.id, shippingMethods.courierAccountId))
      .innerJoin(courierProfiles, eq(courierProfiles.id, courierAccounts.profileId))
      .where(and(eq(shippingMethods.accountId, ctx.accountId), isNull(shippingMethods.deletedAt)))
      .orderBy(asc(courierAccounts.name), asc(shippingMethods.name));
    const bands = await this.bandsOn(rows.map((r) => r.m.id));
    return rows.map((r) => ({ ...r.m, courierName: r.courierName, courierActive: r.courierActive, profileName: r.profileName, currentBands: bands.get(r.m.id) ?? [] }));
  }

  /** Everything the selector needs, for one origin. */
  async selectable(ctx: Ctx, shippingDate = today()): Promise<SelectableMethod[]> {
    const rows = await this.list(ctx);
    const bands = await this.bandsOn(rows.map((r) => r.id), shippingDate);
    return rows.map((r) => ({
      id: r.id, name: r.name, courierName: r.courierName, courierAccountId: r.courierAccountId, courierActive: r.courierActive, serviceCode: r.serviceCode,
      originCountry: r.originCountry, destinationCountries: r.destinationCountries, excludedPostcodePrefixes: r.excludedPostcodePrefixes,
      tracked: r.tracked, signature: r.signature, express: r.express, allowsLiquid: r.allowsLiquid, allowsBatteries: r.allowsBatteries, allowsFragile: r.allowsFragile,
      maxTransitDays: r.maxTransitDays, volumetricDivisor: r.volumetricDivisor, minWeightKg: Number(r.minWeightKg), maxWeightKg: Number(r.maxWeightKg),
      maxLengthCm: r.maxLengthCm === null ? null : Number(r.maxLengthCm), maxGirthCm: r.maxGirthCm === null ? null : Number(r.maxGirthCm), maxThinnestCm: r.maxThinnestCm === null ? null : Number(r.maxThinnestCm),
      maxDeclaredValue: r.maxDeclaredValue === null ? null : Number(r.maxDeclaredValue), preferred: r.preferred, active: r.active, returnsService: r.returnsService,
      bands: (bands.get(r.id) ?? []).map(({ minWeightKg, maxWeightKg, cost }) => ({ minWeightKg, maxWeightKg, cost })),
      surcharges: r.surcharges,
    }));
  }

  async get(ctx: Ctx, id: string) {
    const [m] = await this.db.select().from(shippingMethods).where(and(eq(shippingMethods.id, id), eq(shippingMethods.accountId, ctx.accountId), isNull(shippingMethods.deletedAt))).limit(1);
    if (!m) throw new NotFoundError('shipping method', id);
    return m;
  }

  async create(ctx: Ctx, input: MethodInput) {
    const ca = await this.courierAccount(ctx, input.courierAccountId);
    const [m] = await this.db.insert(shippingMethods).values({
      accountId: ctx.accountId, courierAccountId: input.courierAccountId, name: input.name.trim(), serviceCode: input.serviceCode.trim(),
      originCountry: (input.originCountry ?? 'GB').toUpperCase(), destinationCountries: (input.destinationCountries ?? []).map((c) => toAlpha2(c) ?? c.toUpperCase()),
      excludedPostcodePrefixes: input.excludedPostcodePrefixes ?? [],
      tracked: input.tracked ?? true, signature: input.signature ?? false, express: input.express ?? false,
      allowsLiquid: input.allowsLiquid ?? true, allowsBatteries: input.allowsBatteries ?? true, allowsFragile: input.allowsFragile ?? true, returnsService: input.returnsService ?? false,
      maxTransitDays: input.maxTransitDays ?? 3, volumetricDivisor: input.volumetricDivisor ?? 5000,
      minWeightKg: String(input.minWeightKg ?? 0), maxWeightKg: String(input.maxWeightKg ?? 30),
      maxLengthCm: s(input.maxLengthCm) ?? null, maxGirthCm: s(input.maxGirthCm) ?? null, maxThinnestCm: s(input.maxThinnestCm) ?? null, maxDeclaredValue: s(input.maxDeclaredValue) ?? null,
      preferred: input.preferred ?? false, active: input.active ?? true, surcharges: input.surcharges ?? [],
    }).returning();
    if (input.bands?.length) await this.setBands(ctx, m!.id, input.bands, { source: 'manual' });
    await audit(ctx, { action: 'method.created', entityType: 'shipping_method', entityId: m!.id, after: { name: m!.name, courier: ca.account.name, serviceCode: m!.serviceCode } });
    return m!;
  }

  async update(ctx: Ctx, id: string, patch: Partial<MethodInput>) {
    const before = await this.get(ctx, id);
    if (patch.courierAccountId) await this.courierAccount(ctx, patch.courierAccountId);
    const set: Partial<typeof shippingMethods.$inferInsert> = { updatedAt: new Date() };
    const copy = <K extends keyof typeof set>(k: K, v: (typeof set)[K] | undefined) => { if (v !== undefined) set[k] = v; };
    copy('courierAccountId', patch.courierAccountId); copy('name', patch.name?.trim()); copy('serviceCode', patch.serviceCode?.trim());
    copy('originCountry', patch.originCountry?.toUpperCase()); copy('destinationCountries', patch.destinationCountries?.map((c) => toAlpha2(c) ?? c.toUpperCase()));
    copy('excludedPostcodePrefixes', patch.excludedPostcodePrefixes);
    copy('tracked', patch.tracked); copy('signature', patch.signature); copy('express', patch.express);
    copy('allowsLiquid', patch.allowsLiquid); copy('allowsBatteries', patch.allowsBatteries); copy('allowsFragile', patch.allowsFragile); copy('returnsService', patch.returnsService);
    copy('maxTransitDays', patch.maxTransitDays); copy('volumetricDivisor', patch.volumetricDivisor);
    copy('minWeightKg', s(patch.minWeightKg) ?? undefined); copy('maxWeightKg', s(patch.maxWeightKg) ?? undefined);
    if (patch.maxLengthCm !== undefined) set.maxLengthCm = s(patch.maxLengthCm);
    if (patch.maxGirthCm !== undefined) set.maxGirthCm = s(patch.maxGirthCm);
    if (patch.maxThinnestCm !== undefined) set.maxThinnestCm = s(patch.maxThinnestCm);
    if (patch.maxDeclaredValue !== undefined) set.maxDeclaredValue = s(patch.maxDeclaredValue);
    copy('preferred', patch.preferred); copy('active', patch.active); copy('surcharges', patch.surcharges);
    const [after] = await this.db.update(shippingMethods).set(set).where(eq(shippingMethods.id, id)).returning();
    if (patch.bands) await this.setBands(ctx, id, patch.bands, { source: 'manual' });
    const d = diff(before as Record<string, unknown>, after as Record<string, unknown>);
    if (d.changed) await audit(ctx, { action: 'method.updated', entityType: 'shipping_method', entityId: id, before: d.before, after: d.after });
    return after!;
  }

  async remove(ctx: Ctx, id: string) {
    const m = await this.get(ctx, id);
    await this.db.update(shippingMethods).set({ deletedAt: new Date(), active: false }).where(eq(shippingMethods.id, id));
    await audit(ctx, { action: 'method.deleted', entityType: 'shipping_method', entityId: id, before: { name: m.name } });
  }

  async bandHistory(ctx: Ctx, id: string) {
    await this.get(ctx, id);
    return this.db.select().from(shippingMethodBands).where(eq(shippingMethodBands.methodId, id)).orderBy(desc(shippingMethodBands.effectiveFrom), asc(shippingMethodBands.minWeightKg));
  }

  /** Append-only: a new band set with its own effective date. Never overwrites history. */
  async setBands(ctx: Ctx, id: string, bands: BandInput[], opts: { effectiveFrom?: string; source?: 'manual' | 'csv' | 'invoice_reconciliation' | 'ai_suggested' | 'api'; note?: string } = {}) {
    await this.get(ctx, id);
    if (!bands.length) throw new ValidationError('At least one band is required');
    const sorted = [...bands].sort((a, b) => a.minWeightKg - b.minWeightKg);
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i]!;
      if (b.maxWeightKg <= b.minWeightKg) throw new ValidationError(`Band ${i + 1}: max weight must exceed min weight`);
      if (b.cost < 0) throw new ValidationError(`Band ${i + 1}: cost cannot be negative`);
      if (i > 0 && b.minWeightKg < sorted[i - 1]!.maxWeightKg - 0.0005) throw new ValidationError(`Band ${i + 1} overlaps band ${i}`);
    }
    const effectiveFrom = opts.effectiveFrom ?? today();
    const source = opts.source ?? 'manual';
    await this.db.insert(shippingMethodBands).values(sorted.map((b) => ({ methodId: id, minWeightKg: String(b.minWeightKg), maxWeightKg: String(b.maxWeightKg), cost: b.cost.toFixed(2), effectiveFrom, source: source as 'manual', note: opts.note ?? null })));
    await audit(ctx, { action: 'method.bands_set', entityType: 'shipping_method', entityId: id, after: { effectiveFrom, source, bands: sorted, note: opts.note } });
    return this.bandHistory(ctx, id);
  }

  /** Create methods by ticking a profile's services. */
  async fromServices(ctx: Ctx, courierAccountId: string, serviceCodes: string[]) {
    const ca = await this.courierAccount(ctx, courierAccountId);
    const existing = await this.db.select({ serviceCode: shippingMethods.serviceCode }).from(shippingMethods).where(and(eq(shippingMethods.courierAccountId, courierAccountId), isNull(shippingMethods.deletedAt)));
    const have = new Set(existing.map((e) => e.serviceCode));
    const created: MethodRow[] = [];
    for (const code of serviceCodes) {
      if (have.has(code)) continue;
      const svc = ca.profile.services.find((x) => x.code === code);
      if (!svc) throw new ValidationError(`Service ${code} is not defined by ${ca.profile.name}`);
      created.push(await this.create(ctx, {
        courierAccountId, name: `${ca.account.name} ${svc.name}`, serviceCode: code, destinationCountries: svc.domestic && !svc.international ? ['GB'] : [],
        tracked: svc.tracked ?? true, signature: svc.signature ?? false, express: svc.express ?? false, maxTransitDays: svc.maxTransitDays ?? 3,
        minWeightKg: svc.limits?.minWeightKg, maxWeightKg: svc.limits?.maxWeightKg ?? 30, maxLengthCm: svc.limits?.maxLengthCm ?? null, maxGirthCm: svc.limits?.maxGirthCm ?? null, maxThinnestCm: svc.limits?.maxThinnestCm ?? null,
      }));
    }
    return created;
  }

  async setLaneDefault(ctx: Ctx, warehouseId: string, country: string, methodId: string | null) {
    const c = toAlpha2(country);
    if (!c) throw new ValidationError(`Unknown country ${country}`);
    await this.db.delete(laneDefaults).where(and(eq(laneDefaults.warehouseId, warehouseId), eq(laneDefaults.country, c)));
    if (methodId) {
      await this.get(ctx, methodId);
      await this.db.insert(laneDefaults).values({ accountId: ctx.accountId, warehouseId, country: c, methodId });
    }
    await audit(ctx, { action: 'lane_default.set', entityType: 'warehouse', entityId: warehouseId, after: { country: c, methodId } });
  }

  async laneDefault(warehouseId: string, country: string): Promise<string | null> {
    const [row] = await this.db.select().from(laneDefaults).where(and(eq(laneDefaults.warehouseId, warehouseId), eq(laneDefaults.country, country))).limit(1);
    return row?.methodId ?? null;
  }

  // ---- CSV (the current Smooth Parcel template columns, minus selling price) ----
  static CSV_COLUMNS = ['ShipingMethodName', 'CourierAccount', 'ServiceCode', 'MinWeight', 'MaxWeight', 'MaxDimensions', 'BaseCost', 'VolWeightFactor', 'MaxTransit', 'IsExpress', 'LiquidOK', 'BatteriesOK', 'FragileOK', 'Tracked', 'SignatureOnDelivery', 'StartCountry', 'DeliveryCountry', 'MaxSmallestDimensions', 'IsActivated'];

  async exportCsv(ctx: Ctx): Promise<string> {
    const rows = await this.list(ctx);
    const out: Record<string, string | number | boolean>[] = [];
    for (const m of rows) {
      const bands = m.currentBands.length ? m.currentBands : [{ minWeightKg: Number(m.minWeightKg), maxWeightKg: Number(m.maxWeightKg), cost: 0, effectiveFrom: '' }];
      for (const b of bands) out.push({
        ShipingMethodName: m.name, CourierAccount: m.courierName, ServiceCode: m.serviceCode, MinWeight: Math.round(b.minWeightKg * 1000), MaxWeight: Math.round(b.maxWeightKg * 1000),
        MaxDimensions: m.maxLengthCm ?? '', BaseCost: b.cost.toFixed(2), VolWeightFactor: m.volumetricDivisor, MaxTransit: m.maxTransitDays, IsExpress: m.express, LiquidOK: m.allowsLiquid, BatteriesOK: m.allowsBatteries, FragileOK: m.allowsFragile,
        Tracked: m.tracked, SignatureOnDelivery: m.signature, StartCountry: m.originCountry, DeliveryCountry: m.destinationCountries.join(';'), MaxSmallestDimensions: m.maxThinnestCm ?? '', IsActivated: m.active,
      });
    }
    return stringify(out, { header: true, columns: MethodsService.CSV_COLUMNS });
  }

  /** Import: rows grouped by method name; weights in grams as in the old template. */
  async importCsv(ctx: Ctx, csv: string) {
    let rows: Record<string, string>[];
    try { rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true }); } catch (e) { throw new ValidationError(`Could not read CSV: ${(e as Error).message}`); }
    const accounts = await this.db.select({ id: courierAccounts.id, name: courierAccounts.name }).from(courierAccounts).where(and(eq(courierAccounts.accountId, ctx.accountId), isNull(courierAccounts.deletedAt)));
    const existing = await this.list(ctx);
    const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : /^(true|yes|1|y)$/i.test(v));
    const groups = new Map<string, Record<string, string>[]>();
    for (const r of rows) {
      const name = r.ShipingMethodName ?? r.name;
      if (!name) throw new ValidationError('Every row needs a ShipingMethodName');
      groups.set(name, [...(groups.get(name) ?? []), r]);
    }
    const results: { name: string; created: boolean; bands: number }[] = [];
    for (const [name, grp] of groups) {
      const first = grp[0]!;
      const ca = accounts.find((a) => a.name.toLowerCase() === (first.CourierAccount ?? '').toLowerCase()) ?? (accounts.length === 1 ? accounts[0] : undefined);
      if (!ca) throw new ValidationError(`Row "${name}": CourierAccount "${first.CourierAccount}" not found (known: ${accounts.map((a) => a.name).join(', ')})`);
      const bands = grp.map((r) => ({ minWeightKg: Number(r.MinWeight ?? 0) / 1000, maxWeightKg: Number(r.MaxWeight ?? 30000) / 1000, cost: Number(r.BaseCost ?? 0) })).filter((b) => b.maxWeightKg > b.minWeightKg);
      const input: MethodInput = {
        courierAccountId: ca.id, name, serviceCode: first.ServiceCode ?? first.ServiceOffering ?? name,
        originCountry: toAlpha2(first.StartCountry) ?? 'GB', destinationCountries: (first.DeliveryCountry ?? '').split(/[;|]/).map((c) => c.trim()).filter(Boolean).map((c) => toAlpha2(c) ?? c),
        express: bool(first.IsExpress, false), allowsLiquid: bool(first.LiquidOK, true), allowsBatteries: bool(first.BatteriesOK, true), allowsFragile: bool(first.FragileOK, true),
        tracked: bool(first.Tracked, true), signature: bool(first.SignatureOnDelivery, false), maxTransitDays: Number(first.MaxTransit ?? 3) || 3, volumetricDivisor: Number(first.VolWeightFactor ?? 5000) || 5000,
        minWeightKg: Math.min(...bands.map((b) => b.minWeightKg), 0), maxWeightKg: Math.max(...bands.map((b) => b.maxWeightKg), 0.001),
        maxLengthCm: first.MaxDimensions ? Number(first.MaxDimensions) : null, maxThinnestCm: first.MaxSmallestDimensions ? Number(first.MaxSmallestDimensions) : null, active: bool(first.IsActivated, true),
      };
      const found = existing.find((m) => m.name.toLowerCase() === name.toLowerCase() && m.courierAccountId === ca.id);
      if (found) {
        await this.update(ctx, found.id, input);
        if (bands.length) await this.setBands(ctx, found.id, bands, { source: 'csv', note: 'CSV import' });
        results.push({ name, created: false, bands: bands.length });
      } else {
        const m = await this.create(ctx, input);
        if (bands.length) await this.setBands(ctx, m.id, bands, { source: 'csv', note: 'CSV import' });
        results.push({ name, created: true, bands: bands.length });
      }
    }
    return results;
  }

  async countByCourier(ctx: Ctx) {
    return this.db.select({ courierAccountId: shippingMethods.courierAccountId, count: sql<number>`count(*)::int` }).from(shippingMethods).where(and(eq(shippingMethods.accountId, ctx.accountId), isNull(shippingMethods.deletedAt))).groupBy(shippingMethods.courierAccountId);
  }
}
