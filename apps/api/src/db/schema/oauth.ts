import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { accounts, users } from './core.js';

/** Dynamically registered OAuth clients (MCP clients such as Claude Cowork). Public clients with PKCE. */
export const oauthClients = pgTable('oauth_clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: varchar('client_id', { length: 64 }).notNull().unique(),
  clientName: varchar('client_name', { length: 200 }),
  redirectUris: text('redirect_uris').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const oauthCodes = pgTable('oauth_codes', {
  code: varchar('code', { length: 128 }).primaryKey(),
  clientId: varchar('client_id', { length: 64 }).notNull(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: varchar('redirect_uri', { length: 500 }).notNull(),
  codeChallenge: varchar('code_challenge', { length: 128 }).notNull(),
  scope: varchar('scope', { length: 500 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
}, (t) => [index('oauth_codes_expires_idx').on(t.expiresAt)]);
