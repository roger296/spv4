import { pgEnum } from 'drizzle-orm/pg-core';

export const orderStatusEnum = pgEnum('order_status', [
  'NEW', 'UPDATE_PRODUCT', 'LABEL_GENERATED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'PROBLEM', 'CANCELLED',
]);
export const userRoleEnum = pgEnum('user_role', ['OWNER', 'MANAGER', 'OPERATOR', 'READ_ONLY']);
export const accountStatusEnum = pgEnum('account_status', ['TRIAL', 'ACTIVE', 'ARREARS', 'SUSPENDED', 'CLOSED']);
export const billingModeEnum = pgEnum('billing_mode', ['MOLLIE', 'INVOICED', 'COMPLIMENTARY']);
export const stationeryEnum = pgEnum('stationery', ['LABEL_6X4', 'LABEL_4X4', 'A4_LEFT', 'A4_RIGHT']);
export const orderSourceEnum = pgEnum('order_source', ['api', 'mcp', 'csv', 'manual', 'smmta']);
export const deliveryPromiseEnum = pgEnum('delivery_promise', ['economy', 'standard', 'express', 'next_day', 'date']);
export const incotermEnum = pgEnum('incoterm', ['DDU', 'DDP']);
export const dataSourceEnum = pgEnum('data_source', ['manual', 'api', 'import', 'ai_suggested', 'invoice_reconciliation', 'csv']);
export const profileOriginEnum = pgEnum('profile_origin', ['builtin', 'shared', 'own']);
export const profileReviewEnum = pgEnum('profile_review', ['draft', 'submitted', 'published', 'retired']);
export const shipmentStatusEnum = pgEnum('shipment_status', ['PENDING', 'CREATED', 'FAILED', 'VOID', 'VOID_FAILED']);
export const documentKindEnum = pgEnum('document_kind', ['label', 'packing_note', 'customs_invoice', 'return_label']);
export const problemKindEnum = pgEnum('problem_kind', [
  'address_failed', 'customs_incomplete', 'no_method', 'label_failed', 'courier_error', 'no_scan', 'stalled', 'late',
  'delivery_failed', 'held', 'returning', 'damaged_lost', 'customer_reported',
]);
export const actorKindEnum = pgEnum('actor_kind', ['user', 'api_key', 'mcp', 'system', 'admin']);
export const auditKindEnum = pgEnum('audit_kind', ['action', 'note', 'view']);
export const shipmentKindEnum = pgEnum('shipment_kind', ['outbound', 'return']);
