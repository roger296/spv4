import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb, decimal, index, uniqueIndex, date } from 'drizzle-orm/pg-core';
import { accounts } from './core.js';
import { dataSourceEnum, deliveryPromiseEnum, incotermEnum, orderSourceEnum, orderStatusEnum, problemKindEnum, stationeryEnum } from './enums.js';

/** Shared address column set, used by warehouses, the address book and orders. */
export const addressColumns = {
  contactName: varchar('contact_name', { length: 120 }),
  company: varchar('company', { length: 120 }),
  line1: varchar('line1', { length: 255 }),
  line2: varchar('line2', { length: 255 }),
  city: varchar('city', { length: 100 }),
  region: varchar('region', { length: 100 }),
  postCode: varchar('post_code', { length: 20 }),
  country: varchar('country', { length: 2 }),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 200 }),
};

export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  externalRef: varchar('external_ref', { length: 100 }),
  ...addressColumns,
  isDefault: boolean('is_default').notNull().default(false),
  eori: varchar('eori', { length: 30 }),
  vatNumber: varchar('vat_number', { length: 30 }),
  iossNumber: varchar('ioss_number', { length: 30 }),
  stationery: stationeryEnum('stationery'),
  autoLabel: boolean('auto_label').notNull().default(true),
  packingNote: boolean('packing_note').notNull().default(true),
  shippedAfterHours: integer('shipped_after_hours').notNull().default(24),
  allowedMethodIds: uuid('allowed_method_ids').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('warehouses_account_idx').on(t.accountId)]);

export const addressBook = pgTable('address_book', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 120 }).notNull(),
  ...addressColumns,
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('address_book_account_idx').on(t.accountId)]);

export interface SuggestedProductData {
  weight?: number; length?: number; width?: number; height?: number;
  confidence: number; sourceUrl?: string; suggestedAt: string;
}

/** Mirrors smmta-next `products` field names where they overlap. */
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 500 }).notNull(),
  stockCode: varchar('stock_code', { length: 100 }).notNull(),
  ean: varchar('ean', { length: 50 }),
  brand: varchar('brand', { length: 120 }),
  description: text('description'),
  weight: decimal('weight', { precision: 10, scale: 3 }),
  length: decimal('length', { precision: 10, scale: 1 }),
  width: decimal('width', { precision: 10, scale: 1 }),
  height: decimal('height', { precision: 10, scale: 1 }),
  hsCode: varchar('hs_code', { length: 20 }),
  countryOfOrigin: varchar('country_of_origin', { length: 2 }),
  customsDescription: varchar('customs_description', { length: 200 }),
  unitValue: decimal('unit_value', { precision: 12, scale: 2 }),
  integrationSkus: jsonb('integration_skus').$type<Record<string, string>>().notNull().default({}),
  dataSource: dataSourceEnum('data_source').notNull().default('manual'),
  dataConfidence: decimal('data_confidence', { precision: 4, scale: 3 }),
  dataSourceUrl: varchar('data_source_url', { length: 500 }),
  suggested: jsonb('suggested').$type<SuggestedProductData | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [uniqueIndex('products_account_sku_unq').on(t.accountId, t.stockCode)]);

export interface MissingFieldRow { path: string; reason: string; alternatives?: string[]; options?: string[] }
export interface RankedMethod { methodId: string; name: string; courier: string; cost: number; transitDays: number; chargeableKg: number }
export interface SelectionRow {
  chosenMethodId: string | null;
  reason: string;
  ranked: RankedMethod[];
  dropped: { methodId: string; name: string; reason: string }[];
  selectedAt: string;
}

/** Mirrors smmta-next `customer_orders` naming where the concepts overlap. */
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  orderNumber: varchar('order_number', { length: 100 }).notNull(),
  externalRef: varchar('external_ref', { length: 100 }),
  source: orderSourceEnum('source').notNull().default('manual'),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
  orderDate: date('order_date').notNull(),
  customerName: varchar('customer_name', { length: 200 }),
  customerEmail: varchar('customer_email', { length: 200 }),
  customerPhone: varchar('customer_phone', { length: 50 }),
  ...addressColumns,
  deliveryPromise: deliveryPromiseEnum('delivery_promise').notNull().default('standard'),
  deliverBy: date('deliver_by'),
  incoterm: incotermEnum('incoterm'),
  declaredValue: decimal('declared_value', { precision: 12, scale: 2 }),
  currencyCode: varchar('currency_code', { length: 3 }).notNull().default('GBP'),
  signature: boolean('signature').notNull().default(false),
  fragile: boolean('fragile').notNull().default(false),
  liquid: boolean('liquid').notNull().default(false),
  batteries: boolean('batteries').notNull().default(false),
  requestedMethod: varchar('requested_method', { length: 120 }),
  requestedCourier: varchar('requested_courier', { length: 120 }),
  status: orderStatusEnum('status').notNull().default('NEW'),
  problemReason: problemKindEnum('problem_reason'),
  missing: jsonb('missing').$type<MissingFieldRow[]>().notNull().default([]),
  selection: jsonb('selection').$type<SelectionRow | null>(),
  shipmentId: uuid('shipment_id'),
  courierName: varchar('courier_name', { length: 120 }),
  methodName: varchar('method_name', { length: 120 }),
  cost: decimal('cost', { precision: 12, scale: 2 }),
  trackingNumber: varchar('tracking_number', { length: 100 }),
  trackingLink: varchar('tracking_link', { length: 500 }),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  lastEventAt: timestamp('last_event_at', { withTimezone: true }),
  labelWanted: boolean('label_wanted').notNull().default(true),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('orders_account_number_unq').on(t.accountId, t.orderNumber),
  index('orders_account_status_idx').on(t.accountId, t.status),
  index('orders_tracking_idx').on(t.trackingNumber),
]);

export const orderLines = pgTable('order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').references(() => products.id),
  sku: varchar('sku', { length: 100 }).notNull(),
  name: varchar('name', { length: 500 }).notNull(),
  quantity: integer('quantity').notNull(),
  unitValue: decimal('unit_value', { precision: 12, scale: 2 }),
  weight: decimal('weight', { precision: 10, scale: 3 }),
  length: decimal('length', { precision: 10, scale: 1 }),
  width: decimal('width', { precision: 10, scale: 1 }),
  height: decimal('height', { precision: 10, scale: 1 }),
  hsCode: varchar('hs_code', { length: 20 }),
  countryOfOrigin: varchar('country_of_origin', { length: 2 }),
  customsDescription: varchar('customs_description', { length: 200 }),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('order_lines_order_idx').on(t.orderId)]);

export const parcels = pgTable('parcels', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull().default(1),
  weight: decimal('weight', { precision: 10, scale: 3 }).notNull(),
  length: decimal('length', { precision: 10, scale: 1 }).notNull(),
  width: decimal('width', { precision: 10, scale: 1 }).notNull(),
  height: decimal('height', { precision: 10, scale: 1 }).notNull(),
  contents: jsonb('contents').$type<{ sku: string; quantity: number }[]>().notNull().default([]),
  estimated: boolean('estimated').notNull().default(false),
  labelDocumentId: uuid('label_document_id'),
  trackingNumber: varchar('tracking_number', { length: 100 }),
}, (t) => [index('parcels_order_idx').on(t.orderId)]);
