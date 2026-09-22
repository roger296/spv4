import { pgTable, uuid, varchar, text, timestamp, integer, jsonb, decimal, index } from 'drizzle-orm/pg-core';
import { accounts } from './core.js';
import { orders } from './shipping.js';
import { courierAccounts, courierProfiles, shippingMethods } from './couriers.js';
import { actorKindEnum, auditKindEnum, documentKindEnum, orderStatusEnum, problemKindEnum, shipmentKindEnum, shipmentStatusEnum } from './enums.js';

/** One purchase from a courier. An order may have several over its life (re-labels, returns). */
export const shipments = pgTable('shipments', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  kind: shipmentKindEnum('kind').notNull().default('outbound'),
  attempt: integer('attempt').notNull().default(1),
  courierAccountId: uuid('courier_account_id').notNull().references(() => courierAccounts.id),
  profileId: uuid('profile_id').notNull().references(() => courierProfiles.id),
  profileVersion: integer('profile_version').notNull().default(1),
  methodId: uuid('method_id').references(() => shippingMethods.id),
  methodName: varchar('method_name', { length: 120 }),
  courierName: varchar('courier_name', { length: 120 }),
  serviceCode: varchar('service_code', { length: 80 }),
  status: shipmentStatusEnum('status').notNull().default('PENDING'),
  courierReference: varchar('courier_reference', { length: 120 }),
  trackingNumber: varchar('tracking_number', { length: 100 }),
  trackingUrl: varchar('tracking_url', { length: 500 }),
  cost: decimal('cost', { precision: 12, scale: 2 }),
  courierCost: decimal('courier_cost', { precision: 12, scale: 2 }),
  chargeableKg: decimal('chargeable_kg', { precision: 10, scale: 3 }),
  errorMessage: text('error_message'),
  requestPayload: jsonb('request_payload'),
  responsePayload: jsonb('response_payload'),
  idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidNote: text('void_note'),
  lastTrackedAt: timestamp('last_tracked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('shipments_order_idx').on(t.orderId), index('shipments_account_status_idx').on(t.accountId, t.status), index('shipments_tracking_idx').on(t.trackingNumber)]);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
  parcelId: uuid('parcel_id'),
  kind: documentKindEnum('kind').notNull(),
  stationery: varchar('stationery', { length: 20 }),
  filePath: varchar('file_path', { length: 255 }).notNull(),
  pageCount: integer('page_count').notNull().default(1),
  bytes: integer('bytes').notNull().default(0),
  void: timestamp('void_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('documents_order_idx').on(t.orderId)]);

export const trackingEvents = pgTable('tracking_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  courierStatus: varchar('courier_status', { length: 120 }).notNull(),
  mappedStatus: orderStatusEnum('mapped_status'),
  problemKind: problemKindEnum('problem_kind'),
  location: varchar('location', { length: 200 }),
  description: text('description'),
  raw: jsonb('raw'),
  dedupeKey: varchar('dedupe_key', { length: 200 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('tracking_events_shipment_idx').on(t.shipmentId, t.occurredAt), index('tracking_events_dedupe_idx').on(t.shipmentId, t.dedupeKey)]);

export const problems = pgTable('problems', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  kind: problemKindEnum('kind').notNull(),
  description: text('description').notNull(),
  suggestedAction: text('suggested_action'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolution: text('resolution'),
  resolvedBy: varchar('resolved_by', { length: 120 }),
  ownerUserId: uuid('owner_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('problems_account_open_idx').on(t.accountId, t.resolvedAt), index('problems_order_idx').on(t.orderId)]);

/** Append-only. Notes and views are entries too, so an order has one history. */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  actorKind: actorKindEnum('actor_kind').notNull(),
  actorId: varchar('actor_id', { length: 120 }),
  actorName: varchar('actor_name', { length: 200 }),
  clientName: varchar('client_name', { length: 120 }),
  kind: auditKindEnum('kind').notNull().default('action'),
  action: varchar('action', { length: 80 }).notNull(),
  entityType: varchar('entity_type', { length: 40 }).notNull(),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_entity_idx').on(t.entityType, t.entityId, t.createdAt), index('audit_account_idx').on(t.accountId, t.createdAt)]);

/** Unmapped courier status codes seen by the tracking poll, for completing a profile's status map. */
export const unmappedStatuses = pgTable('unmapped_statuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => courierProfiles.id, { onDelete: 'cascade' }),
  courierStatus: varchar('courier_status', { length: 120 }).notNull(),
  sample: text('sample'),
  seen: integer('seen').notNull().default(1),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

/** AI usage ledger for the daily budget. */
export const aiUsage = pgTable('ai_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  job: varchar('job', { length: 60 }).notNull(),
  model: varchar('model', { length: 60 }).notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costGbp: decimal('cost_gbp', { precision: 10, scale: 4 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('ai_usage_account_day_idx').on(t.accountId, t.createdAt)]);
