/**
 * Builds the template context a courier profile renders against. This is the whole
 * vocabulary a profile author can use: order.*, warehouse.*, parcels[], method.*, shipment.*.
 */
import type { orders, orderLines, parcels as parcelsTable, warehouses } from '../../db/schema/index.js';
import { needsCustoms } from '../../shared/countries.js';
import { splitName } from '../../couriers/template.js';
import type { ProfileDefinition } from '../../couriers/profile-schema.js';

type OrderRow = typeof orders.$inferSelect;
type LineRow = typeof orderLines.$inferSelect;
type ParcelRow = typeof parcelsTable.$inferSelect;
type WarehouseRow = typeof warehouses.$inferSelect;

const n = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));

export interface ShipmentContextInput {
  order: OrderRow;
  lines: LineRow[];
  parcels: ParcelRow[];
  warehouse: WarehouseRow;
  method: { serviceCode: string; name: string; id?: string };
  shipment: { reference: string; attempt: number; courierReference: string; trackingNumber: string; id?: string };
  def: ProfileDefinition;
  extra?: Record<string, unknown>;
}

export function buildShipmentContext(input: ShipmentContextInput): Record<string, unknown> {
  const { order, lines, parcels, warehouse, method, shipment } = input;
  const origin = warehouse.country ?? 'GB';
  const international = !!order.country && needsCustoms(origin, order.country);
  const goodsValue = lines.reduce((sum, l) => sum + (n(l.unitValue) ?? 0) * l.quantity, 0) || (n(order.declaredValue) ?? 0);
  const name = splitName(order.contactName ?? order.customerName ?? '');
  const lineCtx = lines.map((l) => ({
    sku: l.sku, name: l.name, quantity: l.quantity, unitValue: n(l.unitValue) ?? 0, lineValue: (n(l.unitValue) ?? 0) * l.quantity,
    weightKg: n(l.weight) ?? 0, lengthCm: n(l.length), widthCm: n(l.width), heightCm: n(l.height),
    hsCode: l.hsCode, countryOfOrigin: l.countryOfOrigin, customsDescription: l.customsDescription ?? l.name,
  }));
  const parcelCtx = parcels.map((p, i) => ({
    index: i, position: i + 1, sequence: p.sequence, id: p.id,
    weightKg: n(p.weight) ?? 0, lengthCm: n(p.length) ?? 0, widthCm: n(p.width) ?? 0, heightCm: n(p.height) ?? 0,
    contents: p.contents,
  }));
  return {
    order: {
      id: order.id, reference: order.orderNumber, orderNumber: order.orderNumber, orderDate: order.orderDate,
      contactName: order.contactName ?? order.customerName ?? '', firstName: name.first, lastName: name.last, company: order.company,
      line1: order.line1, line2: order.line2, city: order.city, region: order.region, postCode: order.postCode, country: order.country,
      phone: order.phone ?? order.customerPhone, email: order.email ?? order.customerEmail,
      customerName: order.customerName, customerEmail: order.customerEmail, customerPhone: order.customerPhone,
      deliveryPromise: order.deliveryPromise, deliverBy: order.deliverBy,
      incoterm: order.incoterm ?? 'DDU', ddp: order.incoterm === 'DDP', declaredValue: n(order.declaredValue) ?? goodsValue, goodsValue, currency: order.currencyCode,
      signature: order.signature, fragile: order.fragile, liquid: order.liquid, batteries: order.batteries,
      international, domestic: !international,
      description: lineCtx.map((l) => l.customsDescription).filter(Boolean).join(', ').slice(0, 200) || 'Goods',
      totalQuantity: lineCtx.reduce((s, l) => s + l.quantity, 0),
      lines: lineCtx,
      metadata: order.metadata,
    },
    warehouse: {
      id: warehouse.id, name: warehouse.name, contactName: warehouse.contactName, company: warehouse.company ?? warehouse.name,
      line1: warehouse.line1, line2: warehouse.line2, city: warehouse.city, region: warehouse.region, postCode: warehouse.postCode, country: origin,
      phone: warehouse.phone, email: warehouse.email, eori: warehouse.eori, vatNumber: warehouse.vatNumber, iossNumber: warehouse.iossNumber,
    },
    parcels: parcelCtx,
    parcel: parcelCtx[0],
    totalWeightKg: parcelCtx.reduce((s, p) => s + p.weightKg, 0),
    lines: lineCtx,
    method: { id: method.id, serviceCode: method.serviceCode, name: method.name },
    shipment: { id: shipment.id, reference: shipment.reference, attempt: shipment.attempt, courierReference: shipment.courierReference, trackingNumber: shipment.trackingNumber },
    ...(input.extra ?? {}),
  };
}
