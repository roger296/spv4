/**
 * CSV order upload (spec section 9): one native format whose headers are the API field names
 * in dotted form. Rows are validated before anything is created; each row reports its outcome.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import { requireAuth } from '../../shared/auth-middleware.js';
import { requireWrite } from '../../shared/context.js';
import { ValidationError, NeedsInformationError, NoMethodError, CourierRejectedError, AppError } from '../../shared/errors.js';
import { OrderService } from './order.service.js';
import { createOrderSchema } from './order.routes.js';

export const ORDER_CSV_TEMPLATE = [
  'reference,orderDate,warehouse,customer.name,customer.email,customer.phone,deliveryAddress.contactName,deliveryAddress.company,deliveryAddress.line1,deliveryAddress.line2,deliveryAddress.city,deliveryAddress.region,deliveryAddress.postCode,deliveryAddress.country,deliveryPromise,customs.incoterm,flags.signature,lines.1.sku,lines.1.quantity,lines.1.unitValue,lines.2.sku,lines.2.quantity,parcels.1.weight,parcels.1.length,parcels.1.width,parcels.1.height',
  'CO-1001,2026-09-22,,Jane Tompkins,jane@example.com,07700900000,Jane Tompkins,,12 High Street,,Manchester,,M1 1AA,GB,standard,,false,PLA-BLK,2,18.00,,,,,,',
  'CO-1002,2026-09-22,,Sam Patel,sam@example.com,,Sam Patel,Patel Ltd,4 Rue de Rivoli,,Paris,,75001,FR,economy,DDU,false,PLA-BLK,1,18.00,,,1.3,20,20,8',
].join('\n') + '\n';

/** Turn a flat dotted row into a nested object; numeric segments become array indexes (1-based). */
export function unflatten(row: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(row)) {
    if (raw === undefined || raw === '') continue;
    const parts = key.trim().split('.');
    let cur: Record<string, unknown> | unknown[] = out;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const last = i === parts.length - 1;
      const idx = /^\d+$/.test(part) ? Number(part) - 1 : null;
      if (last) {
        const value = coerce(raw);
        if (idx !== null) (cur as unknown[])[idx] = value; else (cur as Record<string, unknown>)[part] = value;
      } else {
        const nextIsIndex = /^\d+$/.test(parts[i + 1]!);
        const container = idx !== null ? (cur as unknown[]) : (cur as Record<string, unknown>);
        const k = idx !== null ? idx : part;
        const existing = (container as Record<string | number, unknown>)[k];
        const next = existing ?? (nextIsIndex ? [] : {});
        (container as Record<string | number, unknown>)[k] = next;
        cur = next as Record<string, unknown> | unknown[];
      }
    }
  }
  // Compact arrays (skip blank rows).
  const compact = (v: unknown): unknown => Array.isArray(v) ? v.filter((x) => x !== undefined && x !== null).map(compact) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, compact(x)])) : v;
  return compact(out) as Record<string, unknown>;
}

function coerce(raw: string): unknown {
  const t = raw.trim();
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(t) && !/^0\d/.test(t)) return Number(t);
  return t;
}

export async function importRoutes(app: FastifyInstance) {
  const svc = new OrderService();

  app.get('/orders/import/template', { preHandler: requireAuth }, async (_req, reply) => reply.type('text/csv').header('content-disposition', 'attachment; filename="orders-template.csv"').send(ORDER_CSV_TEMPLATE));

  app.post('/orders/import', { preHandler: requireAuth }, async (req) => {
    requireWrite(req.ctx, 'orders:write');
    const { csv, label } = z.object({ csv: z.string().min(1).max(5_000_000), label: z.boolean().optional() }).parse(req.body);
    let rows: Record<string, string>[];
    try { rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true }); } catch (e) { throw new ValidationError(`Could not read CSV: ${(e as Error).message}`); }
    if (rows.length > 2000) throw new ValidationError('At most 2,000 orders per upload');
    const results: { row: number; reference: string; status: string; missing?: unknown; error?: string; courier?: string | null; trackingNumber?: string | null }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 2;
      const nested = unflatten(rows[i]!);
      // Numeric-looking postcodes and references must stay strings.
      for (const path of ['reference', 'deliveryAddress.postCode', 'deliveryAddress.line1', 'customer.phone', 'deliveryAddress.phone']) {
        const v = path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), nested);
        if (typeof v === 'number') { const [a, b] = path.split('.'); if (b) ((nested[a!] as Record<string, unknown>) ??= {})[b] = String(v); else nested[a!] = String(v); }
      }
      const parsed = createOrderSchema.safeParse({ ...nested, label: label ?? nested.label });
      if (!parsed.success) { results.push({ row: rowNo, reference: String(nested.reference ?? ''), status: 'invalid', error: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') }); continue; }
      try {
        const { order, duplicate } = await svc.create(req.ctx, parsed.data, 'csv');
        if (duplicate) { results.push({ row: rowNo, reference: order.orderNumber, status: 'duplicate' }); continue; }
        if (parsed.data.label !== false && order.status === 'NEW') {
          const labelled = await svc.requestLabel(req.ctx, order.id);
          results.push({ row: rowNo, reference: order.orderNumber, status: labelled.status, courier: labelled.courierName, trackingNumber: labelled.trackingNumber });
        } else {
          results.push({ row: rowNo, reference: order.orderNumber, status: order.status, missing: order.missing.length ? order.missing : undefined });
        }
      } catch (err) {
        if (err instanceof NeedsInformationError) results.push({ row: rowNo, reference: err.reference, status: err.orderStatus, missing: err.missing });
        else if (err instanceof NoMethodError) results.push({ row: rowNo, reference: err.reference, status: 'PROBLEM', error: `No method fits: ${err.dropped.map((d) => `${d.name} (${d.reason})`).join('; ')}` });
        else if (err instanceof CourierRejectedError) results.push({ row: rowNo, reference: String(nested.reference ?? ''), status: 'PROBLEM', error: err.message });
        else if (err instanceof AppError) results.push({ row: rowNo, reference: String(nested.reference ?? ''), status: 'error', error: err.message });
        else throw err;
      }
    }
    return { total: rows.length, results };
  });
}
