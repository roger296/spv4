/**
 * Shipping-method selection (spec section 6): the cheapest active method that fits the parcels
 * and meets the delivery promise. Pure and deterministic; explains every drop.
 */
export interface SelectableMethod {
  id: string;
  name: string;
  courierName: string;
  courierAccountId: string;
  courierActive: boolean;
  serviceCode: string;
  originCountry: string;
  destinationCountries: string[];
  excludedPostcodePrefixes: string[];
  tracked: boolean; signature: boolean; express: boolean;
  allowsLiquid: boolean; allowsBatteries: boolean; allowsFragile: boolean;
  maxTransitDays: number;
  volumetricDivisor: number;
  minWeightKg: number; maxWeightKg: number;
  maxLengthCm: number | null; maxGirthCm: number | null; maxThinnestCm: number | null; maxDeclaredValue: number | null;
  preferred: boolean;
  active: boolean;
  returnsService: boolean;
  bands: { minWeightKg: number; maxWeightKg: number; cost: number }[]; // bands effective on the shipping date
  surcharges: { name: string; kind: 'flat' | 'percent'; amount: number; when?: { postcodePrefixes?: string[]; minWeightKg?: number; minLongestCm?: number; always?: boolean } }[];
}

export interface SelectionInput {
  originCountry: string;
  destinationCountry: string;
  postCode: string | null;
  parcels: { weightKg: number; lengthCm: number; widthCm: number; heightCm: number }[];
  promise: 'economy' | 'standard' | 'express' | 'next_day' | 'date';
  deliverBy?: string | null; // YYYY-MM-DD when promise = date
  shippingDate?: Date;
  flags: { signature: boolean; fragile: boolean; liquid: boolean; batteries: boolean };
  declaredValue: number;
  requestedMethod?: string | null;
  requestedCourier?: string | null;
  allowedMethodIds?: string[] | null;
  laneDefaultMethodId?: string | null;
}

export interface Ranked { methodId: string; name: string; courier: string; cost: number; transitDays: number; chargeableKg: number; parcelCosts: number[] }
export interface Dropped { methodId: string; name: string; reason: string }
export interface SelectionResult { chosen: Ranked | null; ranked: Ranked[]; dropped: Dropped[]; reason: string }

const PROMISE_MAX_DAYS: Record<string, number> = { next_day: 1, express: 2, standard: 3, economy: 7 };

export function workingDaysBetween(from: Date, to: Date): number {
  let days = 0;
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days++;
  }
  return days;
}

export function chargeableWeight(p: { weightKg: number; lengthCm: number; widthCm: number; heightCm: number }, divisor: number): number {
  const volumetric = (p.lengthCm * p.widthCm * p.heightCm) / (divisor || 5000);
  return Math.max(p.weightKg, volumetric);
}

function bandCost(m: SelectableMethod, kg: number): number | null {
  const band = m.bands.find((b) => kg >= b.minWeightKg && kg <= b.maxWeightKg) ?? m.bands.find((b) => kg > b.minWeightKg && kg <= b.maxWeightKg + 0.0005);
  return band ? band.cost : null;
}

function surchargeFor(m: SelectableMethod, input: SelectionInput, base: number, parcel: SelectionInput['parcels'][number]): number {
  let extra = 0;
  const longest = Math.max(parcel.lengthCm, parcel.widthCm, parcel.heightCm);
  for (const s of m.surcharges) {
    const w = s.when ?? { always: true };
    let applies = !!w.always;
    if (w.postcodePrefixes?.length && input.postCode) applies = applies || w.postcodePrefixes.some((p) => input.postCode!.toUpperCase().replace(/\s+/g, '').startsWith(p.toUpperCase().replace(/\s+/g, '')));
    if (w.minWeightKg !== undefined) applies = applies || parcel.weightKg >= w.minWeightKg;
    if (w.minLongestCm !== undefined) applies = applies || longest >= w.minLongestCm;
    if (applies) extra += s.kind === 'flat' ? s.amount : (base * s.amount) / 100;
  }
  return extra;
}

export function selectMethod(methods: SelectableMethod[], input: SelectionInput): SelectionResult {
  const dropped: Dropped[] = [];
  const ranked: Ranked[] = [];
  const maxDays = input.promise === 'date' && input.deliverBy
    ? Math.max(0, workingDaysBetween(input.shippingDate ?? new Date(), new Date(input.deliverBy)))
    : (PROMISE_MAX_DAYS[input.promise] ?? 3);
  const wantedMethod = input.requestedMethod?.trim().toLowerCase();
  const wantedCourier = input.requestedCourier?.trim().toLowerCase();
  const postcodeCompact = (input.postCode ?? '').toUpperCase().replace(/\s+/g, '');

  for (const m of methods) {
    const drop = (reason: string) => dropped.push({ methodId: m.id, name: m.name, reason });
    if (!m.active) { drop('method is switched off'); continue; }
    if (!m.courierActive) { drop('courier account is switched off'); continue; }
    if (wantedMethod && m.name.toLowerCase() !== wantedMethod && m.id !== input.requestedMethod && m.serviceCode.toLowerCase() !== wantedMethod) { drop('a different method was requested'); continue; }
    if (wantedCourier && !m.courierName.toLowerCase().includes(wantedCourier)) { drop('a different courier was requested'); continue; }
    if (input.laneDefaultMethodId && m.id !== input.laneDefaultMethodId) { drop('a default method is pinned for this lane'); continue; }
    if (m.originCountry !== input.originCountry) { drop(`ships from ${m.originCountry}, not ${input.originCountry}`); continue; }
    if (m.destinationCountries.length && !m.destinationCountries.includes(input.destinationCountry)) { drop(`does not deliver to ${input.destinationCountry}`); continue; }
    if (m.excludedPostcodePrefixes.length && postcodeCompact && m.excludedPostcodePrefixes.some((p) => postcodeCompact.startsWith(p.toUpperCase().replace(/\s+/g, '')))) { drop(`excludes postcode area ${input.postCode}`); continue; }
    if (input.allowedMethodIds && input.allowedMethodIds.length && !input.allowedMethodIds.includes(m.id)) { drop('not allowed for this warehouse'); continue; }
    if (input.flags.signature && !m.signature) { drop('signature required'); continue; }
    if (input.flags.liquid && !m.allowsLiquid) { drop('liquids not allowed'); continue; }
    if (input.flags.batteries && !m.allowsBatteries) { drop('batteries not allowed'); continue; }
    if (input.flags.fragile && !m.allowsFragile) { drop('fragile goods not allowed'); continue; }
    if (m.maxDeclaredValue !== null && input.declaredValue > m.maxDeclaredValue) { drop(`declared value ${input.declaredValue} exceeds ${m.maxDeclaredValue}`); continue; }
    if (m.maxTransitDays > maxDays) { drop(`takes up to ${m.maxTransitDays} working days; promise allows ${maxDays}`); continue; }

    let total = 0;
    let chargeable = 0;
    const parcelCosts: number[] = [];
    let failed: string | null = null;
    for (const p of input.parcels) {
      const dims = [p.lengthCm, p.widthCm, p.heightCm].sort((a, b) => b - a) as [number, number, number];
      const longest = dims[0];
      const girth = longest + 2 * (dims[1] + dims[2]);
      const thinnest = dims[2];
      const kg = chargeableWeight(p, m.volumetricDivisor);
      if (p.weightKg < m.minWeightKg) { failed = `parcel under ${m.minWeightKg} kg minimum`; break; }
      if (kg > m.maxWeightKg) { failed = `chargeable weight ${kg.toFixed(2)} kg over ${m.maxWeightKg} kg limit`; break; }
      if (m.maxLengthCm !== null && longest > m.maxLengthCm) { failed = `longest side ${longest} cm over ${m.maxLengthCm} cm`; break; }
      if (m.maxGirthCm !== null && girth > m.maxGirthCm) { failed = `girth ${girth.toFixed(0)} cm over ${m.maxGirthCm} cm`; break; }
      if (m.maxThinnestCm !== null && thinnest > m.maxThinnestCm) { failed = `thinnest side ${thinnest} cm over ${m.maxThinnestCm} cm`; break; }
      const base = bandCost(m, kg);
      if (base === null) { failed = `no cost band covers ${kg.toFixed(2)} kg`; break; }
      const cost = base + surchargeFor(m, input, base, p);
      parcelCosts.push(Number(cost.toFixed(2)));
      total += cost;
      chargeable += kg;
    }
    if (failed) { drop(failed); continue; }
    ranked.push({ methodId: m.id, name: m.name, courier: m.courierName, cost: Number(total.toFixed(2)), transitDays: m.maxTransitDays, chargeableKg: Number(chargeable.toFixed(3)), parcelCosts });
  }

  const pref = new Map(methods.map((m) => [m.id, m.preferred]));
  ranked.sort((a, b) => a.cost - b.cost || a.transitDays - b.transitDays || Number(pref.get(b.methodId)) - Number(pref.get(a.methodId)) || a.name.localeCompare(b.name));
  const chosen = ranked[0] ?? null;
  let reason: string;
  if (!chosen) reason = 'No method fits';
  else if (input.laneDefaultMethodId) reason = `${chosen.name} is pinned for ${input.destinationCountry} from this warehouse`;
  else if (wantedMethod || wantedCourier) reason = `${chosen.name} was requested` + (ranked.length > 1 ? `; ${ranked[1]!.name} would also fit` : '');
  else if (ranked.length === 1) reason = `${chosen.name} is the only method that fits`;
  else reason = `${chosen.name} is cheapest at ${chosen.cost.toFixed(2)} (next: ${ranked[1]!.name} at ${ranked[1]!.cost.toFixed(2)})`;
  return { chosen, ranked, dropped, reason };
}
