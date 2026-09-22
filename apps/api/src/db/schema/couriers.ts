import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb, decimal, index, uniqueIndex, date } from 'drizzle-orm/pg-core';
import { accounts } from './core.js';
import { dataSourceEnum, profileOriginEnum, profileReviewEnum } from './enums.js';

/**
 * A courier profile is the declarative description of how to talk to a courier's API.
 * The `definition` JSON is interpreted by the connector engine; there is no per-courier code.
 * See apps/api/src/couriers/profile-schema.ts for the shape.
 */
export const courierProfiles = pgTable('courier_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }), // null for builtin/shared catalogue entries
  key: varchar('key', { length: 80 }).notNull(), // e.g. royal-mail-click-and-drop
  name: varchar('name', { length: 120 }).notNull(),
  origin: profileOriginEnum('origin').notNull().default('own'),
  review: profileReviewEnum('review').notNull().default('draft'),
  version: integer('version').notNull().default(1),
  sourceProfileId: uuid('source_profile_id'),
  definition: jsonb('definition').notNull(),
  credentialSchema: jsonb('credential_schema').$type<CredentialField[]>().notNull().default([]),
  services: jsonb('services').$type<ServiceDefinition[]>().notNull().default([]),
  testsPassed: jsonb('tests_passed').$type<Record<string, string>>().notNull().default({}),
  aiSuggested: boolean('ai_suggested').notNull().default(false),
  contributorName: varchar('contributor_name', { length: 120 }),
  optOutSharing: boolean('opt_out_sharing').notNull().default(false),
  adoptions: integer('adoptions').notNull().default(0),
  liveLabels: integer('live_labels').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('courier_profiles_account_idx').on(t.accountId), index('courier_profiles_key_idx').on(t.key)]);

export interface CredentialField {
  key: string;
  label: string;
  secret?: boolean;
  help?: string;
  required?: boolean;
}

export interface ServiceDefinition {
  code: string;
  name: string;
  tracked?: boolean;
  signature?: boolean;
  express?: boolean;
  maxTransitDays?: number;
  domestic?: boolean;
  international?: boolean;
  limits?: { minWeightKg?: number; maxWeightKg?: number; maxLengthCm?: number; maxGirthCm?: number; maxThinnestCm?: number };
}

/** An account's credentials for a profile. */
export const courierAccounts = pgTable('courier_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  profileId: uuid('profile_id').notNull().references(() => courierProfiles.id),
  name: varchar('name', { length: 120 }).notNull(),
  credentialsEnc: text('credentials_enc'),
  sandbox: boolean('sandbox').notNull().default(false),
  active: boolean('active').notNull().default(true),
  lastTestAt: timestamp('last_test_at', { withTimezone: true }),
  lastTestOk: boolean('last_test_ok'),
  lastTestMessage: text('last_test_message'),
  sessionEnc: text('session_enc'), // cached login token for login-exchange auth
  sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('courier_accounts_account_idx').on(t.accountId)]);

export const shippingMethods = pgTable('shipping_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  courierAccountId: uuid('courier_account_id').notNull().references(() => courierAccounts.id),
  name: varchar('name', { length: 120 }).notNull(),
  serviceCode: varchar('service_code', { length: 80 }).notNull(),
  originCountry: varchar('origin_country', { length: 2 }).notNull().default('GB'),
  destinationCountries: text('destination_countries').array().notNull().default([]), // empty = any
  excludedPostcodePrefixes: text('excluded_postcode_prefixes').array().notNull().default([]),
  tracked: boolean('tracked').notNull().default(true),
  signature: boolean('signature').notNull().default(false),
  express: boolean('express').notNull().default(false),
  allowsLiquid: boolean('allows_liquid').notNull().default(true),
  allowsBatteries: boolean('allows_batteries').notNull().default(true),
  allowsFragile: boolean('allows_fragile').notNull().default(true),
  returnsService: boolean('returns_service').notNull().default(false),
  maxTransitDays: integer('max_transit_days').notNull().default(3),
  volumetricDivisor: integer('volumetric_divisor').notNull().default(5000),
  minWeightKg: decimal('min_weight_kg', { precision: 10, scale: 3 }).notNull().default('0'),
  maxWeightKg: decimal('max_weight_kg', { precision: 10, scale: 3 }).notNull().default('30'),
  maxLengthCm: decimal('max_length_cm', { precision: 10, scale: 1 }),
  maxGirthCm: decimal('max_girth_cm', { precision: 10, scale: 1 }),
  maxThinnestCm: decimal('max_thinnest_cm', { precision: 10, scale: 1 }),
  maxDeclaredValue: decimal('max_declared_value', { precision: 12, scale: 2 }),
  preferred: boolean('preferred').notNull().default(false),
  active: boolean('active').notNull().default(true),
  surcharges: jsonb('surcharges').$type<SurchargeRule[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('shipping_methods_account_idx').on(t.accountId)]);

export interface SurchargeRule {
  name: string;
  kind: 'flat' | 'percent';
  amount: number;
  when?: { postcodePrefixes?: string[]; minWeightKg?: number; minLongestCm?: number; always?: boolean };
  effectiveFrom?: string;
  effectiveTo?: string;
  source?: string;
}

/** Cost bands are append-only: a price change inserts a new row with a later effective_from. */
export const shippingMethodBands = pgTable('shipping_method_bands', {
  id: uuid('id').primaryKey().defaultRandom(),
  methodId: uuid('method_id').notNull().references(() => shippingMethods.id, { onDelete: 'cascade' }),
  minWeightKg: decimal('min_weight_kg', { precision: 10, scale: 3 }).notNull(),
  maxWeightKg: decimal('max_weight_kg', { precision: 10, scale: 3 }).notNull(),
  cost: decimal('cost', { precision: 12, scale: 2 }).notNull(),
  effectiveFrom: date('effective_from').notNull(),
  source: dataSourceEnum('source').notNull().default('manual'),
  note: varchar('note', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('bands_method_idx').on(t.methodId, t.effectiveFrom)]);

/** Pinned default methods per warehouse and destination country. */
export const laneDefaults = pgTable('lane_defaults', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  warehouseId: uuid('warehouse_id').notNull(),
  country: varchar('country', { length: 2 }).notNull(),
  methodId: uuid('method_id').notNull().references(() => shippingMethods.id, { onDelete: 'cascade' }),
}, (t) => [uniqueIndex('lane_defaults_unq').on(t.warehouseId, t.country)]);
