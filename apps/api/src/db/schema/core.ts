import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb, index, uniqueIndex, decimal } from 'drizzle-orm/pg-core';
import { accountStatusEnum, billingModeEnum, stationeryEnum, userRoleEnum } from './enums.js';

export interface AccountSettings {
  packagingAllowanceKg?: number;
  defaultBox?: { length: number; width: number; height: number };
  aiApprovalRequired?: boolean;
  trustAiAboveConfidence?: number;
  notificationEmails?: string[];
  trackingBranding?: { logoUrl?: string; colour?: string; supportEmail?: string };
  a4Label?: { x: number; y: number; width: number; height: number };
  dailyProblemEmail?: boolean;
}

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 200 }).notNull(),
  slug: varchar('slug', { length: 80 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('GBP'),
  stationery: stationeryEnum('stationery').notNull().default('LABEL_6X4'),
  status: accountStatusEnum('status').notNull().default('TRIAL'),
  billingMode: billingModeEnum('billing_mode').notNull().default('MOLLIE'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  mollieCustomerId: varchar('mollie_customer_id', { length: 64 }),
  mollieMandateId: varchar('mollie_mandate_id', { length: 64 }),
  mollieSubscriptionId: varchar('mollie_subscription_id', { length: 64 }),
  failedPayments: integer('failed_payments').notNull().default(0),
  lastPaidAt: timestamp('last_paid_at', { withTimezone: true }),
  settings: jsonb('settings').$type<AccountSettings>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (t) => [uniqueIndex('accounts_slug_unq').on(t.slug)]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 200 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  role: userRoleEnum('role').notNull().default('OPERATOR'),
  passwordHash: varchar('password_hash', { length: 255 }),
  inviteToken: varchar('invite_token', { length: 128 }),
  inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
  resetToken: varchar('reset_token', { length: 128 }),
  resetExpiresAt: timestamp('reset_expires_at', { withTimezone: true }),
  lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [uniqueIndex('users_email_unq').on(t.email), index('users_account_idx').on(t.accountId)]);

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 200 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('admin_users_email_unq').on(t.email)]);

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  prefix: varchar('prefix', { length: 16 }).notNull(),
  keyHash: varchar('key_hash', { length: 255 }).notNull(),
  scopes: text('scopes').array().notNull().default([]),
  kind: varchar('kind', { length: 16 }).notNull().default('api'), // api | mcp
  clientName: varchar('client_name', { length: 120 }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('api_keys_prefix_unq').on(t.prefix), index('api_keys_account_idx').on(t.accountId)]);

export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  url: varchar('url', { length: 500 }).notNull(),
  secret: varchar('secret', { length: 128 }).notNull(),
  events: text('events').array().notNull().default([]),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('webhooks_account_idx').on(t.accountId)]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookId: uuid('webhook_id').notNull().references(() => webhooks.id, { onDelete: 'cascade' }),
  event: varchar('event', { length: 60 }).notNull(),
  payload: jsonb('payload').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastStatus: integer('last_status'),
  lastError: text('last_error'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  molliePaymentId: varchar('mollie_payment_id', { length: 64 }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('GBP'),
  status: varchar('status', { length: 30 }).notNull(),
  sequenceType: varchar('sequence_type', { length: 16 }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  raw: jsonb('raw'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('payments_mollie_unq').on(t.molliePaymentId)]);
