/**
 * Append-only audit log. Actions, manual notes and record views all land here so an
 * order has one history (spec section 4, "Audit log on shipments").
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '../config/database.js';
import { auditLog } from '../db/schema/index.js';
import type { Ctx } from './context.js';

export type AuditKind = 'action' | 'note' | 'view';

export interface AuditEntryInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  kind?: AuditKind;
  before?: unknown;
  after?: unknown;
  note?: string | null;
}

export async function audit(ctx: Ctx, entry: AuditEntryInput, tx?: Tx | Db): Promise<void> {
  const db = tx ?? getDb();
  await db.insert(auditLog).values({
    accountId: ctx.accountId,
    actorKind: ctx.actorKind,
    actorId: ctx.actorId,
    actorName: ctx.actorName,
    clientName: ctx.clientName,
    kind: entry.kind ?? 'action',
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    note: entry.note ?? null,
  });
}

export async function addNote(ctx: Ctx, entityType: string, entityId: string, note: string): Promise<void> {
  await audit(ctx, { action: 'note', entityType, entityId, kind: 'note', note });
}

export async function recordView(ctx: Ctx, entityType: string, entityId: string): Promise<void> {
  await audit(ctx, { action: 'viewed', entityType, entityId, kind: 'view' });
}

export async function historyFor(ctx: Ctx, entityType: string, entityId: string, limit = 200) {
  return getDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.accountId, ctx.accountId), eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

/** Only the fields that changed, for compact before/after records. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
