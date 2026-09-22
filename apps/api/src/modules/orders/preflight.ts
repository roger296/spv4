/**
 * Pre-flight check (spec section 5). Pure: takes the order, its lines, parcels, products and
 * warehouse, returns the resulting status and the `missing` list the API hands back.
 */
import type { MissingFieldRow } from '../../db/schema/index.js';
import { checkAddress } from '../../shared/address-check.js';
import { needsCustoms } from '../../shared/countries.js';

export interface PreflightOrder {
  orderNumber: string;
  contactName: string | null; line1: string | null; city: string | null; postCode: string | null; country: string | null;
  incoterm: 'DDU' | 'DDP' | null;
  declaredValue: string | null;
}
export interface PreflightLine {
  sku: string; quantity: number; weight: string | null; length: string | null; width: string | null; height: string | null;
  hsCode: string | null; countryOfOrigin: string | null; customsDescription: string | null; unitValue: string | null;
}
export interface PreflightParcel { weight: string; length: string; width: string; height: string }
export interface PreflightProduct {
  stockCode: string; weight: string | null; length: string | null; width: string | null; height: string | null;
  hsCode: string | null; countryOfOrigin: string | null; customsDescription: string | null; unitValue: string | null;
}
export interface PreflightWarehouse { country: string | null; line1: string | null; postCode: string | null; eori: string | null; iossNumber: string | null; vatNumber: string | null }

export interface PreflightResult {
  status: 'NEW' | 'UPDATE_PRODUCT' | 'PROBLEM';
  problemReason: 'address_failed' | 'customs_incomplete' | null;
  problemDescription: string | null;
  missing: MissingFieldRow[];
}

const pos = (v: string | null | undefined) => v !== null && v !== undefined && Number(v) > 0;

export function runPreflight(input: {
  order: PreflightOrder;
  lines: PreflightLine[];
  parcels: PreflightParcel[];
  products: PreflightProduct[];
  warehouse: PreflightWarehouse;
}): PreflightResult {
  const { order, lines, parcels, products, warehouse } = input;
  const missing: MissingFieldRow[] = [];

  // 1. Address
  const addressIssues = checkAddress(order);
  if (addressIssues.length) {
    return { status: 'PROBLEM', problemReason: 'address_failed', problemDescription: addressIssues.join('. '), missing: addressIssues.map((reason) => ({ path: 'deliveryAddress', reason })) };
  }
  if (!warehouse.line1 || !warehouse.postCode || !warehouse.country) {
    missing.push({ path: 'warehouse.address', reason: 'The dispatch warehouse has no address; complete it in Settings' });
  }

  // 2. Weights and dimensions
  const bySku = new Map(products.map((p) => [p.stockCode, p]));
  const parcelsGiven = parcels.length > 0 && parcels.every((p) => pos(p.weight) && pos(p.length) && pos(p.width) && pos(p.height));
  if (!parcelsGiven) {
    if (lines.length === 0) {
      missing.push({ path: 'parcels', reason: 'No lines and no parcel measurements were given', alternatives: ['lines'] });
    }
    lines.forEach((line, i) => {
      const p = bySku.get(line.sku);
      const w = pos(line.weight) ? line.weight : p?.weight;
      const dims = [pos(line.length) ? line.length : p?.length, pos(line.width) ? line.width : p?.width, pos(line.height) ? line.height : p?.height];
      if (!pos(w)) missing.push({ path: `lines[${i}].weight`, reason: `product ${line.sku} has no weight`, alternatives: ['parcels[0].weight'] });
      if (!dims.every(pos)) missing.push({ path: `lines[${i}].dimensions`, reason: `product ${line.sku} has no dimensions`, alternatives: ['parcels[0].length', 'parcels[0].width', 'parcels[0].height'] });
    });
  }
  const productGaps = missing.filter((m) => m.path.startsWith('lines[') || m.path === 'parcels');

  // 3. Customs
  const customsMissing: MissingFieldRow[] = [];
  const origin = warehouse.country ?? 'GB';
  if (order.country && needsCustoms(origin, order.country)) {
    if (!order.incoterm) customsMissing.push({ path: 'customs.incoterm', reason: `required for ${order.country} destination`, options: ['DDU', 'DDP'] });
    if (lines.length === 0) customsMissing.push({ path: 'lines', reason: 'customs declarations need at least one line with a value and description' });
    lines.forEach((line, i) => {
      const p = bySku.get(line.sku);
      if (!(line.hsCode ?? p?.hsCode)) customsMissing.push({ path: `lines[${i}].hsCode`, reason: `required for ${order.country} destination` });
      if (!(line.countryOfOrigin ?? p?.countryOfOrigin)) customsMissing.push({ path: `lines[${i}].countryOfOrigin`, reason: `required for ${order.country} destination` });
      if (!(line.customsDescription ?? p?.customsDescription)) customsMissing.push({ path: `lines[${i}].customsDescription`, reason: 'customs need a plain description of the goods' });
      if (!pos(line.unitValue ?? p?.unitValue)) customsMissing.push({ path: `lines[${i}].unitValue`, reason: 'customs need a value per unit' });
    });
    if (!warehouse.eori) customsMissing.push({ path: 'warehouse.eori', reason: 'the sender needs an EORI number for exports; set it on the warehouse' });
  }
  missing.push(...customsMissing);

  if (productGaps.length) {
    return { status: 'UPDATE_PRODUCT', problemReason: null, problemDescription: null, missing };
  }
  if (customsMissing.length) {
    return { status: 'PROBLEM', problemReason: 'customs_incomplete', problemDescription: `Customs information is incomplete: ${customsMissing.map((m) => m.path).join(', ')}`, missing };
  }
  if (missing.length) {
    return { status: 'PROBLEM', problemReason: 'customs_incomplete', problemDescription: missing.map((m) => m.reason).join('. '), missing };
  }
  return { status: 'NEW', problemReason: null, problemDescription: null, missing: [] };
}
